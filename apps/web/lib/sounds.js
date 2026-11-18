import { DEFAULT_SOUNDS, cleanSounds } from "@synergifund/shared"

// Sounds made in the browser, so there are no audio files to load: the ringtone for incoming calls, the ringback
// while you call someone, the chime for new messages, and the Agent's small sounds. Browsers only allow sound after the
// person has tapped or typed once; unlockSounds does that on the first interaction.

let audio = null
let prefs = { ...DEFAULT_SOUNDS }
let loop = { kind: "", timer: null }
let lastChime = 0

function context() {
  if (typeof window === "undefined") return null
  if (!audio) {
    const Context = window.AudioContext || window.webkitAudioContext
    if (!Context) return null
    audio = new Context()
  }
  if (audio.state !== "running") audio.resume().catch(() => {})
  return audio
}

export function unlockSounds() {
  context()
}

// The one audio context, shared with the call screen's speaking indicator.
export function audioContext() {
  return context()
}

export function soundsReady() {
  return audio?.state === "running"
}

// The person's choices from Settings, kept here so every sound uses them.
export function setSoundPrefs(value) {
  prefs = cleanSounds(value)
}

// A struck note: a few sine partials with a quick attack and a natural fade, like a marimba bar or a bell.
function strike(ctx, at, frequency, { length = 0.6, volume = 0.08, partials = [[1, 1]] } = {}) {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.006)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + length)
  gain.connect(ctx.destination)
  for (const [ratio, level] of partials) {
    const oscillator = ctx.createOscillator()
    const share = ctx.createGain()
    share.gain.value = level
    oscillator.frequency.setValueAtTime(frequency * ratio, at)
    oscillator.connect(share)
    share.connect(gain)
    oscillator.start(at)
    oscillator.stop(at + length + 0.05)
  }
}

// A flat electronic tone, used by the old beep and the ringback.
function tone(ctx, at, frequencies, seconds, volume) {
  const gain = ctx.createGain()
  gain.gain.setValueAtTime(0, at)
  gain.gain.linearRampToValueAtTime(volume, at + 0.02)
  gain.gain.setValueAtTime(volume, at + seconds - 0.05)
  gain.gain.linearRampToValueAtTime(0, at + seconds)
  gain.connect(ctx.destination)
  for (const frequency of frequencies) {
    const oscillator = ctx.createOscillator()
    oscillator.frequency.setValueAtTime(frequency, at)
    oscillator.connect(gain)
    oscillator.start(at)
    oscillator.stop(at + seconds)
  }
}

const MARIMBA = [[1, 1], [3.93, 0.12]]
const BELL = [[1, 1], [2, 0.32], [3.01, 0.14], [4.17, 0.08]]
const GLASS = [[1, 1], [2, 0.18]]

// Each ringtone is one ring, repeated every `every` milliseconds while the call rings.
const RINGTONES = {
  marimba: { every: 2600, play: (ctx, at) => [[0, 523.25], [0.14, 659.25], [0.28, 783.99], [0.42, 1046.5], [0.7, 783.99], [0.84, 1046.5]].forEach(([time, note]) => strike(ctx, at + time, note, { length: 0.5, volume: 0.11, partials: MARIMBA })) },
  classic: {
    every: 3000,
    play: (ctx, at) => {
      for (const start of [0, 0.55]) {
        for (let index = 0; index < 8; index += 1) strike(ctx, at + start + index * 0.05, index % 2 ? 1318.51 : 1046.5, { length: 0.09, volume: 0.06, partials: [[1, 1], [2.76, 0.18]] })
      }
    },
  },
  bells: { every: 3000, play: (ctx, at) => [[0, 880], [0.32, 1318.51], [0.64, 1108.73]].forEach(([time, note]) => strike(ctx, at + time, note, { length: 1.4, volume: 0.07, partials: BELL })) },
  pulse: { every: 2200, play: (ctx, at) => [[0, 587.33], [0.18, 739.99], [0.36, 880]].forEach(([time, note]) => strike(ctx, at + time, note, { length: 0.28, volume: 0.1, partials: GLASS })) },
  beep: {
    every: 2500,
    play: (ctx, at) => {
      tone(ctx, at, [660, 880], 0.35, 0.08)
      tone(ctx, at + 0.45, [660, 880], 0.35, 0.08)
    },
  },
  off: { every: 2500, play: () => {} },
}

const RINGBACK = { every: 3500, play: (ctx, at) => tone(ctx, at, [440, 480], 1.2, 0.04) }

const CHIMES = {
  chime: (ctx, at) => {
    strike(ctx, at, 783.99, { length: 0.6, volume: 0.07, partials: GLASS })
    strike(ctx, at + 0.11, 1046.5, { length: 0.8, volume: 0.07, partials: GLASS })
  },
  pop: (ctx, at) => {
    const oscillator = ctx.createOscillator()
    const gain = ctx.createGain()
    oscillator.frequency.setValueAtTime(880, at)
    oscillator.frequency.exponentialRampToValueAtTime(260, at + 0.09)
    gain.gain.setValueAtTime(0.0001, at)
    gain.gain.exponentialRampToValueAtTime(0.12, at + 0.005)
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.14)
    oscillator.connect(gain)
    gain.connect(ctx.destination)
    oscillator.start(at)
    oscillator.stop(at + 0.16)
  },
  bell: (ctx, at) => strike(ctx, at, 1174.66, { length: 1.2, volume: 0.06, partials: BELL }),
  marimba: (ctx, at) => {
    strike(ctx, at, 659.25, { length: 0.45, volume: 0.1, partials: MARIMBA })
    strike(ctx, at + 0.12, 987.77, { length: 0.5, volume: 0.1, partials: MARIMBA })
  },
  off: () => {},
}

// A note that slides from one pitch to another, for the Agent's send.
function sweep(ctx, at, from, to, seconds, volume) {
  const oscillator = ctx.createOscillator()
  const gain = ctx.createGain()
  oscillator.frequency.setValueAtTime(from, at)
  oscillator.frequency.exponentialRampToValueAtTime(to, at + seconds)
  gain.gain.setValueAtTime(0.0001, at)
  gain.gain.exponentialRampToValueAtTime(volume, at + 0.012)
  gain.gain.exponentialRampToValueAtTime(0.0001, at + seconds + 0.06)
  oscillator.connect(gain)
  gain.connect(ctx.destination)
  oscillator.start(at)
  oscillator.stop(at + seconds + 0.08)
}

const SOFT = [[1, 1], [2, 0.1], [3.93, 0.04]]
const notes = (ctx, at, list, options) => list.forEach(([time, note, volume]) => strike(ctx, at + time, note, { ...options, volume: volume ?? options.volume }))

// The Agent's sounds: short, soft and well under the chime, so they mark what happened without getting in the way.
const AGENT_SOUNDS = {
  // A question goes: a quick rising whisk.
  send: (ctx, at) => sweep(ctx, at, 440, 990, 0.08, 0.045),
  // The answer is in: two soft glass notes.
  reply: (ctx, at) => notes(ctx, at, [[0, 659.25], [0.09, 987.77, 0.026]], { length: 0.65, volume: 0.032, partials: GLASS }),
  // The microphone opens to write down what is said, and closes again.
  listen: (ctx, at) => notes(ctx, at, [[0, 587.33], [0.07, 880]], { length: 0.24, volume: 0.045, partials: GLASS }),
  listened: (ctx, at) => notes(ctx, at, [[0, 880], [0.07, 587.33]], { length: 0.24, volume: 0.04, partials: GLASS }),
  // Talk starts: three warm notes rising, like the Agent picking up; and falling when it ends.
  talk: (ctx, at) => notes(ctx, at, [[0, 392], [0.11, 587.33], [0.22, 783.99, 0.04]], { length: 0.8, volume: 0.05, partials: SOFT }),
  talkEnd: (ctx, at) => notes(ctx, at, [[0, 783.99, 0.04], [0.11, 587.33], [0.22, 392]], { length: 0.8, volume: 0.05, partials: SOFT }),
  // A thumb or a copy: a tiny tick.
  tap: (ctx, at) => strike(ctx, at, 1567.98, { length: 0.07, volume: 0.028 }),
}

// One of the Agent's sounds, unless the person turned them off in Settings, a call is ringing, or the page is hidden.
export function playAgentSound(name) {
  if (prefs.agent === "off" || loop.kind === "incoming" || !AGENT_SOUNDS[name]) return
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return
  const ctx = context()
  if (!ctx || ctx.state !== "running") return
  AGENT_SOUNDS[name](ctx, ctx.currentTime + 0.01)
}

// Settings' Play button for the Agent's sounds: a question going and its answer arriving.
export function previewAgentSounds() {
  const ctx = context()
  if (!ctx) return
  AGENT_SOUNDS.send(ctx, ctx.currentTime + 0.05)
  AGENT_SOUNDS.reply(ctx, ctx.currentTime + 0.55)
}

// Rings until stopped: "incoming" uses the person's ringtone, "outgoing" the ringback while they wait for an answer.
export function playLoop(kind) {
  const ctx = context()
  if (!ctx || loop.kind === kind) return
  stopLoop()
  loop.kind = kind
  const cycle = () => {
    const sound = kind === "incoming" ? RINGTONES[prefs.ringtone] || RINGTONES.marimba : RINGBACK
    if (ctx.state === "running") sound.play(ctx, ctx.currentTime + 0.02)
    if (kind === "incoming" && typeof navigator !== "undefined" && navigator.vibrate) navigator.vibrate([300, 150, 300])
    loop.timer = setTimeout(cycle, sound.every)
  }
  cycle()
}

export function stopLoop() {
  clearTimeout(loop.timer)
  loop = { kind: "", timer: null }
}

// A new message or notification. Quiet while a call is ringing, and at most once every second and a half.
export function playChime() {
  const ctx = context()
  if (!ctx || ctx.state !== "running" || loop.kind === "incoming") return
  const now = Date.now()
  if (now - lastChime < 1500) return
  lastChime = now
  ;(CHIMES[prefs.chime] || CHIMES.chime)(ctx, ctx.currentTime + 0.02)
}

// Play buttons in Settings: one ring of a ringtone, or a chime, right now.
export function previewRingtone(id) {
  const ctx = context()
  if (!ctx) return
  ;(RINGTONES[id] || RINGTONES.marimba).play(ctx, ctx.currentTime + 0.05)
  if (id === "off" && navigator.vibrate) navigator.vibrate([300, 150, 300])
}

export function previewChime(id) {
  const ctx = context()
  if (!ctx) return
  ;(CHIMES[id] || CHIMES.chime)(ctx, ctx.currentTime + 0.05)
}
