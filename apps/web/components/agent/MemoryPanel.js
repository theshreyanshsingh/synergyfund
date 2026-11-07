"use client"

import { useEffect, useState } from "react"
import { api } from "../../lib/api"
import { Icon } from "../ui/Icon"

const MAX_CHARS = 300

function when(value) {
  const date = new Date(value)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })
}

// Memory on the Agent page (and the phone sheet): what the Agent remembers about this person, learned from what they
// write in their chats or added here, with the switch that turns it off. Only they see it. `onOpen`: opens a chat.
export function MemoryPanel({ onOpen }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    api("/agent/memories").then(setData).catch((err) => setError(err.message))
  }, [])

  async function run(work) {
    setError("")
    setPending(true)
    try {
      await work()
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setPending(false)
    }
  }

  const toggle = () => run(async () => {
    const result = await api("/agent/memories/settings", { method: "PATCH", body: { on: !data.on } })
    setData((current) => ({ ...current, on: result.on }))
  })
  const add = (text) => run(async () => {
    const result = await api("/agent/memories", { method: "POST", body: { text } })
    setData((current) => ({ ...current, items: [result.memory, ...current.items.filter((item) => item.id !== result.memory.id)] }))
    setAdding(false)
  })
  const save = (id, text) => run(async () => {
    const result = await api(`/agent/memories/${id}`, { method: "PATCH", body: { text } })
    setData((current) => ({ ...current, items: current.items.map((item) => (item.id === id ? result.memory : item)) }))
    setEditing("")
  })
  const remove = (item) => run(async () => {
    await api(`/agent/memories/${item.id}`, { method: "DELETE" })
    setData((current) => ({ ...current, items: current.items.filter((entry) => entry.id !== item.id) }))
  })
  const removeAll = () => {
    if (!window.confirm(`Delete all ${data.items.length} memories? The Agent forgets everything it remembers about you. This can't be undone.`)) return
    run(async () => {
      await api("/agent/memories", { method: "DELETE" })
      setData((current) => ({ ...current, items: [] }))
    })
  }

  return (
    <div className="agent-page-list agent-memory">
      <div className="agent-column">
        <div className="agent-prompts-head">
          <p>What the Agent remembers about you, so it answers the way you like: how you want answers, who people are, what you call things. It learns from what you write in your chats (never from documents or web pages), and you can tell it "remember…" or "forget…". Only you see these. Temporary chats are never remembered.</p>
          <button type="button" className="primary" onClick={() => { setAdding(true); setEditing("") }} disabled={!data || adding || (data.items.length >= data.max && data.items.every((item) => item.source === "added"))}><Icon name="plus" size={14} /> Add</button>
        </div>
        {error && <p className="banner">{error}</p>}
        {!data ? (
          error ? null : <p className="agent-panel-none">Loading…</p>
        ) : (
          <>
            <button type="button" role="switch" aria-checked={data.on} className={data.on ? "access-row is-on agent-memory-switch" : "access-row agent-memory-switch"} onClick={toggle} disabled={pending}>
              <span>
                <strong>Remember things from my chats</strong>
                <small>{data.on ? "The Agent uses what it remembers and notes new things as you chat." : "Off: the Agent doesn't use or learn these. They're kept until you delete them."}</small>
              </span>
              <i aria-hidden="true" />
            </button>
            {adding && <MemoryEditor onCancel={() => setAdding(false)} onSave={add} pending={pending} />}
            {!data.items.length && !adding ? (
              <p className="agent-panel-none">Nothing yet. As you chat, the Agent notes what's worth keeping, or press Add to tell it something yourself.</p>
            ) : (
              <ul className="agent-prompt-list">
                {data.items.map((item) => (
                  <li key={item.id} className={data.on ? "agent-prompt-item agent-memory-item" : "agent-prompt-item agent-memory-item is-off"}>
                    {editing === item.id ? (
                      <MemoryEditor text={item.text} onCancel={() => setEditing("")} onSave={(text) => save(item.id, text)} pending={pending} />
                    ) : (
                      <>
                        <p>{item.text}</p>
                        <div className="agent-memory-row">
                          <p className="agent-memory-meta">
                            {item.source === "added" ? <span>Added by you · {when(item.createdAt)}</span> : item.chatId && onOpen ? (
                              <button type="button" className="agent-prompt-last" onClick={() => onOpen(item.chatId)}>From a chat · {when(item.updatedAt || item.createdAt)}</button>
                            ) : <span>From a chat · {when(item.updatedAt || item.createdAt)}</span>}
                          </p>
                          <div className="agent-prompt-actions">
                            <button type="button" className="tool" onClick={() => { setEditing(item.id); setAdding(false) }}>Edit</button>
                            <button type="button" className="tool agent-prompt-delete" onClick={() => remove(item)} disabled={pending}>Delete</button>
                          </div>
                        </div>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            )}
            {data.items.length > 0 && (
              <div className="agent-memory-foot">
                <span>{data.items.length} of {data.max}</span>
                <button type="button" className="tool agent-prompt-delete" onClick={removeAll} disabled={pending}>Delete all</button>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

function MemoryEditor({ text = "", onCancel, onSave, pending }) {
  const [value, setValue] = useState(text)
  const clean = value.replace(/\s+/g, " ").trim()
  return (
    <form className="agent-prompt-editor" onSubmit={(event) => { event.preventDefault(); if (clean) onSave(clean) }}>
      <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={2} maxLength={MAX_CHARS} placeholder="e.g. Prefers answers as a short table. Jane Smith (jane@kiavi.com) is my Kiavi loan officer." aria-label="Memory" autoFocus />
      <div className="agent-prompt-actions">
        <span className="agent-memory-count">{clean.length}/{MAX_CHARS}</span>
        <button type="button" className="tool" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={!clean || pending || clean === text}>Save</button>
      </div>
    </form>
  )
}
