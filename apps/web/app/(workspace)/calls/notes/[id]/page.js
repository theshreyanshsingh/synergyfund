"use client"

import { use, useCallback, useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { PERMISSIONS, can } from "@synergifund/shared"
import { DetailFrame } from "../../../../../components/ui/DetailFrame"
import { Icon } from "../../../../../components/ui/Icon"
import { PageSpinner, Spinner } from "../../../../../components/ui/Spinner"
import { useSession } from "../../../../../components/shell/Providers"
import { api } from "../../../../../lib/api"

function dateTime(value) {
  return new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

function length(note) {
  if (!note.offAt) return ""
  const minutes = Math.max(1, Math.round((new Date(note.offAt) - new Date(note.onAt)) / 60000))
  return minutes >= 60 ? `${Math.floor(minutes / 60)} h ${minutes % 60} min` : `${minutes} min`
}

// The notes as plain text, for pasting into an email or a document.
function asText(note) {
  const lines = [note.title, dateTime(note.onAt), "", note.summary]
  const list = (heading, items) => {
    if (!items.length) return
    lines.push("", heading, ...items.map((item) => `- ${item}`))
  }
  list("Action items", note.actionItems.map((item) => [item.task, item.owner && `(${item.owner})`, item.due && `· ${item.due}`].filter(Boolean).join(" ")))
  list("Decisions", note.decisions)
  list("Key points", note.keyPoints)
  return lines.join("\n").trim()
}

export default function CallNotesPage({ params }) {
  const { id } = use(params)
  const router = useRouter()
  const session = useSession()
  const [note, setNote] = useState(null)
  const [error, setError] = useState("")
  const [busy, setBusy] = useState("")
  const [copied, setCopied] = useState(false)
  const [added, setAdded] = useState({})
  const canAddTasks = Boolean(session?.user && can(session.user, PERMISSIONS.tasksManage))

  const [loads, setLoads] = useState(0)
  const load = useCallback(async () => {
    try {
      const data = await api(`/calls/notes/${id}`)
      setNote(data.note)
      setError("")
    } catch (err) {
      setError(err.message)
    } finally {
      setLoads((count) => count + 1)
    }
  }, [id])
  useEffect(() => {
    load()
  }, [load])
  // While the notes are being taken or written (also after Try again), check back every few seconds.
  const inProgress = note?.status === "recording" || note?.status === "writing"
  useEffect(() => {
    if (!inProgress) return undefined
    const timer = setTimeout(load, 4000)
    return () => clearTimeout(timer)
  }, [inProgress, loads, load])

  async function retry() {
    setBusy("retry")
    setError("")
    try {
      const data = await api(`/calls/notes/${id}/retry`, { method: "POST", body: {} })
      setNote(data.note)
      if (!data.ok) setError("The notes could not be written again. Reload the page and try again.")
    } catch (err) {
      setError(err.message)
    } finally {
      setBusy("")
    }
  }

  async function remove() {
    if (!window.confirm("Delete these notes? They are also removed from the conversation. This cannot be undone.")) return
    setBusy("delete")
    try {
      await api(`/calls/notes/${id}`, { method: "DELETE" })
      router.replace("/calls")
    } catch (err) {
      setError(err.message)
      setBusy("")
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText(note))
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError("Copying is blocked in this browser. Select the text instead.")
    }
  }

  async function addTask(item, index) {
    setAdded((current) => ({ ...current, [index]: "adding" }))
    try {
      const details = [item.owner && `Owner: ${item.owner}`, item.due && `When: ${item.due}`, `From the AI notes of the call on ${dateTime(note.onAt)}: ${note.title}`].filter(Boolean).join("\n")
      await api("/tasks", { method: "POST", body: { title: item.task, notes: details, priority: "Medium", labels: ["Call notes"] } })
      setAdded((current) => ({ ...current, [index]: "added" }))
    } catch (err) {
      setAdded((current) => ({ ...current, [index]: "" }))
      setError(err.message)
    }
  }

  if (!note) return error ? <div className="boot"><p className="banner">{error}</p></div> : <PageSpinner />

  const people = note.participants.map((person) => person.name).filter(Boolean)
  const ready = note.status === "ready"
  return (
    <DetailFrame
      backHref="/calls"
      backLabel="Calls"
      title={ready ? note.title : "AI notes"}
      meta={[`${note.media === "video" ? "Video" : "Voice"} call`, dateTime(note.onAt), length(note), people.join(", ")].filter(Boolean).join(" · ")}
      actions={[
        ready && <button key="copy" type="button" className="import-button" onClick={copy}>{copied ? "Copied" : "Copy notes"}</button>,
        note.canManage && note.status !== "recording" && note.status !== "writing" && <button key="delete" type="button" className="import-button notes-delete" disabled={busy === "delete"} onClick={remove}>Delete</button>,
      ].filter(Boolean)}
    >
      {error && <p className="banner">{error}</p>}

      {note.status === "recording" && (
        <div className="notes-state is-live">
          <span className="notes-live-dot" aria-hidden="true" />
          <div><strong>AI notes are on in this call.</strong><span>The notes are written when they are turned off or the call ends.</span></div>
        </div>
      )}
      {note.status === "writing" && (
        <div className="notes-state">
          <Spinner />
          <div><strong>Writing the notes…</strong><span>This takes about a minute. They are also posted in the conversation when ready.</span></div>
        </div>
      )}
      {note.status === "empty" && (
        <div className="notes-state is-quiet">
          <Icon name="micOff" size={18} />
          <div><strong>Nothing to write up.</strong><span>{note.error || "Nobody was heard while AI notes were on."}</span></div>
        </div>
      )}
      {note.status === "failed" && (
        <div className="notes-state is-failed">
          <Icon name="alert" size={18} />
          <div><strong>The notes could not be written.</strong><span>{note.error}</span></div>
          <button type="button" className="primary" disabled={busy === "retry"} onClick={retry}>{busy === "retry" ? "Writing…" : "Try again"}</button>
        </div>
      )}

      {ready && (
        <div className="notes-grid">
          <section className="property-card notes-card">
            <h2>Summary</h2>
            <p className="notes-summary">{note.summary}</p>
          </section>

          {note.actionItems.length > 0 && (
            <section className="property-card notes-card">
              <h2>Action items</h2>
              <ul className="notes-actions">
                {note.actionItems.map((item, index) => (
                  <li key={index}>
                    <span className="notes-check" aria-hidden="true" />
                    <span className="notes-action-copy">
                      <strong>{item.task}</strong>
                      {(item.owner || item.due) && <em>{[item.owner, item.due].filter(Boolean).join(" · ")}</em>}
                    </span>
                    {canAddTasks && (
                      <button type="button" className="tool notes-add" disabled={Boolean(added[index])} onClick={() => addTask(item, index)}>
                        {added[index] === "added" ? <><Icon name="check" size={13} /> Added</> : added[index] === "adding" ? "Adding…" : <><Icon name="plus" size={13} /> Add to Tasks</>}
                      </button>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}

          {note.decisions.length > 0 && (
            <section className="property-card notes-card">
              <h2>Decisions</h2>
              <ul className="notes-list">{note.decisions.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </section>
          )}

          {note.keyPoints.length > 0 && (
            <section className="property-card notes-card">
              <h2>Key points</h2>
              <ul className="notes-list">{note.keyPoints.map((item, index) => <li key={index}>{item}</li>)}</ul>
            </section>
          )}
        </div>
      )}

      {note.transcript.length > 0 && (
        <details className="property-card notes-transcript" open={!ready}>
          <summary>Transcript <em>{note.transcript.length} {note.transcript.length === 1 ? "line" : "lines"}</em></summary>
          <ol>
            {note.transcript.map((line, index) => (
              <li key={index}>
                <time>{line.offset}</time>
                <span><b>{line.name}</b> {line.text}</span>
              </li>
            ))}
          </ol>
        </details>
      )}

      <p className="notes-footnote">
        AI notes were turned on by {note.startedByName}{note.stoppedByName ? ` and off by ${note.stoppedByName}` : ""}. Each person's own microphone was transcribed while they were on; the audio itself was not kept. AI can mishear, so check names and numbers.
      </p>
    </DetailFrame>
  )
}
