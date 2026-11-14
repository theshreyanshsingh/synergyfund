// Talk mode's ears: from the microphone's sound, when the person starts speaking and when their turn is over (they
// pause). It imports nothing and uses nothing from the browser, so it can be checked on its own.
//
// Sound comes in a frame at a time (about a tenth of a second each). A frame is speech when it is well above the
// room's background level. That level follows quiet moments down quickly and creeps up slowly, so steady noise (a
// fan, traffic) soon stops counting as speech, while normal talking with pauses does.

const WAV_RATE = 16000
// How much of the pause that ends a turn stays on its end, so the last word is not clipped.
const TAIL_MS = 250

// How loud a frame of sound is (0 to 1).
export function loudness(frame) {
  let sum = 0
  for (let index = 0; index < frame.length; index += 1) sum += frame[index] * frame[index]
  return frame.length ? Math.sqrt(sum / frame.length) : 0
}

// The first `count` samples of these frames, as one piece.
function join(frames, count) {
  const output = new Float32Array(Math.max(0, count))
  let offset = 0
  for (const frame of frames) {
    if (offset >= output.length) break
    const part = frame.length > output.length - offset ? frame.subarray(0, output.length - offset) : frame
    output.set(part, offset)
    offset += part.length
  }
  return output
}

// `pauseMs`: the silence after speech that ends a turn. `minSpeechMs`: less speech than this (a click, a cough) is
// dropped. `preRollMs`: how much sound from just before the first syllable a turn keeps. `maxTurnMs`: a turn is cut
// here even if the person is still talking.
// push(frame, floor) takes the next frame of sound (numbers from -1 to 1) and gives null, or the turn that has just
// ended: { samples, ms }, the sound from just before the first syllable to a moment after the last, at `sampleRate`.
// `floor`: sound up to this level is not speech now (the Agent's own voice coming back in, see bargeIn.js).
// reset() forgets a turn that is under way (the room's background level is kept). `speaking` says whether a turn is
// under way, `speechMs` how much speech it holds so far, and `level` how loud the last frame was.
export function createTurnDetector({ sampleRate, pauseMs = 800, minSpeechMs = 300, preRollMs = 400, maxTurnMs = 60000 }) {
  const msOf = (count) => (count / sampleRate) * 1000
  const countOf = (ms) => Math.round((ms / 1000) * sampleRate)
  const longest = countOf(maxTurnMs)
  let noise = 0.004
  let level = 0
  let speaking = false
  let frames = []
  let length = 0
  let preRoll = []
  let speechMs = 0
  let quietMs = 0

  function reset() {
    speaking = false
    frames = []
    length = 0
    preRoll = []
    speechMs = 0
    quietMs = 0
  }

  // While nobody speaks the last moments are kept, so a turn starts just before its first syllable.
  function remember(frame) {
    preRoll.push(frame)
    const want = countOf(preRollMs)
    let kept = preRoll.reduce((total, item) => total + item.length, 0)
    while (preRoll.length > 1 && kept - preRoll[0].length >= want) kept -= preRoll.shift().length
    if (kept > want) preRoll[0] = preRoll[0].subarray(kept - want)
    return null
  }

  function begin(frame) {
    speaking = true
    frames = [...preRoll, frame]
    length = frames.reduce((total, item) => total + item.length, 0)
    preRoll = []
    speechMs = msOf(frame.length)
    quietMs = 0
    return length >= longest ? finish() : null
  }

  // The turn, without most of the pause that ended it and never longer than the longest turn.
  function finish() {
    const spoken = speechMs
    const pause = Math.max(0, countOf(quietMs - TAIL_MS))
    const samples = join(frames, Math.min(length - pause, longest))
    reset()
    if (spoken < minSpeechMs) return null
    return { samples, ms: msOf(samples.length) }
  }

  function push(input, floor = 0) {
    // The browser reuses the frame it hands over, so it is copied.
    const frame = new Float32Array(input)
    level = loudness(frame)
    const speech = level > Math.max(0.012, noise * 3.2, floor)
    if (level < noise) noise = noise * 0.7 + level * 0.3
    // (The Agent's own voice is not the room's background level.)
    else if (!floor) noise = noise * 0.997 + level * 0.003
    if (!speaking) return speech ? begin(frame) : remember(frame)
    frames.push(frame)
    length += frame.length
    if (speech) {
      speechMs += msOf(frame.length)
      quietMs = 0
    } else {
      quietMs += msOf(frame.length)
    }
    return quietMs >= pauseMs || length >= longest ? finish() : null
  }

  return {
    push,
    reset,
    get speaking() {
      return speaking
    },
    get speechMs() {
      return speechMs
    },
    get level() {
      return level
    },
    // Sound above this is speech, apart from any floor given with it.
    get threshold() {
      return Math.max(0.012, noise * 3.2)
    },
  }
}

// To 16,000 samples a second. Going down, each new sample is the average of the ones it stands for (which keeps hiss
// above the voice from folding into it); going up, it sits on the line between its two neighbours.
function resample(input, rate) {
  if (rate === WAV_RATE) return input
  const ratio = rate / WAV_RATE
  const output = new Float32Array(Math.floor(input.length / ratio))
  for (let index = 0; index < output.length; index += 1) {
    output[index] = ratio > 1 ? average(input, Math.floor(index * ratio), Math.floor((index + 1) * ratio)) : between(input, index * ratio)
  }
  return output
}

function average(input, from, to) {
  const end = Math.min(input.length, Math.max(from + 1, to))
  let sum = 0
  for (let index = from; index < end; index += 1) sum += input[index]
  return sum / (end - from)
}

function between(input, position) {
  const left = Math.floor(position)
  const right = Math.min(left + 1, input.length - 1)
  const weight = position - left
  return input[left] * (1 - weight) + input[right] * weight
}

// One turn as a WAV file (a Uint8Array): 16,000 samples a second, one channel, 16 bits a sample. That is plenty for
// speech and keeps the upload small. `sampleRate` is the rate `samples` were recorded at.
export function encodeWav16k(samples, sampleRate) {
  const sound = resample(samples, sampleRate)
  const bytes = new Uint8Array(44 + sound.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at, value) => { for (let index = 0; index < value.length; index += 1) view.setUint8(at + index, value.charCodeAt(index)) }
  text(0, "RIFF")
  view.setUint32(4, 36 + sound.length * 2, true)
  text(8, "WAVE")
  text(12, "fmt ")
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, WAV_RATE, true)
  view.setUint32(28, WAV_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, "data")
  view.setUint32(40, sound.length * 2, true)
  for (let index = 0; index < sound.length; index += 1) {
    const value = Math.max(-1, Math.min(1, sound[index]))
    view.setInt16(44 + index * 2, value < 0 ? value * 0x8000 : value * 0x7fff, true)
  }
  return bytes
}
