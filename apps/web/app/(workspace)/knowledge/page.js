"use client"

import { useState } from "react"
import { Icon } from "../../../components/ui/Icon"
import { api } from "../../../lib/api"
import { useApi } from "../../../lib/useApi"

const prompts = [
  { icon: "building", label: "Highest rented rent in Fort Lauderdale", question: "Highest property rental you see in FLL? Rented" },
  { icon: "file", label: "Which properties are missing a scope of work", question: "Which properties are missing a scope of work?" },
  { icon: "receipt", label: "Where are the receipts filed", question: "Where are the receipts filed?" },
]

export default function KnowledgePage() {
  const threads = useApi("/threads")
  const [question, setQuestion] = useState("")
  const [active, setActive] = useState(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const messages = active?.messages || []
  const started = messages.length > 0

  async function ask(event, text) {
    event?.preventDefault()
    const next = (text || question).trim()
    if (!next || pending) return
    setPending(true)
    setError("")
    setQuestion("")
    try {
      const result = await api("/threads", { method: "POST", body: { question: next } })
      setActive(result.thread)
      threads.reload()
    } catch (err) {
      setQuestion(next)
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className={started ? "agent has-chat" : "agent"}>
      <div className="agent-thread">
        {!started && <h1>Where should we begin?</h1>}
        {messages.map((message, index) => (
          <article key={index} className={message.role === "user" ? "agent-msg user" : "agent-msg"}>
            <p>{message.content}</p>
            {(message.sources || []).length > 0 && <small>Source: {message.sources.map((source) => source.label).join(", ")}</small>}
          </article>
        ))}
        {error && <div className="banner">{error}</div>}
      </div>
      <form className="agent-composer" onSubmit={(event) => ask(event)}>
        <button type="button" className="agent-plus" aria-label="New question" onClick={() => { setActive(null); setQuestion(""); setError("") }}>
          <Icon name="plus" size={16} />
        </button>
        <input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask anything" />
        <button className="agent-send" type="submit" disabled={!question.trim() || pending} aria-label="Ask">
          <Icon name="pulse" size={16} />
        </button>
      </form>
      {!started && (
        <div className="agent-prompts">
          {prompts.map((prompt) => (
            <button key={prompt.label} type="button" className="agent-prompt" onClick={(event) => ask(event, prompt.question)}>
              <Icon name={prompt.icon} size={16} />
              {prompt.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
