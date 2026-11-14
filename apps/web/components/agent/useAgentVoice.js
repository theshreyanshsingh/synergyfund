"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { streamVoice } from "../../lib/agentStream"
import { audioContext } from "../../lib/sounds"
import { createBargeIn } from "../../lib/bargeIn"
import { createTurnDetector, encodeWav16k, loudness } from "../../lib/turnDetector"
import { useApi } from "../../lib/useApi"
import { createVoicePlayer } from "../../lib/voicePlayer"

// Talk mode: the person speaks and the Agent answers aloud, turn by turn, hands-free. The server listens, decides,
// looks things up and speaks; this records each spoken turn from the microphone, uploads it and plays the voice that
// streams back. What is said is saved in the open chat, where the written answer and its cards show as usual, and the
// turn under way shows there as it happens.
//
// It goes: idle → starting (the microphone, then the Agent's hello) → listening → thinking (the turn is with the
// server) → speaking → listening again, until the person ends it.
//
// The microphone stays open all the time, as on a call: someone speaking over the Agent stops it, and what they say
// is the next turn. On loudspeakers the Agent's own voice comes back in through the microphone as well; bargeIn.js
// tells that echo from a person, so the Agent does not stop for, or answer, itself. Mute shuts the microphone.
//
// A pause is not always the end of a turn. Until the Agent has started on an answer the microphone stays open, and
// someone who goes on talking gets their turn back: it goes to the server again with what they add. (Twice at most
// for one turn, so a noisy room cannot keep a turn from being answered.)

const MICROPHONE = { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } }
// The server takes a turn of up to 60 seconds; someone still talking is cut a little before that.
const MAX_TURN_MS = 58000
// The server keeps a question 0.6 seconds after it is handed to the records Agent (its PATIENCE.takeBack); cancelled
// before that, the whole question is thrown away. So speaking over a looked-up answer only stops it from a little
// after that.
const INTERRUPT_AFTER_MS = 800
// This much speech before the Agent has started on an answer means the person had not finished.
const RESUME_MS = 200
// A turn is taken back this many times at most; then it is answered as it stands.
const MAX_TAKE_BACKS = 2
// This many exchanges failing one after another end Talk mode.
const MAX_FAILURES = 3
const PROBLEM = "The Agent could not answer. Try again."
const DROPPED = "The connection dropped. Try again."
const NO_SOUND = new Float32Array(0)

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

// Two stretches of sound as one, at most `most` samples long (the newest sound is kept).
function joined(first, second, most) {
  const sound = new Float32Array(first.length + second.length)
  sound.set(first)
  sound.set(second, first.length)
  return sound.length > most ? sound.subarray(sound.length - most) : sound
}

// `threadId` and `temporary`: the open chat. `streaming`: a typed answer is on its way (Talk waits for it).
// `onThread(id)` makes the chat a spoken turn was saved in the open one, `onRefresh(id)` shows it as the server saved
// it, and `onSpoken(turn)` shows the turn under way in the chat: { key, heard, reply }, or null to take it away
// (useAgentChat's adoptThread, refreshThread and showSpoken).
export function useAgentVoice({ threadId = "", temporary = false, streaming = false, onThread, onRefresh, onSpoken }) {
  const settings = useApi("/agent/voice")
  const [supported, setSupported] = useState(false)
  const [state, setState] = useState("idle")
  const [asking, setAsking] = useState(false)
  const [status, setStatus] = useState("")
  const [caption, setCaption] = useState("")
  const [error, setError] = useState("")
  const [muted, setMuted] = useState(false)
  const [working, setWorking] = useState(false)
  // Talk mode while it is on: the microphone, the turn detector, the voice player and the exchange under way.
  const runRef = useRef(null)
  const live = useRef(null)
  live.current = { threadId, temporary, streaming, onThread, onRefresh, onSpoken, reloadSettings: settings.reload }

  useEffect(() => {
    setSupported(Boolean(navigator.mediaDevices?.getUserMedia && (window.AudioContext || window.webkitAudioContext)))
  }, [])

  // Everything from here runs long after the render that made it (from the microphone, the stream and timers), so it
  // reads the page's latest values through `live` and the refs, never from that render.

  function release(run) {
    run.kept = null
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
    live.current.onSpoken?.(null)
    setState("idle")
    setAsking(false)
    setStatus("")
    setCaption("")
    setMuted(false)
    setError(message)
  }

  // The chat the server saved this conversation in becomes the open chat.
  function adopt(run, id) {
    if (!id || id === run.chatId) return
    run.chatId = id
    live.current.onThread?.(id)
  }

  // Listening again.
  function listen() {
    setState("listening")
    setAsking(false)
    setStatus("")
    setCaption("")
  }

  // The exchange under way is dropped: the upload or the answer is cancelled and the voice falls silent. The chat
  // shows what the server had saved of it by then.
  function drop(run) {
    const spoken = run.turn?.spoken
    run.turn?.abort.abort()
    run.turn = null
    run.player?.stop()
    setWorking(false)
    // (In a chat the server has not saved yet there is nothing to show of it: the turn leaves the chat.)
    if (spoken && run.chatId) live.current.onRefresh?.(run.chatId)
    else if (spoken) live.current.onSpoken?.(null)
  }

  // The turn under way in the chat: what the person said, and the Agent's own reply as it says it.
  function show(turn) {
    if (!turn.spoken || !turn.heard || turn.saved) return
    live.current.onSpoken?.({ key: turn.key, heard: turn.heard, reply: turn.reply })
    setWorking(true)
  }

  function handle(run, turn, event) {
    if (event.t === "thread") adopt(run, event.id)
    else if (event.t === "heard") {
      // (A question for the records shows as the server will save it, which the route event carries.)
      if (!turn.asked) turn.heard = String(event.text || "") || turn.heard
      show(turn)
    } else if (event.t === "route") {
      // The Agent has started on an answer: from here the turn is no longer taken back.
      turn.routed = true
      turn.routedAt = performance.now()
      turn.asked = Boolean(event.ask)
      if (event.question) turn.heard = String(event.question)
      setAsking(turn.asked)
      show(turn)
    } else if (event.t === "status") setStatus(String(event.title || ""))
    else if (event.t === "say") {
      setCaption((current) => addWords(current, event.text))
      // Its own reply is what the chat will hold; what it says while it looks something up is not.
      if (turn.spoken && !turn.asked) {
        turn.reply = addWords(turn.reply, event.text)
        show(turn)
      }
    } else if (event.t === "audio") run.player.push(event.d)
    else if (event.t === "saved") {
      // The written answer is in the chat: it shows, with its cards, while the Agent says its short version. (The
      // Agent is shown at work until it is on screen.)
      turn.saved = true
      Promise.resolve(run.chatId ? live.current.onRefresh?.(run.chatId) : null).then((shown) => {
        turn.shown = shown !== false
        if (run.turn === turn || !run.turn) setWorking(false)
      })
    } else if (event.t === "error") turn.failed = String(event.message || "") || PROBLEM
    else if (event.t === "done") {
      // The turn is saved: the chat shows it (the written answer and its cards, or the two spoken lines).
      turn.done = true
      adopt(run, event.threadId)
      if (turn.spoken && !turn.saved) {
        setWorking(false)
        if (run.chatId) live.current.onRefresh?.(run.chatId)
      }
      // (The written answer could not be fetched when it was saved: once more now.)
      else if (turn.spoken && turn.shown === false && run.chatId) live.current.onRefresh?.(run.chatId)
    }
  }

  // After an exchange: listening again, and when it failed, saying so. Talk mode ends when this month's AI budget is
  // used up, when Talk is turned off or the Agent disconnected, when the hello is refused, or after three failures in a
// row.
  function settle(run, turn) {
    if (!turn.failed) {
      run.failures = 0
      listen()
      return
    }
    setWorking(false)
    run.failures += 1
    // The chat shows what the server saved of the turn before it failed (and what is left of the AI budget).
    if (turn.status === 402 || (turn.spoken && run.chatId)) live.current.onRefresh?.(run.chatId)
    else live.current.onSpoken?.(null)
    // (402: the budget is used up; 403: Talk was turned off meanwhile; 503: the model was disconnected. Then Talk
    // is offered again only if it can be had.)
    if ([403, 503].includes(turn.status)) live.current.reloadSettings?.()
    if ([402, 403, 503].includes(turn.status) || (turn.status && !turn.spoken)) finish(turn.failed)
    else if (run.failures >= MAX_FAILURES) finish(`Talk stopped after three problems in a row. ${turn.failed}`)
    else {
      setError(turn.failed)
      listen()
    }
  }

  // One exchange with the server: the Agent's hello ("greet") or its answer to a spoken turn ("turn", with the turn's
  // sound in `samples`). Its voice plays as it arrives, and once it has been heard the Agent listens again.
  async function exchange(run, path, body, { samples = NO_SOUND, takeBacks = 0 } = {}) {
    run.turns += 1
    const turn = { abort: new AbortController(), spoken: path === "turn", key: run.turns, samples, takeBacks, heard: "", reply: "", asked: false, routed: false, routedAt: 0, saved: false, shown: null, done: false, failed: "", status: 0 }
    drop(run)
    run.turn = turn
    setState(turn.spoken ? "thinking" : "starting")
    setAsking(false)
    setStatus("")
    setCaption("")
    setError("")
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
    // Stopped, interrupted, taken back or ended meanwhile: whatever took its place carries on.
    if (run.turn !== turn) return
    await run.player.drained()
    if (run.turn !== turn) return
    run.turn = null
    settle(run, turn)
  }

  // A turn the person has just finished goes to the server as a small sound file, after whatever was kept of a turn
  // they had not finished. `samples` may be empty: then what was kept goes as it is.
  function send(run, samples) {
    if (live.current.streaming) return
    const kept = run.kept
    run.kept = null
    const sound = kept ? joined(kept.samples, samples, Math.round((MAX_TURN_MS / 1000) * run.context.sampleRate)) : samples
    const body = new FormData()
    body.append("audio", new Blob([encodeWav16k(sound, run.context.sampleRate)], { type: "audio/wav" }), "turn.wav")
    if (run.chatId) body.append("threadId", run.chatId)
    if (run.temporary) body.append("temporary", "true")
    exchange(run, "turn", body, { samples: sound, takeBacks: kept?.times || 0 })
  }

  // The person went on talking before the Agent had started on an answer: the turn is taken back, and goes again
  // with what they add when they pause. What was heard of it so far stays in the chat until the whole turn is.
  function resume(run) {
    const turn = run.turn
    run.kept = { samples: turn.samples, times: turn.takeBacks + 1 }
    run.turn = null
    turn.abort.abort()
    run.player.stop()
    setWorking(false)
    setState("listening")
    setAsking(false)
    setStatus("")
    setCaption("")
  }

  // Someone spoke over the Agent: it stops, and what is being said becomes the next turn.
  function interrupt(run) {
    drop(run)
    listen()
  }

  // Each moment of sound from the microphone. Speaking over the Agent stops it once it has started on an answer (a
  // looked-up one a moment later, see INTERRUPT_AFTER_MS), also while it works on it in silence, and during its
  // hello; its own voice coming back in does not (bargeIn.js). The sound is dropped while muted, and while a turn
  // that can no longer be taken back is still being decided.
  function hear(run, frame) {
    if (runRef.current !== run) return
    const turn = run.turn
    const undecided = Boolean(turn?.spoken && !turn.routed)
    const unanswered = undecided && turn.takeBacks < MAX_TAKE_BACKS
    const shut = run.muted || (undecided && !unanswered)
    const stoppable = Boolean(turn) && !shut && !undecided && (turn.spoken ? !turn.asked || performance.now() - turn.routedAt >= INTERRUPT_AFTER_MS : run.player.playing)
    const echo = run.guard.push(loudness(frame), run.player.far(), stoppable, run.detector.threshold)
    if (echo.action === "duck") run.player.duck(true)
    else if (echo.action === "restore" || echo.action === "echo") run.player.duck(false)
    if (shut || echo.action === "mistaken" || echo.action === "echo") {
      // (Mistaken or echo: what was heard was the Agent's own voice, so nothing was said.)
      if (run.hearing || echo.action) run.detector.reset()
      run.echoTurn = false
      run.hearing = !shut
      return
    }
    run.hearing = true
    const was = run.detector.speaking
    const ended = run.detector.push(frame, echo.floor)
    // Sound that starts while the Agent's voice can be heard is taken for its echo, until someone is heard in a quiet
    // moment or the echo guard says someone spoke over it.
    if (!was && run.detector.speaking) run.echoTurn = echo.floor > 0
    if (echo.floor === 0 && run.detector.level > run.detector.threshold) run.echoTurn = false
    if (echo.action === "interrupt") {
      run.echoTurn = false
      if (run.turn) interrupt(run)
    } else if (unanswered && run.turn && run.detector.speaking && run.detector.speechMs >= RESUME_MS) resume(run)
    if (ended) {
      // Not a turn: sound heard while the Agent went on answering, or the Agent's own voice.
      if (!run.turn && !run.echoTurn) send(run, ended.samples)
      run.echoTurn = false
    }
    // A sound too short to be a turn (a cough) took the turn back: it goes again as it was.
    else if (was && !run.detector.speaking && run.kept && !run.turn) send(run, NO_SOUND)
  }

  // The microphone feeds the turn detector, and the Agent's voice gets its player.
  function connect(run) {
    const { context, stream } = run
    const frame = frameSize(context.sampleRate)
    run.detector = createTurnDetector({ sampleRate: context.sampleRate, maxTurnMs: MAX_TURN_MS })
    run.guard = createBargeIn({ frameMs: (frame / context.sampleRate) * 1000 })
    run.player = createVoicePlayer({
      onPlaying: (playing) => {
        if (runRef.current === run && run.turn) setState(playing ? "speaking" : run.turn.spoken ? "thinking" : "starting")
      },
    })
    run.source = context.createMediaStreamSource(stream)
    // ScriptProcessor works in every browser, including Safari on iPhone.
    run.processor = context.createScriptProcessor(frame, 1, 1)
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
    const run = { context, chatId: live.current.threadId, temporary: live.current.temporary, muted: false, hearing: false, echoTurn: false, failures: 0, turns: 0, turn: null, kept: null }
    runRef.current = run
    setError("")
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
    listen()
  }, [])

  const end = useCallback(() => finish(), [])

  // Mute: the microphone stops listening until it is unmuted. (Stop still stops an answer.)
  const mute = useCallback((on) => {
    const run = runRef.current
    if (!run) return
    run.muted = Boolean(on)
    setMuted(run.muted)
    // A turn that was taken back and is waiting for the rest goes as it is: nothing more will be heard for now.
    if (run.muted && run.kept && !run.turn) send(run, NO_SOUND)
  }, [])

  // How loud the sound is now, from 0 to 1, for the circle: the Agent's voice while it speaks, else the microphone.
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
    error,
    muted,
    setMuted: mute,
    // A spoken turn is with the Agent and shows in the chat: the chat shows it at work under it.
    working,
    level,
    start,
    stop,
    end,
  }
}
