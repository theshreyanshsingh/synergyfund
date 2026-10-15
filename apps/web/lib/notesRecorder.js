"use client"

import { audioContext } from "./sounds"

// AI notes: while they are on, this listens to your own microphone (the one the call already uses) and sends what
// you say, a piece at a time, to be transcribed. Silence is never sent, and nothing is sent while you are muted
// (a muted microphone is silent). Each piece is cut at a pause, or after 25 seconds of talking.

const RATE = 16000
const FRAME = 4096
const PAUSE_MS = 900
const MIN_PIECE_MS = 1200
const MAX_PIECE_MS = 25000
const MIN_SPEECH_MS = 450
const PRE_ROLL_MS = 400

let active = null

export function notesRecording() {
  return active ? active.noteId : ""
}

// Starts (or moves to a new microphone track) for these notes.
export function startNotesRecording(noteId, track) {
  if (!noteId || !track || track.readyState !== "live") return false
  if (active && active.noteId === noteId && active.track === track) return true
  if (active) stopNotesRecording()
  const context = audioContext()
  if (!context) return false
  context.resume?.().catch(() => {})
  // A phone may keep sound asleep until the screen is touched (someone else turned notes on); wake it on the next tap.
  if (context.state !== "running") document.addEventListener("pointerdown", () => context.resume?.().catch(() => {}), { once: true, capture: true })
  const source = context.createMediaStreamSource(new MediaStream([track]))
  // ScriptProcessor works in every browser that can make calls, including Safari on iPhone.
  const processor = context.createScriptProcessor(FRAME, 1, 1)
  const silent = context.createGain()
  silent.gain.value = 0
  source.connect(processor)
  processor.connect(silent)
  silent.connect(context.destination)
  const run = {
    noteId,
    track,
    context,
    source,
    processor,
    silent,
    rate: context.sampleRate,
    frames: [],
    preRoll: [],
    speaking: false,
    pieceMs: 0,
    speechMs: 0,
    quietMs: 0,
    noise: 0.004,
  }
  processor.onaudioprocess = (event) => listen(run, event.inputBuffer.getChannelData(0))
  active = run
  return true
}

// Stops listening and sends what was said up to now.
export function stopNotesRecording() {
  const run = active
  if (!run) return
  active = null
  finish(run)
  run.processor.onaudioprocess = null
  try {
    run.source.disconnect()
    run.processor.disconnect()
    run.silent.disconnect()
  } catch {}
}

function listen(run, input) {
  const frame = new Float32Array(input)
  const ms = (frame.length / run.rate) * 1000
  let sum = 0
  for (let index = 0; index < frame.length; index += 1) sum += frame[index] * frame[index]
  const level = Math.sqrt(sum / frame.length)
  // Speech is well above the room's background level. That level follows quiet moments down quickly and creeps up
  // slowly, so steady noise (a fan, traffic) soon stops counting as speech, while normal talking with pauses does.
  const threshold = Math.max(0.012, run.noise * 3.2)
  const speech = level > threshold
  if (level < run.noise) run.noise = run.noise * 0.7 + level * 0.3
  else run.noise = run.noise * 0.997 + level * 0.003
  if (!run.speaking) {
    run.preRoll.push(frame)
    let kept = run.preRoll.reduce((total, item) => total + item.length, 0)
    while (run.preRoll.length > 1 && (kept / run.rate) * 1000 > PRE_ROLL_MS) kept -= run.preRoll.shift().length
    if (!speech) return
    run.speaking = true
    run.frames = run.preRoll
    run.preRoll = []
    run.pieceMs = (kept / run.rate) * 1000
    run.speechMs = ms
    run.quietMs = 0
    return
  }
  run.frames.push(frame)
  run.pieceMs += ms
  if (speech) {
    run.speechMs += ms
    run.quietMs = 0
  } else {
    run.quietMs += ms
  }
  if ((run.quietMs >= PAUSE_MS && run.pieceMs >= MIN_PIECE_MS) || run.pieceMs >= MAX_PIECE_MS) finish(run)
}

function finish(run) {
  const frames = run.frames
  const speechMs = run.speechMs
  run.frames = []
  run.speaking = false
  run.pieceMs = 0
  run.speechMs = 0
  run.quietMs = 0
  if (!frames.length || speechMs < MIN_SPEECH_MS) return
  const wav = encodeWav(resample(frames, run.rate))
  const durationMs = Math.round((wav.samples / RATE) * 1000)
  send(run, wav.blob, durationMs, performance.now())
}

// Joins the frames and converts them to 16 kHz, which is plenty for speech and keeps each piece small.
function resample(frames, rate) {
  const length = frames.reduce((total, frame) => total + frame.length, 0)
  const input = new Float32Array(length)
  let offset = 0
  for (const frame of frames) {
    input.set(frame, offset)
    offset += frame.length
  }
  if (rate === RATE) return input
  const ratio = rate / RATE
  const output = new Float32Array(Math.floor(length / ratio))
  for (let index = 0; index < output.length; index += 1) {
    const position = index * ratio
    const left = Math.floor(position)
    const right = Math.min(left + 1, length - 1)
    const weight = position - left
    output[index] = input[left] * (1 - weight) + input[right] * weight
  }
  return output
}

function encodeWav(samples) {
  const buffer = new ArrayBuffer(44 + samples.length * 2)
  const view = new DataView(buffer)
  const text = (at, value) => { for (let index = 0; index < value.length; index += 1) view.setUint8(at + index, value.charCodeAt(index)) }
  text(0, "RIFF")
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, RATE, true)
  view.setUint32(28, RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, samples.length * 2, true)
  for (let index = 0; index < samples.length; index += 1) {
    const value = Math.max(-1, Math.min(1, samples[index]))
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return { blob: new Blob([buffer], { type: "audio/wav" }), samples: samples.length }
}

async function send(run, blob, durationMs, endedAt) {
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const body = new FormData()
    body.set("durationMs", String(durationMs))
    // How long ago this piece ended, so the server places it in time by its own clock.
    body.set("endedAgoMs", String(Math.round(performance.now() - endedAt)))
    body.set("audio", blob, "speech.wav")
    try {
      const response = await fetch(`/api/calls/notes/${run.noteId}/audio`, { method: "POST", body, credentials: "same-origin" })
      // 409: notes are off; 403/404: not part of them any more. Nothing to retry.
      if (response.ok || response.status === 409 || response.status === 403 || response.status === 404) return
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 1500))
  }
}
