"use client"

import { useEffect, useState } from "react"
import { api } from "../../lib/api"
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
    api("/agent/settings")
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
  )
}
