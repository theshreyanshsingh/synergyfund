"use client"

import { useEffect, useState } from "react"
import { api } from "../../lib/api"
import { AgentSpending } from "./AgentSpending"
import { ModelSelect } from "./ModelSelect"

export function AgentSettings() {
  const [settings, setSettings] = useState(null)
  const [models, setModels] = useState([])
  const [loadingModels, setLoadingModels] = useState(true)
  const [form, setForm] = useState({ taskModel: "", decisionModel: "" })
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    api("/agent/settings?documents=1")
      .then((data) => {
        setSettings(data.settings)
        setForm({ taskModel: data.settings.taskModel || "", decisionModel: data.settings.decisionModel || "" })
      })
      .catch((err) => setError(err.message))
    api("/agent/models")
      .then((data) => setModels(data.items || []))
      .catch((err) => setError(err.message))
      .finally(() => setLoadingModels(false))
  }, [])

  if (!settings) return error ? <p className="banner">{error}</p> : null
  if (!settings.canManage) return null

  const changed = form.taskModel !== settings.taskModel || form.decisionModel !== settings.decisionModel

  async function save(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    setMessage("")
    try {
      const data = await api("/agent/settings", { method: "PATCH", body: form })
      setSettings(data.settings)
      setForm({ taskModel: data.settings.taskModel, decisionModel: data.settings.decisionModel })
      setMessage("Saved. The agent uses these models for everyone from the next question.")
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  const pick = (key) => (id) => {
    setMessage("")
    setForm((current) => ({ ...current, [key]: id }))
  }

  return (
    <>
    <section className="panel settings-card">
      <form className="settings-send" onSubmit={save}>
        <div>
          <h2>Agent models</h2>
          <p>Applies to everyone in the workspace. Only models that can use tools are listed.</p>
        </div>
        <div className="settings-status settings-wide">
          <span className={settings.modelConnected ? "is-on" : undefined}>OpenRouter {settings.modelConnected ? "connected" : "not connected · add OPENROUTER_API_KEY"}</span>
          <span className={settings.webConnected ? "is-on" : undefined}>Firecrawl web search {settings.webConnected ? "connected" : "not connected · add FIRECRAWL_API_KEY"}</span>
        </div>
        {error && <div className="banner settings-wide">{error}</div>}
        {message && <p className="settings-note settings-wide">{message}</p>}
        <ModelSelect label="Task model" hint="looks up records and searches the web" value={form.taskModel} models={models} loading={loadingModels} onChange={pick("taskModel")} />
        <ModelSelect label="Decision model" hint="plans and writes the answer" value={form.decisionModel} models={models} loading={loadingModels} onChange={pick("decisionModel")} />
        <div className="settings-actions"><button className="primary" type="submit" disabled={pending || !changed}>{pending ? "Saving…" : "Save models"}</button></div>
      </form>
    </section>
    <AgentSpending settings={settings} onSaved={(next) => setSettings((current) => ({ ...current, ...next }))} />
    {settings.documents && <DocumentReading initial={settings.documents} />}
    </>
  )
}

const count = (value) => Number(value || 0).toLocaleString("en-US")

// How far the Agent has got reading the documents (it reads each one once to find it and answer from it), and the
// choice to have it read the ones that were there before it started.
function DocumentReading({ initial }) {
  const [reading, setReading] = useState(initial)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  // While documents are waiting, the numbers move: check again every few seconds.
  useEffect(() => {
    if (!reading.connected || !reading.waiting) return undefined
    const timer = setInterval(() => {
      api("/agent/settings?documents=1").then((data) => data.settings.documents && setReading(data.settings.documents)).catch(() => {})
    }, 8000)
    return () => clearInterval(timer)
  }, [reading.connected, reading.waiting])

  async function change(readAllDocuments) {
    if (readAllDocuments && !window.confirm(`The Agent will read the ${count(reading.older)} older documents in the background, one at a time. Each one uses the AI models (a small cost per document). Go ahead?`)) return
    setPending(true)
    setError("")
    try {
      const data = await api("/agent/settings", { method: "PATCH", body: { readAllDocuments } })
      setReading(data.settings.documents)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  const since = reading.readFrom ? new Date(reading.readFrom).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""
  const share = reading.total ? Math.round((reading.read / reading.total) * 100) : 0
  return (
    <section className="panel settings-card agent-reading">
      <div>
        <h2>Documents</h2>
        <p>The Agent reads each document once, so it can find exactly the one someone asks for and answer from what it says. New documents are read a few seconds after they are added. Reading sends a document's text to the Agent's AI models; what it learns is kept with the document and protected like the file.</p>
      </div>
      {error && <div className="banner">{error}</div>}
      {!reading.connected && <p className="settings-note">Connect OpenRouter (above) and the Agent starts reading.</p>}
      <div className="agent-reading-figures">
        <p><strong>{count(reading.read)}</strong> of {count(reading.total)} documents read</p>
        <div className="agent-reading-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={share} aria-label="Documents read"><i style={{ width: `${share}%` }} /></div>
        <p className="agent-reading-detail">
          {reading.waiting > 0 && <span>{count(reading.waiting)} being read</span>}
          {reading.failed > 0 && <span>{count(reading.failed)} could not be read</span>}
          {!reading.readAll && reading.older > 0 && <span>{count(reading.older)} added before {since} not read yet</span>}
        </p>
      </div>
      <div className="settings-actions">
        {!reading.readAll && reading.older > 0 && <button type="button" className="primary" disabled={pending || !reading.connected} onClick={() => change(true)}>{pending ? "Saving…" : `Read the ${count(reading.older)} older documents`}</button>}
        {reading.readAll && <button type="button" className="tool" disabled={pending} onClick={() => change(false)}>{pending ? "Saving…" : "Read new documents only"}</button>}
      </div>
    </section>
  )
}
