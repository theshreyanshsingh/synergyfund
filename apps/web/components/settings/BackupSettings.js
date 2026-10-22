"use client"

import { useEffect, useRef, useState } from "react"
import { api, uploadForm } from "../../lib/api"
import { Modal } from "../ui/Modal"
import { PasswordInput } from "../ui/PasswordInput"

// Settings › Backups (admins): a backup of all the workspace's data every day, Back up now, download, and restore
// (from the list or from a downloaded file). A restore first backs up the data as it is, so it can be undone.

const KINDS = { daily: "Daily", manual: "Manual", "before-restore": "Before a restore" }

function hourLabel(hour) {
  return `${hour % 12 || 12}:00 ${hour < 12 ? "AM" : "PM"}`
}

function size(bytes) {
  if (!bytes) return "0 KB"
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

function stamp(value) {
  return new Date(value).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
}

export function BackupSettings() {
  const [state, setState] = useState(null)
  const [form, setForm] = useState(null)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")
  const [saving, setSaving] = useState(false)
  const [restoring, setRestoring] = useState(null)
  const [file, setFile] = useState(null)
  const fileRef = useRef(null)
  const lastJob = useRef("")

  async function load() {
    try {
      const data = await api("/backups")
      setState(data)
      setForm((current) => current || { daily: data.settings.daily, hour: data.settings.hour, keepDays: data.settings.keepDays })
      return data
    } catch (err) {
      // While a restore runs the server may answer "not ready yet": keep waiting rather than failing.
      if (err.status !== 503) setError(err.message)
      return null
    }
  }

  useEffect(() => {
    load()
  }, [])

  const running = state?.job?.status === "running"
  useEffect(() => {
    if (!running) return
    const timer = setInterval(load, 1500)
    return () => clearInterval(timer)
  }, [running])

  // Say once when a job finishes.
  useEffect(() => {
    const job = state?.job
    if (!job || job.status === "running" || lastJob.current === `${job.id}:${job.status}`) return
    const first = !lastJob.current
    lastJob.current = `${job.id}:${job.status}`
    if (first && Date.now() - new Date(job.finishedAt).getTime() > 60000) return
    if (job.status === "failed") setError(`${job.type === "restore" ? "The restore" : "The backup"} did not finish: ${job.error}`)
    else if (job.type === "restore") setMessage(`Restored the backup from ${job.result?.backupCreatedAt ? stamp(job.result.backupCreatedAt) : "the file"}. ${job.result?.files?.restored ? `${job.result.files.restored} deleted ${job.result.files.restored === 1 ? "file was" : "files were"} brought back. ` : ""}${job.result?.files?.missing ? `${job.result.files.missing} ${job.result.files.missing === 1 ? "file has" : "files have"} no copy and could not be brought back. ` : ""}Reload the app to see the restored data.`)
    else setMessage("Backup made.")
  }, [state?.job])

  if (!state || !form) return error ? <p className="banner">{error}</p> : <section className="panel settings-card"><p className="settings-loading"><span className="spinner tw:animate-spin" /> Loading backups…</p></section>

  const settings = state.settings
  const changed = form.daily !== settings.daily || form.hour !== settings.hour || form.keepDays !== settings.keepDays
  const latest = state.backups[0]

  async function saveSchedule(event) {
    event.preventDefault()
    setSaving(true)
    setError("")
    setMessage("")
    try {
      const data = await api("/backups/settings", { method: "PATCH", body: form })
      setState((current) => ({ ...current, settings: data.settings }))
      setForm({ daily: data.settings.daily, hour: data.settings.hour, keepDays: data.settings.keepDays })
      setMessage(data.settings.daily ? `Saved. The daily backup runs at ${hourLabel(data.settings.hour)}.` : "Saved. Daily backups are off.")
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  async function backUpNow() {
    setError("")
    setMessage("")
    try {
      const data = await api("/backups", { method: "POST", body: {} })
      setState((current) => ({ ...current, job: data.job }))
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      {error && <p className="banner">{error}</p>}
      {message && <p className="settings-note backups-message">{message}{/Reload the app/.test(message) && <button type="button" className="tool" onClick={() => window.location.reload()}>Reload</button>}</p>}

      <section className="panel settings-card">
        <form className="settings-send" onSubmit={saveSchedule}>
          <div>
            <h2>Daily backup</h2>
            <p>Everything in SynergiFund is backed up once a day: properties, companies, loans and draws, expenses and receipts, payments, tasks, documents, chat, calls and members. Documents, photos and receipts are copied too, so a restore can bring back a file deleted since.</p>
          </div>
          <div className="settings-status settings-wide">
            <span className={settings.daily ? "is-on" : undefined}>{settings.daily ? `Every day at ${hourLabel(settings.hour)} (${settings.timezone.replace(/_/g, " ")})` : "Daily backups are off"}</span>
            <span className={latest ? "is-on" : undefined}>{latest ? `Last backup ${stamp(latest.createdAt)}` : "No backup yet"}</span>
            <span>{state.storage.label}</span>
          </div>
          <label className="field-check settings-wide"><input type="checkbox" checked={form.daily} onChange={(event) => setForm({ ...form, daily: event.target.checked })} /> Back up every day</label>
          <label className="field"><span>Time of day</span>
            <select value={form.hour} disabled={!form.daily} onChange={(event) => setForm({ ...form, hour: Number(event.target.value) })}>
              {Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{hourLabel(hour)}</option>)}
            </select>
          </label>
          <label className="field"><span>Keep backups for</span>
            <select value={form.keepDays} onChange={(event) => setForm({ ...form, keepDays: Number(event.target.value) })}>
              {settings.keepChoices.map((days) => <option key={days} value={days}>{days} days</option>)}
            </select>
          </label>
          <p className="settings-hint settings-wide">Older backups are removed after each new one; the newest three always stay.</p>
          <div className="settings-actions"><button className="primary" type="submit" disabled={saving || !changed}>{saving ? "Saving…" : "Save schedule"}</button></div>
        </form>
      </section>

      <section className="panel settings-card">
        <div className="settings-send backups-head">
          <div>
            <h2>Backups</h2>
            <p>Download one to keep a copy of your own, or restore one to put everything back the way it was then.</p>
          </div>
          <div className="settings-actions settings-wide">
            <button type="button" className="primary" onClick={backUpNow} disabled={running}>{running && state.job.type === "backup" ? "Backing up…" : "Back up now"}</button>
          </div>
          {running && (
            <p className="backups-progress settings-wide"><span className="spinner tw:animate-spin" /> {state.job.type === "restore" ? "Restoring" : "Backing up"}: {state.job.step}</p>
          )}
        </div>
        {state.backups.length === 0 ? (
          <p className="backups-empty">No backups yet. The first daily backup runs at {hourLabel(settings.hour)}, or press Back up now.</p>
        ) : (
          <ul className="backups-list">
            {state.backups.map((backup) => (
              <li key={backup.id}>
                <div>
                  <strong>{stamp(backup.createdAt)}</strong>
                  <small>{KINDS[backup.kind] || backup.kind}{backup.by && backup.kind !== "daily" ? ` · ${backup.by}` : ""} · {backup.documents.toLocaleString("en-US")} records · {(backup.files?.kept ?? 0).toLocaleString("en-US")} files · {size(backup.size)}</small>
                </div>
                <span className="row-actions">
                  <a href={`/api/backups/${backup.id}/download`} data-name={`synergifund-backup-${backup.id}.ndjson.gz`} data-size={backup.size}>Download</a>
                  <button type="button" className="danger" disabled={running} onClick={() => setRestoring({ backup })}>Restore</button>
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="panel settings-card">
        <div className="settings-send">
          <div>
            <h2>Restore from a file</h2>
            <p>A backup downloaded from this page (a .ndjson.gz file, up to 95 MB).</p>
          </div>
          <div className="backups-file settings-wide">
            <button type="button" className="tool" onClick={() => fileRef.current?.click()}>Choose a backup file</button>
            <span>{file ? file.name : "No file chosen"}</span>
            <input ref={fileRef} type="file" accept=".gz,application/gzip" hidden onChange={(event) => { setFile(event.target.files?.[0] || null); event.target.value = "" }} />
          </div>
          <div className="settings-actions settings-wide">
            <button type="button" className="danger" disabled={!file || running} onClick={() => setRestoring({ file })}>Restore this file</button>
          </div>
        </div>
      </section>

      {restoring && (
        <RestoreDialog
          target={restoring}
          onClose={() => setRestoring(null)}
          onStarted={(job) => {
            setRestoring(null)
            setFile(null)
            setError("")
            setMessage("")
            setState((current) => ({ ...current, job }))
          }}
        />
      )}
    </>
  )
}

function RestoreDialog({ target, onClose, onStarted }) {
  const [password, setPassword] = useState("")
  const [sure, setSure] = useState(false)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const label = target.backup ? `the backup from ${stamp(target.backup.createdAt)}` : `the file ${target.file.name}`

  async function confirm(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      let data
      if (target.backup) {
        data = await api(`/backups/${target.backup.id}/restore`, { method: "POST", body: { password } })
      } else {
        const body = new FormData()
        body.append("file", target.file, target.file.name)
        body.append("password", password)
        data = await uploadForm("/backups/restore-file", body)
      }
      onStarted(data.job)
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <Modal title="Restore a backup" onClose={pending ? () => {} : onClose}>
      <form className="restore-dialog" onSubmit={confirm}>
        <p>Everything in SynergiFund goes back to how it was in {label}. Changes made since then, by anyone, are replaced.</p>
        <p>The data as it is now is backed up first (it shows up as "Before a restore"), so you can undo this by restoring that backup.</p>
        <p>Nobody can make changes for the minute or so it takes, and people may need to sign in again.</p>
        {error && <div className="banner">{error}</div>}
        <label className="field"><span>Your password</span><PasswordInput autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required /></label>
        <label className="field-check keep-case"><input type="checkbox" checked={sure} onChange={(event) => setSure(event.target.checked)} /> I understand that the data since then is replaced.</label>
        <div className="restore-actions">
          <button type="button" className="tool" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className="primary restore-confirm" disabled={!sure || !password || pending}>{pending ? "Starting…" : "Restore"}</button>
        </div>
      </form>
    </Modal>
  )
}
