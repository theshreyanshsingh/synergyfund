"use client"

import { useEffect, useRef, useState } from "react"
import { AGENT_SOUNDS } from "@synergifund/shared"
import { useSession } from "../shell/Providers"
import { api } from "../../lib/api"
import { setSoundPrefs } from "../../lib/sounds"
import { Icon } from "../ui/Icon"
import { AgentBottomSheet } from "./AgentSheets"
import { AgentSpark } from "./AgentSpark"

const SAYS = { starting: "Connecting", listening: "Listening", thinking: "Thinking", speaking: "Speaking" }
const BARS = 5

// Talk mode, over the whole Agent (`voice` is useAgentVoice): a quiet white screen with the spark and what the Agent is
// doing in the middle ("Connecting…", "Listening…", "Thinking…", "Speaking…"), the words it is saying under that, and a
// soft light along the bottom that swells with whoever is speaking: cool while it listens, warm while it answers.
//
// Along the bottom: the gear (Voice settings), Mute, and a pill with the voice's bars and X. While an answer is under
// way a tap on the bars stops it (speaking over the Agent stops it too); X ends Talk. What is said shows in the chat
// once Talk ends, and as it happens behind this screen.
export function AgentTalk({ voice }) {
  const root = useRef(null)
  const [settings, setSettings] = useState(false)
  const answering = voice.state === "thinking" || voice.state === "speaking"
  const listening = voice.state === "listening"
  const muted = listening && voice.muted
  const said = voice.state === "thinking" ? voice.status || (voice.asking ? "Looking it up" : SAYS.thinking) : muted ? "Muted" : SAYS[voice.state] || "Connecting"
  const line = voice.error || voice.caption || (muted ? "Your microphone is off. Tap the microphone to go on." : listening ? "Say what you need, then pause." : "")
  const level = voice.level

  // The light and the bars follow the sound: up at once with the voice and down gently, so they don't flicker.
  useEffect(() => {
    let frame = 0
    let shown = 0
    const follow = () => {
      const now = Math.max(0, Math.min(1, level() || 0))
      shown += (now - shown) * (now > shown ? 0.5 : 0.1)
      root.current?.style.setProperty("--level", shown.toFixed(3))
      frame = requestAnimationFrame(follow)
    }
    frame = requestAnimationFrame(follow)
    return () => cancelAnimationFrame(frame)
  }, [level])

  return (
    <div ref={root} className={`agent-talk is-${voice.state}${voice.muted ? " is-muted" : ""}`} role="group" aria-label="Talk with the Agent">
      <div className="agent-talk-glow" aria-hidden="true"><i /><i /><i /></div>
      <div className="agent-talk-middle">
        <p className="agent-talk-state" role="status">
          <AgentSpark size={20} live={!muted} />
          <span>{said}<i className="agent-talk-dots" aria-hidden="true"><b>.</b><b>.</b><b>.</b></i></span>
        </p>
        <p className={voice.error ? "agent-talk-line is-error" : "agent-talk-line"}><span>{line}</span></p>
      </div>
      <div className="agent-talk-bar">
        <button type="button" className="agent-round is-glass" onClick={() => setSettings(true)} aria-label="Voice settings" title="Voice settings">
          <Icon name="settings" size={19} />
        </button>
        <div className="agent-talk-right">
          {/* A switch named Mute, on while muted, as on a phone call. */}
          <button type="button" className={voice.muted ? "agent-round is-glass is-on" : "agent-round is-glass"} role="switch" aria-checked={voice.muted} aria-label="Mute" title={voice.muted ? "Turn the microphone on again" : "Turn the microphone off for a moment"} onClick={() => voice.setMuted(!voice.muted)}>
            <Icon name={voice.muted ? "micOff" : "mic"} size={19} />
          </button>
          <div className={answering ? "agent-talk-pill is-answering" : "agent-talk-pill"}>
            <button type="button" className="agent-talk-bars" onClick={answering ? voice.stop : undefined} disabled={!answering} aria-label={answering ? "Stop the answer" : "The Agent is listening"} title={answering ? "Stop the answer" : undefined}>
              {Array.from({ length: BARS }, (_, index) => <i key={index} style={{ "--bar": index }} />)}
            </button>
            <button type="button" className="agent-talk-end" onClick={voice.end} aria-label="End Talk" title="End Talk">
              <Icon name="close" size={18} />
            </button>
          </div>
        </div>
      </div>
      {settings && <VoiceSettings onClose={() => setSettings(false)} />}
    </div>
  )
}

// The gear's sheet: the Agent's sounds on or off (the same switch as Settings › App), and how Talk works.
function VoiceSettings({ onClose }) {
  const session = useSession()
  const sounds = session?.user?.sounds || {}
  const on = (sounds.agent || "on") === "on"
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function turn(next) {
    const value = next ? "on" : "off"
    if (!AGENT_SOUNDS.some((item) => item.id === value)) return
    setBusy(true)
    setError("")
    setSoundPrefs({ ...sounds, agent: value })
    try {
      const data = await api("/auth/me/sounds", { method: "PATCH", body: { agent: value } })
      session.setUser(data.user)
    } catch (err) {
      setSoundPrefs(sounds)
      setError(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AgentBottomSheet title="Voice settings" onClose={onClose} className="agent-voice-sheet">
      <label className="agent-switch-row">
        <span>
          <b>Agent sounds</b>
          <small>A soft sound as Talk starts and ends, and as answers arrive.</small>
        </span>
        <input type="checkbox" role="switch" checked={on} disabled={busy} onChange={(event) => turn(event.target.checked)} />
      </label>
      {error && <p className="agent-sheet-error">{error}</p>}
      <ul className="agent-voice-tips">
        <li><Icon name="talk" size={16} /> Speak when you're ready, then pause. The Agent answers out loud.</li>
        <li><Icon name="stop" size={16} /> Start speaking, or tap the bars, to stop an answer.</li>
        <li><Icon name="mic" size={16} /> Mute turns your microphone off until you tap it again.</li>
      </ul>
    </AgentBottomSheet>
  )
}
