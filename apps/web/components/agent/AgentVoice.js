"use client"

import { useEffect, useRef } from "react"
import { Icon } from "../ui/Icon"

const SAYS = { starting: "Starting…", listening: "Listening…", thinking: "Thinking…", speaking: "Speaking…" }

// The Agent as a circle of light. It swells with whoever is speaking (the person while it listens, the Agent while it
// answers), turns slowly while it listens, faster with an arc running round it while it works, and sends out rings
// while it speaks. While an answer is under way, tapping it stops the answer.
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
      <span className="agent-orb-core" />
    </button>
  )
}

// Talk mode, where the box was: the Agent's circle, what is happening now (listening, thinking or the step the Agent
// is on, speaking), the last thing the person was heard to say, the words the Agent is saying, the headphones switch,
// Stop for the answer under way and End to go back to typing. `voice` is useAgentVoice.
export function AgentVoice({ voice }) {
  const answering = voice.state === "thinking" || voice.state === "speaking"
  const line = voice.state === "thinking" ? voice.status || (voice.asking ? "Looking it up…" : SAYS.thinking) : SAYS[voice.state]
  return (
    <div className={`agent-box agent-voice is-${voice.state}`} role="group" aria-label="Talk with the Agent">
      <Orb voice={voice} answering={answering} />
      <p className="agent-voice-state" role="status">{line}</p>
      {voice.error && <p className="agent-voice-error">{voice.error}</p>}
      {voice.heard && <p className="agent-voice-heard">“{voice.heard}”</p>}
      {voice.caption && <p className="agent-voice-caption"><span>{voice.caption}</span></p>}
      {!voice.caption && !voice.heard && !voice.error && <p className="agent-voice-hint">Say what you need, then pause. The Agent answers aloud.</p>}
      <div className="agent-voice-foot">
        <button type="button" role="switch" aria-checked={voice.headphones} className="agent-voice-pill" onClick={() => voice.setHeadphones(!voice.headphones)}>
          <Icon name="headphones" size={15} />
          <span>Headphones</span>
          <i aria-hidden="true" />
        </button>
        {answering && (
          <button type="button" className="agent-voice-control" onClick={voice.stop}>
            <Icon name="stop" size={13} />
            Stop
          </button>
        )}
        <button type="button" className="agent-voice-control is-end" onClick={voice.end}>End</button>
      </div>
      <p className="agent-voice-note">{voice.headphones ? "On headphones: talk over the Agent to interrupt it." : "On speakers: the Agent finishes speaking before it listens."}</p>
    </div>
  )
}
