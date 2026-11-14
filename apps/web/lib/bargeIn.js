// Talking over the Agent, also on loudspeakers. While the Agent's voice plays, some of it comes back in through the
// microphone: next to nothing with headphones or a good echo canceller, a good deal from loudspeakers without one.
// This tells a person's voice from that echo, so that speaking over the Agent stops it and its own voice never does.
// It imports nothing and uses nothing from the browser, so it can be checked on its own.
//
// It learns how much of the Agent's voice reaches the microphone (first while the hello plays, then whenever the
// Agent speaks and nobody else does) and takes sound up to a margin above that for echo. Louder sound, kept up for a
// moment, is someone speaking:
// - far above the echo, it is plainly a person, and the Agent stops at once;
// - only a little above it, the Agent's voice is turned down for a moment: an echo falls with it, a person's voice
//   does not;
// - and if what stopped the Agent falls silent the moment the Agent does, it was the Agent's own voice after all,
//   and what was recorded of it is thrown away.
// Each mistake teaches it that the echo can be that loud. While none of the Agent's voice is playing (it is working
// on an answer), there is no echo: someone speaking stops it straight away.

// How far the Agent's voice is turned down while it is checked (voicePlayer.js uses it). A person's voice then shows
// 1 / DUCKED times as much of the Agent's level as before, an echo as much as before; the check takes the middle.
export const DUCKED = 0.15
const JUMP = Math.sqrt(1 / DUCKED)
// A jump this big is a person beyond doubt; a smaller one is looked at again once the Agent is quiet.
const SURE_JUMP = 0.75 / DUCKED

// Quieter than this is never speech (the turn detector's own limit).
const SPEECH_MIN = 0.012
// The Agent's voice counts as playing above this level.
const VOICE_MIN = 0.01

// `frameMs`: how long one frame of sound is. `margin`: how far above the learned echo a sound must be to count as
// someone speaking. `sure`: how many times louder still it must be for the Agent to stop without checking.
//
// push(near, far, allow, quiet) takes one frame: how loud the microphone was, how loud the Agent's voice is, whether
// the Agent may be interrupted now, and the level above which the microphone's sound is speech in a quiet moment
// (the turn detector's, which follows the room). It gives { floor, action }:
//   floor: microphone sound up to this level is the Agent's own voice, not speech (Infinity while it is learning);
//   action: null, or "duck" (turn the Agent's voice down), "restore" (turn it up again), "echo" (what was being
//   checked was the Agent's own voice: turn it up again, and forget what was recorded meanwhile), "interrupt"
//   (someone is speaking: stop the Agent), "mistaken" (the last interruption was the Agent's own voice: forget what
//   was recorded).
export function createBargeIn({ frameMs, margin = 1.7, sure = 4, learnMs = 900, holdMs = 340, triggerMs = 170, measureMs = 260, afterMs = 340, steadyMs = 500, restMs = 1500, tailMs = 600 } = {}) {
  const frames = (ms) => Math.max(1, Math.round(ms / frameMs))
  const HOLD = frames(holdMs)
  const LEARN = frames(learnMs)
  const TRIGGER = Math.max(2, frames(triggerMs))
  const MEASURE = Math.max(2, frames(measureMs))
  const AFTER = Math.max(3, frames(afterMs))
  const STEADY = frames(steadyMs)
  const REST = frames(restMs)
  // How long after the Agent's voice stops its echo may still be arriving (a slow loudspeaker, Bluetooth).
  const TAIL = Math.max(HOLD + 1, frames(tailMs))
  // How much of the Agent's level shows up in the microphone (microphone level / Agent's level).
  let coupling = 0
  let learnt = 0
  // The Agent's level over the last moments (TAIL frames): its echo arrives a little after it plays.
  let fars = []
  // Frames in a row above the echo, the most they showed of the Agent's level, and the sound and the Agent's level
  // summed over them.
  let run = 0
  let shown = 0
  let runNear = 0
  let runHeld = 0
  // Frames in a row, while the Agent spoke, that were its echo and nothing more: only then is a much louder sound
  // plainly a person. (After a silence the echo may have changed: someone turned the volume up.)
  let steady = 0
  let silent = 0
  // Frames in a row far below the learned echo: it was learned too high (someone spoke while it was).
  let low = 0
  // Checking: frames since the Agent's voice was turned down (0: not checking), and the sound and the Agent's level
  // summed since.
  let checking = 0
  let sinceNear = 0
  let sinceHeld = 0
  // The Agent's voice ended while it was being checked: frames since (0: not waiting). Someone still speaking once it
  // has died away was a person; quiet means it was the echo.
  let pending = 0
  // Frames in a row loud enough to be speech once none of the Agent's voice, or its echo, can be heard.
  let loud = 0
  // After an interruption: frames since, and whether anyone was heard once the Agent's voice had died away.
  let after = 0
  let someone = false

  function calm() {
    run = 0
    shown = 0
    runNear = 0
    runHeld = 0
    pending = 0
  }

  // The echo can be as loud as what has just been taken for a person.
  function learn() {
    coupling = Math.max(coupling, (shown / margin) * 1.5)
    steady = 0
    low = 0
  }

  function push(near, far, allow = true, quiet = SPEECH_MIN) {
    fars.push(far)
    if (fars.length > TAIL) fars.shift()
    const held = Math.max(...fars.slice(-HOLD))
    // Nothing of the Agent's voice for a while: none of its echo can still be arriving.
    const gone = Math.max(...fars) < VOICE_MIN
    const speech = Math.max(SPEECH_MIN, quiet)
    loud = gone && near > speech ? loud + 1 : 0

    if (after) {
      // The Agent has just been stopped. What is left of its voice dies away; a person who spoke over it goes on
      // longer than that.
      after += 1
      if (after > TAIL && near > speech) someone = true
      if (after > TAIL + AFTER) {
        after = 0
        if (!someone) {
          learn()
          calm()
          return { floor: 0, action: "mistaken" }
        }
        steady = 0
        calm()
      }
      return { floor: 0, action: null }
    }

    if (held < VOICE_MIN) {
      // The Agent's voice has stopped (it ended, or paused).
      silent += 1
      if (silent > REST) steady = 0
      let action = null
      if (checking) {
        // Its voice ended while it was being checked (the hold line, say): what comes now decides.
        checking = 0
        pending = 1
        action = "restore"
      }
      // Its echo may still be arriving: nothing is decided yet, and sound up to where its voice was is not speech.
      if (!gone) return { floor: margin * coupling * Math.max(...fars), action }
      // None of it can be heard now: what is heard is the room, or a person.
      if (loud >= TRIGGER && allow) {
        calm()
        loud = 0
        return { floor: 0, action: "interrupt" }
      }
      if (pending) {
        pending += 1
        if (!loud && pending > MEASURE) {
          // Quiet as soon as the Agent was: it was the Agent's own voice.
          learn()
          calm()
          return { floor: 0, action: "echo" }
        }
        // Someone was speaking, but the Agent may not be stopped now: nothing is learned.
        if (pending > MEASURE * 4) calm()
        return { floor: 0, action }
      }
      calm()
      return { floor: 0, action }
    }
    silent = 0
    pending = 0

    const ratio = near / held
    if (learnt < LEARN) {
      learnt += 1
      coupling = Math.max(coupling, ratio)
      return { floor: Infinity, action: null }
    }

    const floor = margin * coupling * held
    const level = Math.max(floor, SPEECH_MIN)
    const above = near > level

    if (checking) {
      // The Agent's voice is down. Once the louder moments have left `held`, an echo shows as much of the Agent's
      // level as before, and a person's voice several times more. (Summed over frames: one frame's share of a
      // syllable can be anything.)
      checking += 1
      if (checking <= HOLD) return { floor, action: null }
      sinceNear += near
      sinceHeld += held
      if (checking < HOLD + MEASURE) return { floor, action: null }
      checking = 0
      const jump = sinceNear / sinceHeld / (runNear / runHeld)
      if (jump >= JUMP) {
        // It did not fall with the Agent's voice: a person. (Unless the echo itself changed just then: when the jump
        // is not plainly a person's, whether the sound dies with the Agent is looked at too.)
        if (allow) {
          const unsure = jump < SURE_JUMP
          calm()
          after = unsure ? 1 : 0
          someone = false
          return { floor, action: "interrupt" }
        }
        calm()
        return { floor, action: "restore" }
      }
      // It fell with the Agent's voice, so it was the Agent's voice.
      learn()
      calm()
      return { floor, action: "echo" }
    }

    if (!above) {
      calm()
      steady += 1
      // Echo: follow it, quickly when it grows, slowly when it fades, and quickly again when it was plainly learned
      // too high.
      low = ratio < coupling * 0.5 ? low + 1 : 0
      coupling += (ratio > coupling ? 0.25 : low >= STEADY ? 0.15 : 0.02) * (ratio - coupling)
      return { floor, action: null }
    }
    low = 0
    if (!allow) {
      calm()
      return { floor, action: null }
    }

    run += 1
    shown = Math.max(shown, ratio)
    runNear += near
    runHeld += held
    if (run < TRIGGER) return { floor, action: null }
    if (near >= sure * level && steady >= STEADY) {
      after = 1
      someone = false
      return { floor, action: "interrupt" }
    }
    checking = 1
    sinceNear = 0
    sinceHeld = 0
    return { floor, action: "duck" }
  }

  return {
    push,
    // How much of the Agent's level the microphone is taken to pick up (for checking).
    get coupling() {
      return coupling
    },
    get learning() {
      return learnt < LEARN
    },
  }
}
