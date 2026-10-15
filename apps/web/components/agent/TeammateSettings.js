"use client"

import { useEffect, useState } from "react"
import { api } from "../../lib/api"

// The AI teammate that works in the property chats: on or off, its name, how soon it checks in with contractors,
// and where draw requests are emailed.
export function TeammateSettings() {
  const [teammate, setTeammate] = useState(null)
  const [form, setForm] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    api("/teammate")
      .then((data) => {
        setTeammate(data.teammate)
        setForm({ name: data.teammate.name, followUpDays: String(data.teammate.followUpDays), drawEmail: data.teammate.drawEmail })
      })
      .catch((err) => setError(err.message))
  }, [])

  async function save(patch, done) {
    setPending(true)
    setError("")
    setMessage("")
    try {
      const data = await api("/teammate", { method: "PATCH", body: patch })
      setTeammate(data.teammate)
      setForm({ name: data.teammate.name, followUpDays: String(data.teammate.followUpDays), drawEmail: data.teammate.drawEmail })
      setMessage(done)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  if (!teammate || !form) return <section className="panel settings-card">{error ? <p className="banner">{error}</p> : <p className="settings-note">Loading the AI teammate…</p>}</section>
  const changed = form.name !== teammate.name || Number(form.followUpDays) !== teammate.followUpDays || form.drawEmail.trim().toLowerCase() !== teammate.drawEmail
  return (
    <section className="panel settings-card">
      <form className="settings-send" onSubmit={(event) => { event.preventDefault(); save({ name: form.name, followUpDays: Number(form.followUpDays), drawEmail: form.drawEmail }, "Saved.") }}>
        <div>
          <h2>AI teammate</h2>
          <p>
            A team member who works in every property chat. It reads what the crew says and the photos they post, marks line items
            in progress or complete with an expected finish date, emails the draws inbox and adds a high-priority to-do when a draw
            should be requested, answers when someone talks to it, and checks in with contractors when a house goes quiet
            (weekdays, 9 to 5). It is an AI and says so if anyone asks.
          </p>
        </div>
        <div className="settings-status settings-wide">
          <span className={teammate.on ? "is-on" : undefined}>{teammate.on ? `On · ${teammate.name} is in the property chats` : "Off"}</span>
          <span className={teammate.modelConnected ? "is-on" : undefined}>AI model {teammate.modelConnected ? `connected · ${teammate.model}` : "not connected · add OPENROUTER_API_KEY"}</span>
          {teammate.housesReviewed > 0 && <span className="is-on">{teammate.housesReviewed} {teammate.housesReviewed === 1 ? "house" : "houses"} followed</span>}
        </div>
        {error && <div className="banner settings-wide">{error}</div>}
        {message && <p className="settings-note settings-wide">{message}</p>}
        <label className="field"><span>Name in the chats</span><input value={form.name} maxLength={60} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
        <label className="field"><span>Check in after (days without an update)</span><input type="number" min="1" max="30" value={form.followUpDays} onChange={(event) => setForm({ ...form, followUpDays: event.target.value })} /></label>
        <label className="field wide"><span>Draw requests are emailed to</span><input type="email" value={form.drawEmail} onChange={(event) => setForm({ ...form, drawEmail: event.target.value })} /></label>
        <div className="settings-actions">
          <button type="submit" className="tool" disabled={pending || !changed}>{pending ? "Saving…" : "Save"}</button>
          <button type="button" className="primary" disabled={pending || (!teammate.on && !teammate.modelConnected)} onClick={() => save({ on: !teammate.on }, teammate.on ? "The AI teammate is off." : `${teammate.name} is now in the property chats.`)}>
            {teammate.on ? "Turn off" : "Turn on"}
          </button>
        </div>
      </form>
    </section>
  )
}
