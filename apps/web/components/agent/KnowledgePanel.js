"use client"

import { useEffect, useState } from "react"
import Link from "next/link"
import { seesKnowledge } from "@synergifund/shared"
import { api } from "../../lib/api"
import { Icon } from "../ui/Icon"
import { useSession } from "../shell/Providers"
import { MemoryPanel } from "./MemoryPanel"

const MAX_CHARS = 500
const TABS = [["team", "Team", "users"], ["you", "About you", "person"]]

function when(value) {
  if (!value) return ""
  const date = new Date(value)
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", ...(date.getFullYear() !== new Date().getFullYear() ? { year: "numeric" } : {}) })
}

// Knowledge on the Agent page (and the phone sheet): what the Agent knows. Team: the notes admins write for everyone's
// Agent, and a summary of each house; About you: what it remembers about this person (MemoryPanel). People who don't see
// the whole books have About you only. `tab`: "team" or "you"; `onOpen`: opens a chat.
export function KnowledgePanel({ tab = "team", onOpen }) {
  const session = useSession()
  const team = seesKnowledge(session?.user)
  const [shown, setShown] = useState(tab)
  useEffect(() => setShown(tab), [tab])
  const current = team ? shown : "you"
  return (
    <div className="agent-page-list agent-knowledge">
      <div className="agent-column">
        {team && (
          // The arrow keys (and Home and End) move between the tabs, as in any tab list.
          <div className="agent-knowledge-tabs" role="tablist" aria-label="Knowledge" onKeyDown={(event) => {
            const next = { ArrowLeft: "team", Home: "team", ArrowRight: "you", End: "you" }[event.key]
            if (!next) return
            event.preventDefault()
            setShown(next)
            event.currentTarget.querySelector(`#knowledge-tab-${next}`)?.focus()
          }}>
            {TABS.map(([id, label, icon]) => (
              <button key={id} type="button" role="tab" id={`knowledge-tab-${id}`} aria-selected={current === id} aria-controls="knowledge-panel" tabIndex={current === id ? 0 : -1} className={current === id ? "is-on" : ""} onClick={() => setShown(id)}><Icon name={icon} size={15} /> {label}</button>
            ))}
          </div>
        )}
        <div id="knowledge-panel" {...(team ? { role: "tabpanel", "aria-labelledby": `knowledge-tab-${current}` } : {})}>
          {current === "team" ? <TeamKnowledge /> : <MemoryPanel onOpen={onOpen} />}
        </div>
      </div>
    </div>
  )
}

function TeamKnowledge() {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    api("/agent/knowledge").then(setData).catch((err) => setError(err.message))
  }, [])

  async function run(work) {
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

  const add = (text) => run(async () => {
    const result = await api("/agent/knowledge/notes", { method: "POST", body: { text } })
    setData((current) => ({ ...current, notes: [result.note, ...current.notes.filter((note) => note.id !== result.note.id)] }))
    setAdding(false)
  })
  const save = (id, text) => run(async () => {
    const result = await api(`/agent/knowledge/notes/${id}`, { method: "PATCH", body: { text } })
    setData((current) => ({ ...current, notes: current.notes.map((note) => (note.id === id ? result.note : note)) }))
    setEditing("")
  })
  const remove = (note) => {
    if (!window.confirm("Delete this team note? Everyone's Agent stops knowing it.")) return
    run(async () => {
      await api(`/agent/knowledge/notes/${note.id}`, { method: "DELETE" })
      setData((current) => ({ ...current, notes: current.notes.filter((item) => item.id !== note.id) }))
    })
  }

  const canEdit = Boolean(data?.canEdit)
  const written = data ? data.houses.filter((house) => house.writtenAt).length : 0
  return (
    <div className="agent-team">
      <div className="agent-prompts-head">
        <p>What every teammate's Agent knows about the business: notes the admins write (your terms, your companies, how you work, what you call a house) and a summary of each house, which the Agent writes from its records and documents and keeps up to date. Everyone who sees the whole books sees these; only admins change them.</p>
        {canEdit && <button type="button" className="primary" onClick={() => { setAdding(true); setEditing("") }} disabled={adding || data.notes.length >= data.max}><Icon name="plus" size={14} /> Add</button>}
      </div>
      {error && <p className="banner">{error}</p>}
      {!data ? (
        error ? null : <p className="agent-panel-none">Loading…</p>
      ) : (
        <>
          <section className="agent-knowledge-section" aria-label="Team notes">
            <h2 className="agent-knowledge-title">Team notes{data.notes.length > 0 && <span className="keep-case">{data.notes.length}</span>}</h2>
            {adding && <TeamNoteEditor onCancel={() => setAdding(false)} onSave={add} pending={pending} />}
            {!data.notes.length && !adding ? (
              <p className="agent-panel-none">{canEdit ? "No team notes yet. Press Add, or tell the Agent \"remember for the team that…\"." : "No team notes yet. An admin can add them."}</p>
            ) : (
              <ul className="agent-prompt-list">
                {data.notes.map((note) => (
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
          </section>
          <section className="agent-knowledge-section" aria-label="House summaries">
            <h2 className="agent-knowledge-title">House summaries{data.houses.length > 0 && <span className="keep-case">{written} of {data.houses.length} written</span>}</h2>
            <p className="agent-knowledge-hint">
              {!data.writing.connected
                ? "The Agent writes them once OpenRouter is connected (Settings → Agent)."
                : "Written by the Agent from each house's records and documents, and again when the house changes. Notes on one house are added on its page."}
            </p>
            {!data.houses.length ? (
              <p className="agent-panel-none">No houses yet.</p>
            ) : (
              <ul className="agent-house-list">
                {data.houses.map((house) => (
                  <li key={house.id}>
                    <Link href={`/properties/${house.id}`} className="agent-house">
                      <span className="agent-house-head"><strong>{house.address}</strong>{house.stage && <small>{house.stage}</small>}</span>
                      <span className={house.what ? "agent-house-what" : "agent-house-what is-none"}>{house.what || (house.state === "failed" ? "Couldn't be written yet. Open the house to see why." : house.state === "writing" ? "Being written…" : "Not written yet.")}</span>
                      {(house.writtenAt || house.notes > 0) && (
                        <small className="agent-house-meta">{[house.writtenAt ? `Updated ${when(house.writtenAt)}` : "", house.notes ? `${house.notes} team ${house.notes === 1 ? "note" : "notes"}` : ""].filter(Boolean).join(" · ")}</small>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      )}
    </div>
  )
}

// A team note being written or changed. Also used on the property page's Summary card.
export function TeamNoteEditor({ text = "", onCancel, onSave, pending, placeholder = "e.g. \"The Bayshore flip\" is 2418 Bayshore Blvd. Kiavi draws take about a week to fund." }) {
  const [value, setValue] = useState(text)
  const clean = value.replace(/\s+/g, " ").trim()
  return (
    <form className="agent-prompt-editor" onSubmit={(event) => { event.preventDefault(); if (clean) onSave(clean) }}>
      <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={2} maxLength={MAX_CHARS} placeholder={placeholder} aria-label="Team note" autoFocus />
      <div className="agent-prompt-actions">
        <span className="agent-memory-count">{clean.length}/{MAX_CHARS}</span>
        <button type="button" className="tool" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={!clean || pending || clean === text}>Save</button>
      </div>
    </form>
  )
}
