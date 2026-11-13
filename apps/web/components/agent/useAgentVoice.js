"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { streamVoice } from "../../lib/agentStream"
import { audioContext } from "../../lib/sounds"
import { createTurnDetector, encodeWav16k } from "../../lib/turnDetector"
import { useApi } from "../../lib/useApi"
import { createVoicePlayer } from "../../lib/voicePlayer"

// Talk mode: the person speaks and the Agent answers aloud, turn by turn, hands-free. The server listens, decides,
// looks things up and speaks; this records each spoken turn from the microphone, uploads it and plays the voice that
// streams back. What is said is saved in the open chat, where the written answer and its cards show as usual.
//
// It goes: idle → starting (the microphone, then the Agent's hello) → listening → thinking (the turn is with the
// server) → speaking → listening again, until the person ends it.
//
// The microphone is shut while the Agent answers and for a moment after: on loudspeakers its own voice would reach
// the microphone and it would answer itself. With headphones (a checkbox, remembered on this device) it stays open,
// and speaking over the Agent stops it.

const HEADPHONES_KEY = "synergifund-voice-headphones"
const MICROPHONE = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
// The server takes a turn of up to 60 seconds; someone still talking is cut a little before that.
const MAX_TURN_MS = 58000
// After the Agent's voice ends the microphone stays shut this long, while the sound dies away in the room.
const SETTLE_MS = 300
// With headphones, this much speech stops the Agent (a click does not).
const INTERRUPT_MS = 150
// This many exchanges failing one after another end Talk mode.
const MAX_FAILURES = 3
const PROBLEM = "The Agent could not answer. Try again."
const DROPPED = "The connection dropped. Try again."

// About a tenth of a second of sound at a time, whatever rate the device records at.
function frameSize(rate) {
  let size = 256
  while (size < 16384 && size * 2 <= rate * 0.093) size *= 2
  return size
}

function microphoneProblem(err) {
  if (err?.name === "NotAllowedError" || err?.name === "SecurityError") return "Allow the microphone for this site to talk with the Agent."
  if (err?.name === "NotFoundError") return "No microphone was found."
  return "The microphone could not be started."
}

// The Agent's words arrive in pieces. Most are parts of a sentence as the speech model writes them (parts of words
// too), with their own spaces. A new line after a finished sentence comes without one, and gets it here.
function addWords(caption, piece) {
  const text = String(piece || "")
  const first = text.charAt(0)
  const capital = /\p{L}/u.test(first) && (first !== first.toLowerCase() || first === first.toUpperCase())
  return `${caption}${capital && /[.!?…।]$/.test(caption) ? " " : ""}${text}`
}

// `threadId` and `temporary`: the open chat. `streaming`: a typed answer is on its way (Talk waits for it).
// `onThread(id)` makes the chat a spoken turn was saved in the open one, and `onRefresh(id)` shows it as the server
// saved it (useAgentChat's adoptThread and refreshThread).
export function useAgentVoice({ threadId = "", temporary = false, streaming = false, onThread, onRefresh }) {
  const settings = useApi("/agent/voice")
  const [supported, setSupported] = useState(false)
  const [state, setState] = useState("idle")
  const [asking, setAsking] = useState(false)
  const [status, setStatus] = useState("")
  const [caption, setCaption] = useState("")
  const [heard, setHeard] = useState("")
  const [error, setError] = useState("")
  const [headphones, setHeadphones] = useState(false)
  // Talk mode while it is on: the microphone, the turn detector, the voice player and the exchange under way.
  const runRef = useRef(null)
  const headphonesRef = useRef(false)
  const live = useRef(null)
  live.current = { threadId, temporary, streaming, onThread, onRefresh }

  useEffect(() => {
    setSupported(Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext)))
    try {
      headphonesRef.current = localStorage.getItem(HEADPHONES_KEY) === "on"
      setHeadphones(headphonesRef.current)
    } catch {}
  }, [])

  // Everything from here runs long after the render that made it (from the microphone, the stream and timers), so it
  // reads the page's latest values through `live` and the refs, never from that render.

  function release(run) {
    clearTimeout(run.timer)
    run.turn?.abort.abort()
    run.turn = null
    run.player?.close()
    if (run.processor) run.processor.onaudioprocess = null
    try {
      run.source?.disconnect()
      run.processor?.disconnect()
      run.silent?.disconnect()
    } catch {}
    for (const track of run.stream?.getTracks() || []) {
      track.onended = null
      track.stop()
    }
  }

  // Talk mode is over: the microphone is let go and the box comes back. `message` says why, when something went wrong.
  function finish(message = "") {
    const run = runRef.current
    if (!run) return
    runRef.current = null
    drop(run)
    release(run)
    setState("idle")
    setAsking(false)
    setStatus("")
    setCaption("")
    setHeard("")
    setError(message)
  }

  // The chat the server saved this conversation in becomes the open chat.
  function adopt(run, id) {
    if (!id || id === run.chatId) return
    run.chatId = id
    live.current.onThread?.(id)
  }

  // Listening again, once the Agent's voice has died away in the room.
  function listen(run) {
    setState("listening")
    setAsking(false)
    setStatus("")
    clearTimeout(run.timer)
    run.timer = setTimeout(() => {
      run.open = true
    }, SETTLE_MS)
  }

  // The exchange under way is dropped: the upload or the answer is cancelled and the voice falls silent. The chat
  // shows what the server had saved of it by then.
  function drop(run) {
    const spoken = run.turn?.spoken
    run.turn?.abort.abort()
    run.turn = null
    run.player?.stop()
    if (spoken && run.chatId) live.current.onRefresh?.(run.chatId)
  }

  function handle(run, turn, event) {
    if (event.t === "thread") adopt(run, event.id)
    else if (event.t === "heard") setHeard(String(event.text || ""))
    else if (event.t === "route") setAsking(Boolean(event.ask))
    else if (event.t === "status") setStatus(String(event.title || ""))
    else if (event.t === "say") setCaption((current) => addWords(current, event.text))
    else if (event.t === "audio") run.player.push(event.d)
    else if (event.t === "error") turn.failed = String(event.message || "") || PROBLEM
    else if (event.t === "done") {
      // The turn is saved: the chat shows it (the written answer and its cards, or the two spoken lines).
      turn.done = true
      adopt(run, event.threadId)
      if (turn.spoken && run.chatId) live.current.onRefresh?.(run.chatId)
    }
  }

  // After an exchange: listening again, and when it failed, saying so. Talk mode ends when this month's AI budget is
  // used up, when the hello is refused (the Agent is not connected, or not allowed), or after three failures in a row.
  function settle(run, turn) {
    if (!turn.failed) {
      run.failures = 0
      listen(run)
      return
    }
    run.failures += 1
    if (turn.status === 402) live.current.onRefresh?.(run.chatId)
    if (turn.status === 402 || (turn.status && !turn.spoken)) finish(turn.failed)
    else if (run.failures >= MAX_FAILURES) finish(`Talk stopped after three problems in a row. ${turn.failed}`)
    else {
      setError(turn.failed)
      listen(run)
    }
  }

  // One exchange with the server: the Agent's hello ("greet") or its answer to a spoken turn ("turn"). Its voice plays
  // as it arrives, and once it has been heard the microphone opens again.
  async function exchange(run, path, body) {
    const turn = { abort: new AbortController(), spoken: path === "turn", done: false, failed: "", status: 0 }
    drop(run)
    run.turn = turn
    run.open = false
    clearTimeout(run.timer)
    setState(turn.spoken ? "thinking" : "starting")
    setAsking(false)
    setStatus("")
    setCaption("")
    setError("")
    if (turn.spoken) setHeard("")
    try {
      await streamVoice(path, body, {
        signal: turn.abort.signal,
        onChatId: (id) => run.turn === turn && adopt(run, id),
        onEvent: (event) => run.turn === turn && handle(run, turn, event),
      })
      if (!turn.done && !turn.failed) turn.failed = DROPPED
    } catch (err) {
      // The server refused (it says why, with a status), or the connection failed.
      turn.status = err.status || 0
      turn.failed = turn.status ? err.message || PROBLEM : DROPPED
    }
    // Stopped, interrupted or ended meanwhile: whatever took its place carries on.
    if (run.turn !== turn) return
    await run.player.drained()
    if (run.turn !== turn) return
    run.turn = null
    settle(run, turn)
  }

  // A turn the person has just finished goes to the server as a small sound file.
  function send(run, turn) {
    if (live.current.streaming) return
    const body = new FormData()
    body.append("audio", new Blob([encodeWav16k(turn.samples, run.context.sampleRate)], { type: "audio/wav" }), "turn.wav")
    if (run.chatId) body.append("threadId", run.chatId)
    if (run.temporary) body.append("temporary", "true")
    exchange(run, "turn", body)
  }

  // Each moment of sound from the microphone. While it is shut (the Agent is answering, and no headphones) the sound
  // is dropped.
  function hear(run, frame) {
    if (runRef.current !== run) return
    if (!run.open && !headphonesRef.current) {
      if (run.hearing) run.detector.reset()
      run.hearing = false
      return
    }
    run.hearing = true
    const turn = run.detector.push(frame)
    // With headphones, speaking over the Agent stops it, and what is being said becomes the next turn.
    if (run.turn && run.detector.speaking && run.detector.speechMs >= INTERRUPT_MS) {
      drop(run)
      run.open = true
      setState("listening")
      setAsking(false)
      setStatus("")
    }
    if (turn) send(run, turn)
  }

  // The microphone feeds the turn detector, and the Agent's voice gets its player.
  function connect(run) {
    const { context, stream } = run
    run.detector = createTurnDetector({ sampleRate: context.sampleRate, maxTurnMs: MAX_TURN_MS })
    run.player = createVoicePlayer({
      onPlaying: (playing) => {
        if (runRef.current === run && run.turn) setState(playing ? "speaking" : run.turn.spoken ? "thinking" : "starting")
      },
    })
    run.source = context.createMediaStreamSource(stream)
    // ScriptProcessor works in every browser, including Safari on iPhone.
    run.processor = context.createScriptProcessor(frameSize(context.sampleRate), 1, 1)
    run.silent = context.createGain()
    run.silent.gain.value = 0
    run.source.connect(run.processor)
    run.processor.connect(run.silent)
    run.silent.connect(context.destination)
    run.processor.onaudioprocess = (event) => hear(run, event.inputBuffer.getChannelData(0))
    // The microphone was unplugged, or the browser took it away.
    for (const track of stream.getTracks()) {
      track.onended = () => {
        if (runRef.current === run) finish("The microphone stopped. Start Talk again.")
      }
    }
  }

  // Talk: the browser asks for the microphone, the Agent says hello, and then it listens.
  const start = useCallback(async () => {
    if (runRef.current || live.current.streaming) return
    // This runs in the tap on Talk, which is what lets a phone play sound.
    const context = audioContext()
    if (!context || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser cannot use the microphone here.")
      return
    }
    const run = { context, chatId: live.current.threadId, temporary: live.current.temporary, open: false, hearing: false, failures: 0, turn: null, timer: null }
    runRef.current = run
    setError("")
    setHeard("")
    setCaption("")
    setState("starting")
    try {
      run.stream = await navigator.mediaDevices.getUserMedia(MICROPHONE)
    } catch (err) {
      if (runRef.current === run) finish(microphoneProblem(err))
      return
    }
    // Ended while the browser was asking: the microphone is let go again.
    if (runRef.current !== run) {
      release(run)
      return
    }
    connect(run)
    exchange(run, "greet", {})
  }, [])

  // Stop: the answer under way is cancelled (also the hello), and the Agent listens again.
  const stop = useCallback(() => {
    const run = runRef.current
    if (!run?.turn) return
    drop(run)
    listen(run)
  }, [])

  const end = useCallback(() => finish(), [])

  const chooseHeadphones = useCallback((on) => {
    headphonesRef.current = Boolean(on)
    setHeadphones(Boolean(on))
    try {
      localStorage.setItem(HEADPHONES_KEY, on ? "on" : "off")
    } catch {}
  }, [])

  // How loud the sound is now, from 0 to 1, for the moving bars: the Agent's voice while it speaks, else the microphone.
  const level = useCallback(() => {
    const run = runRef.current
    if (!run?.player) return 0
    if (run.player.playing) return run.player.level()
    return run.hearing ? Math.min(1, run.detector.level * 6) : 0
  }, [])

  // Switching chats, or to and from a temporary chat, ends Talk mode: what is said next belongs to the chat on screen.
  useEffect(() => {
    const run = runRef.current
    if (run && (threadId !== run.chatId || temporary !== run.temporary)) finish()
  }, [threadId, temporary])

  // Leaving the page or closing the sheet lets the microphone go.
  useEffect(() => () => {
    const run = runRef.current
    runRef.current = null
    if (run) release(run)
  }, [])

  return {
    // Talk can be offered: this browser has a microphone it can use, and the server has a model to talk with.
    ready: supported && Boolean(settings.data?.available),
    on: state !== "idle",
    state,
    asking,
    status,
    caption,
    heard,
    error,
    headphones,
    setHeadphones: chooseHeadphones,
    level,
    start,
    stop,
    end,
  }
}
