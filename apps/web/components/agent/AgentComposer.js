"use client"

import { useEffect, useRef, useState } from "react"
import { Icon } from "../ui/Icon"
import { useSpeechInput } from "./useSpeechInput"
import { VoiceWaves } from "./VoiceWaves"

const MAX_PROMPT = 10000

export function AgentComposer({ onSend, streaming, connected }) {
  const [message, setMessage] = useState("")
  const textareaRef = useRef(null)
  const speech = useSpeechInput((text) => setMessage((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`.slice(0, MAX_PROMPT)))

  function grow() {
    const element = textareaRef.current
    if (!element) return
    element.style.height = "40px"
    element.style.height = `${element.scrollHeight}px`
  }

  useEffect(grow, [message])

  function send(event) {
    event?.preventDefault()
    const text = message.trim()
    if (!text || streaming) return
    if (speech.listening) speech.stop()
    onSend(text)
    setMessage("")
  }

  return (
    <form className="agent-composer" onSubmit={send}>
      {streaming && (
        <div className="agent-building" role="status">
          <span className="spinner spinner-md tw:animate-spin" />
          <span>Agent is working</span>
        </div>
      )}
      {connected === false && (
        <p className="agent-composer-note">The agent is not connected to a model yet. Add OPENROUTER_API_KEY to the server .env file.</p>
      )}
      {speech.error && <p className="agent-composer-note">{speech.error}</p>}
      <div className="agent-box">
        <VoiceWaves listening={speech.listening} />
        <textarea
          ref={textareaRef}
          maxLength={MAX_PROMPT}
          rows={1}
          value={message}
          disabled={speech.listening}
          placeholder="Ask about properties, lenders, draws, loans or payments..."
          onChange={(event) => setMessage(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault()
              send()
            }
          }}
        />
        <div className="agent-box-foot">
          <div className="agent-box-actions">
            {speech.supported && (
              <button
                type="button"
                className={speech.listening ? "agent-icon-button is-listening" : "agent-icon-button"}
                title={speech.listening ? "Stop recording" : "Start voice input"}
                aria-label={speech.listening ? "Stop recording" : "Start voice input"}
                onClick={speech.listening ? speech.stop : speech.start}
              >
                <Icon name={speech.listening ? "stop" : "mic"} size={16} />
              </button>
            )}
            <button type="submit" className="agent-send-button" disabled={streaming || !message.trim()} aria-label="Send">
              {streaming ? <span className="spinner spinner-md tw:animate-spin" /> : <Icon name="arrowUp" size={16} />}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
