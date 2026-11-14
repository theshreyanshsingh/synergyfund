"use client"

import { DUCKED } from "./bargeIn"
import { audioContext } from "./sounds"

// The Agent's voice in Talk mode. Its speech arrives in small pieces while the rest is still on its way. Each piece is
// set to start at the exact moment the one before it ends, so the voice plays without gaps or overlaps.

const RATE = 24000
// The first piece (and the first after a hold-up) starts this many seconds ahead, so the next one has time to arrive.
const LEAD = 0.08
// The voice counts as silent once nothing has played for this long; a short hold-up between pieces does not.
const QUIET_MS = 250
// If the phone has put sound to sleep the pieces never finish; this long after they should have, they are dropped.
const LATE_MS = 1500

// A piece as the server sends it (base64 of 16-bit samples, low byte first) as the numbers the browser plays.
function samplesOf(base64) {
  let text = ""
  try {
    text = atob(String(base64 || ""))
  } catch {}
  const samples = new Float32Array(text.length >> 1)
  for (let index = 0; index < samples.length; index += 1) {
    const value = text.charCodeAt(index * 2) | (text.charCodeAt(index * 2 + 1) << 8)
    samples[index] = (value > 0x7fff ? value - 0x10000 : value) / 0x8000
  }
  return samples
}

// `onPlaying(true | false)`: the voice has started, or has fallen silent.
// push(base64) plays the next piece after the ones before it. drained() waits until everything handed over so far
// has been heard. stop() silences the voice at once. level() is how loud it is now (0 to 1, for the circle) and
// far() the same as the plain loudness of the last tenth of a second (for telling its echo from someone speaking).
// duck(true | false) turns it down for a moment, and up again (to DUCKED, while bargeIn.js checks whether someone
// is speaking over it). close() is for when Talk mode ends. Gives null when
// this browser cannot play sound.
export function createVoicePlayer({ onPlaying } = {}) {
  const context = audioContext()
  if (!context) return null
  const output = context.createAnalyser()
  output.fftSize = 4096
  output.connect(context.destination)
  const volume = context.createGain()
  volume.connect(output)
  const wave = new Float32Array(output.fftSize)
  const sources = new Set()
  let next = 0
  let playing = false
  let quiet = null
  let waiting = []

  function tell(now) {
    clearTimeout(quiet)
    if (playing === now) return
    playing = now
    onPlaying?.(now)
  }

  function release() {
    for (const done of waiting.splice(0)) done()
  }

  function ended(source) {
    sources.delete(source)
    source.disconnect()
    if (sources.size) return
    release()
    quiet = setTimeout(() => tell(false), QUIET_MS)
  }

  function push(base64) {
    const samples = samplesOf(base64)
    if (!samples.length) return
    // A phone may have put sound to sleep (a call came in, the screen locked); wake it.
    if (context.state !== "running") context.resume?.().catch(() => {})
    const buffer = context.createBuffer(1, samples.length, RATE)
    buffer.getChannelData(0).set(samples)
    const source = context.createBufferSource()
    source.buffer = buffer
    source.connect(volume)
    source.onended = () => ended(source)
    const at = next > context.currentTime ? next : context.currentTime + LEAD
    source.start(at)
    next = at + buffer.duration
    sources.add(source)
    tell(true)
  }

  function stop() {
    for (const source of sources) {
      source.onended = null
      try {
        source.stop()
      } catch {}
      source.disconnect()
    }
    sources.clear()
    next = 0
    duck(false)
    release()
    tell(false)
  }

  function duck(down) {
    volume.gain.cancelScheduledValues(context.currentTime)
    // (With nothing playing it is put back at once, so the next answer starts at full volume.)
    if (!down && !sources.size) volume.gain.value = 1
    else volume.gain.setTargetAtTime(down ? DUCKED : 1, context.currentTime, 0.012)
  }

  function drained() {
    if (!sources.size) return Promise.resolve()
    return new Promise((resolve) => {
      const late = setTimeout(stop, Math.max(0, next - context.currentTime) * 1000 + LATE_MS)
      waiting.push(() => {
        clearTimeout(late)
        resolve()
      })
    })
  }

  function far() {
    if (!sources.size) return 0
    output.getFloatTimeDomainData(wave)
    let sum = 0
    for (const value of wave) sum += value * value
    return Math.sqrt(sum / wave.length)
  }

  function level() {
    return Math.min(1, far() * 4)
  }

  function close() {
    stop()
    volume.disconnect()
    output.disconnect()
  }

  return {
    push,
    drained,
    stop,
    level,
    far,
    duck,
    close,
    get playing() {
      return playing
    },
  }
}
