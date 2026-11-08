"use client"

import { useEffect, useRef, useState } from "react"
import { api } from "../../lib/api"
import { TeamNoteEditor } from "../agent/KnowledgePanel"

const POLL_MS = 5000
const POLL_TRIES = 36

function when(value) {
  const date = new Date(value)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })
}

// The property page's Summary: what the house is and the plan, written by the Agent from its records and documents
// (Show more: how it got here, who is involved, the key documents, what is open), and the team's notes on it, which the
// Agent and the next summary take as right. Admins add notes and ask for it to be written again. Only for people who see
// the whole books (seesKnowledge).
export function HouseSummaryCard({ propertyId }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [more, setMore] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState("")
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState("")
  // While a summary is on its way: when the one shown was written and its last try started, to notice the new one (or
  // a new failure, not the one before).
  const [awaiting, setAwaiting] = useState(null)
  const tries = useRef(0)
  // Goes up with each change made here, so a check that started before it doesn't put the old notes back.
  const changes = useRef(0)

  const fetchSummary = () => api(`/agent/knowledge/houses/${propertyId}`)
  useEffect(() => {
    setData(null)
    fetchSummary().then(setData).catch((err) => setError(err.message))
  }, [propertyId])

  // Not written yet, or asked for again: check every few seconds until it is (or a few minutes pass).
  const waiting = data && data.writing.connected && data.writing.on && (awaiting || ["waiting", "writing"].includes(data.summary.state))
  useEffect(() => {
    if (!waiting) return undefined
    tries.current = 0
    const timer = setInterval(async () => {
      tries.current += 1
      try {
        const at = changes.current
        const next = await fetchSummary()
        if (at !== changes.current) return
        setData(next)
        const arrived = awaiting && (next.summary.writtenAt !== awaiting.writtenAt || (next.summary.state === "failed" && next.summary.triedAt !== awaiting.triedAt))
        if (arrived || tries.current >= POLL_TRIES || (!awaiting && !["waiting", "writing"].includes(next.summary.state))) {
          setAwaiting(null)
          setMessage("")
          clearInterval(timer)
        }
      } catch {}
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [waiting, awaiting])

  async function run(work) {
    changes.current += 1
    setError("")
    setPending(true)
    try {
      await work()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  // A note on the house has its summary written again with it. (With no writer running here, it only says so.)
  const rewriting = () => {
    if (!data.writing.connected || !data.writing.on) {
      setMessage(data.writing.connected ? "Saved. The summary is written again by the live server." : "Saved. The summary is written once OpenRouter is connected.")
      return
    }
    setAwaiting({ writtenAt: data.summary.writtenAt, triedAt: data.summary.triedAt })
    setMessage("The Agent is writing it again. It takes a minute or so.")
  }
  const rewrite = () => run(async () => {
    await api("/agent/knowledge/rewrite", { method: "POST", body: { propertyId } })
    rewriting()
  })
  const add = (text) => run(async () => {
    const result = await api("/agent/knowledge/notes", { method: "POST", body: { text, propertyId } })
    setData((current) => ({ ...current, notes: [...current.notes.filter((note) => note.id !== result.note.id), result.note] }))
    setAdding(false)
    rewriting()
  })
  const save = (id, text) => run(async () => {
    const result = await api(`/agent/knowledge/notes/${id}`, { method: "PATCH", body: { text } })
    setData((current) => ({ ...current, notes: current.notes.map((note) => (note.id === id ? result.note : note)) }))
    setEditing("")
    rewriting()
  })
  const remove = (note) => {
    if (!window.confirm("Delete this note? Everyone's Agent stops knowing it.")) return
    run(async () => {
      await api(`/agent/knowledge/notes/${note.id}`, { method: "DELETE" })
      setData((current) => ({ ...current, notes: current.notes.filter((item) => item.id !== note.id) }))
      rewriting()
    })
  }

  if (!data) return error ? <section className="panel property-card house-summary"><h2>Summary</h2><p className="banner">{error}</p></section> : null
  const { summary, notes, canEdit } = data
  const written = Boolean(summary.what || summary.plan || summary.story)
  const lists = [["People", summary.people], ["Key documents", summary.onFile], ["Open", summary.open]].filter(([, items]) => items?.length)
  const extra = Boolean(summary.story) || lists.length > 0 || notes.length > 0 || adding
  const shown = more || adding || Boolean(editing)
  const status = !written
    ? summary.state === "failed"
      ? `It couldn't be written${summary.error ? `: ${summary.error}` : ""}. ${!summary.stopped ? "It's tried again within the hour." : canEdit ? "Press Rewrite to try again." : "It's tried again when the house changes."}`
      : !data.writing.connected
        ? "The Agent writes it once OpenRouter is connected (Settings → Agent)."
        : summary.state === "writing" || awaiting
          ? "The Agent is writing it now…"
          : "The Agent hasn't written it yet. It writes each house's summary in the background, usually within a few minutes."
    : ""
  return (
    <section className="panel property-card house-summary" aria-label="Summary">
      <div className="property-card-head">
        <div>
          <h2>Summary</h2>
          <p className="property-missing">{written ? `Written by the Agent from the records and documents${summary.writtenAt ? ` · Updated ${when(summary.writtenAt)}` : ""}` : "Written by the Agent from the records and documents"}</p>
        </div>
        {canEdit && (
          <div className="house-summary-actions">
            <button type="button" className="tool" onClick={() => { setAdding(true); setEditing(""); setMore(true) }} disabled={pending || adding}>Add a note</button>
            {(written || summary.state === "failed") && <button type="button" className="tool" onClick={rewrite} disabled={pending || Boolean(awaiting)}>{awaiting ? "Rewriting…" : "Rewrite"}</button>}
          </div>
        )}
      </div>
      {error && <p className="banner">{error}</p>}
      {message && <p className="settings-note">{message}</p>}
      {written ? (
        <div className="house-summary-body">
          {summary.what && <p className="house-summary-lead">{summary.what}</p>}
          {summary.plan && <p>{summary.plan}</p>}
          {shown && summary.story && <p>{summary.story}</p>}
          {shown && lists.length > 0 && (
            <div className="house-summary-lists">
              {lists.map(([title, items]) => (
                <div key={title}>
                  <h3>{title}</h3>
                  <ul>{items.map((item) => <li key={item}>{item}</li>)}</ul>
                </div>
              ))}
            </div>
          )}
          {summary.state === "failed" && summary.error && <p className="property-missing">The last update failed: {summary.error}</p>}
        </div>
      ) : (
        <p className="property-missing">{status}</p>
      )}
      {shown && (notes.length > 0 || adding) && (
        <div className="house-summary-notes">
          <h3>Notes from the team</h3>
          <p className="property-missing">The Agent takes these as right where they and the records differ.</p>
          {notes.length > 0 && (
            <ul className="agent-prompt-list">
              {notes.map((note) => (
                <li key={note.id} className="agent-prompt-item agent-memory-item">
                  {editing === note.id ? (
                    <TeamNoteEditor text={note.text} onCancel={() => setEditing("")} onSave={(text) => save(note.id, text)} pending={pending} />
                  ) : (
                    <>
                      <p>{note.text}</p>
                      <div className="agent-memory-row">
                        <p className="agent-memory-meta"><span>{[note.by, when(note.updatedAt)].filter(Boolean).join(" · ")}</span></p>
                        {canEdit && (
                          <div className="agent-prompt-actions">
                            <button type="button" className="tool" onClick={() => { setEditing(note.id); setAdding(false) }}>Edit</button>
                            <button type="button" className="tool agent-prompt-delete" onClick={() => remove(note)} disabled={pending}>Delete</button>
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </li>
              ))}
            </ul>
          )}
          {adding && <TeamNoteEditor onCancel={() => setAdding(false)} onSave={add} pending={pending} placeholder="e.g. We call it the Bayshore flip. The buyer is a cash investor; closing is set for Dec 12." />}
        </div>
      )}
      {extra && !adding && !editing && (
        <button type="button" className="house-summary-more" onClick={() => setMore((open) => !open)} aria-expanded={more}>
          {more ? "Show less" : `Show more${notes.length ? ` · ${notes.length} team ${notes.length === 1 ? "note" : "notes"}` : ""}`}
        </button>
      )}
    </section>
  )
}
