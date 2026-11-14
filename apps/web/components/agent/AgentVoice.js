"use client"

import { useEffect, useRef } from "react"
import { Icon } from "../ui/Icon"

const SAYS = { starting: "Starting", listening: "Listening", thinking: "Thinking", speaking: "Speaking" }
const HINT = "Say what you need, then pause."
const MUTED_HINT = "The microphone is off. Unmute to go on."

// The Agent as a circle of light. It swells with whoever is speaking (the person while it listens, the Agent while it
// answers), its colours drift slowly while it listens and fast, with an arc running round it, while it works, and it
// sends out rings while it speaks. While an answer is under way, tapping it stops the answer.
function Orb({ voice, answering }) {
  const orb = useRef(null)
  const level = voice.level
  useEffect(() => {
    let frame = 0
    let shown = 0
    const follow = () => {
      const now = Math.max(0, Math.min(1, level() || 0))
      // Up at once with the voice and down gently, so it swells with speech without flickering.
      shown += (now - shown) * (now > shown ? 0.55 : 0.12)
      orb.current?.style.setProperty("--level", shown.toFixed(3))
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(frame)
  }, [level])
  return (
    <button
      type="button"
      ref={orb}
      className={answering ? "agent-orb is-stoppable" : "agent-orb"}
      onClick={answering ? voice.stop : undefined}
      disabled={!answering}
      aria-label="Stop the answer"
      aria-hidden={answering ? undefined : "true"}
      title={answering ? "Stop the answer" : undefined}
    >
      <span className="agent-orb-glow" />
      <span className="agent-orb-ring" />
      <span className="agent-orb-ring" />
      <span className="agent-orb-arc" />
      <span className="agent-orb-core"><i /><i /><i /></span>
    </button>
  )
}

// A call's round control with its word under it.
function Control({ icon, label, className = "", ...rest }) {
  return (
    <button type="button" className={`agent-voice-control ${className}`.trim()} {...rest}>
      <span className="agent-voice-round"><Icon name={icon} size={18} /></span>
      <em>{label}</em>
    </button>
  )
}

// Talk mode, in the box's place (`voice` is useAgentVoice): the circle, a line for what the Agent is doing and one
// for what it is saying, and the controls: Mute, Stop for the answer under way, and End. Speaking over the Agent
// stops it too. What the person says, and the answers, show in the chat above as they happen. In a new chat the
// circle has the page to itself.
export function AgentVoice({ voice }) {
  const answering = voice.state === "thinking" || voice.state === "speaking"
  const listening = voice.state === "listening"
  const state = voice.state === "thinking" ? voice.status || (voice.asking ? "Looking it up" : SAYS.thinking) : listening && voice.muted ? "Muted" : SAYS[voice.state]
  const line = voice.error || voice.caption || (listening ? (voice.muted ? MUTED_HINT : HINT) : "")
  return (
    <div className={`agent-box agent-voice is-${voice.state}${voice.muted ? " is-muted" : ""}`} role="group" aria-label="Talk with the Agent">
      <Orb voice={voice} answering={answering} />
      <div className="agent-voice-words">
        <p className="agent-voice-state" role="status"><span>{state}</span></p>
        <p className={voice.error ? "agent-voice-line is-error" : "agent-voice-line"}><span>{line}</span></p>
      </div>
      <div className="agent-voice-controls">
        <Control icon={voice.muted ? "micOff" : "mic"} label={voice.muted ? "Unmute" : "Mute"} role="switch" aria-checked={voice.muted} title={voice.muted ? "Turn the microphone on again" : "Turn the microphone off for a moment"} onClick={() => voice.setMuted(!voice.muted)} />
        <Control icon="stop" label="Stop" disabled={!answering} title="Stop the answer" onClick={voice.stop} />
        <Control icon="phoneOff" label="End" className="is-end" title="End Talk" onClick={voice.end} />
      </div>
    </div>
  )
}
