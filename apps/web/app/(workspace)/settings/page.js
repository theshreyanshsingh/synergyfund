"use client"

import { useEffect, useState } from "react"
import { ROLES, initials } from "@synergifund/shared"
import { StatusPill } from "../../../components/ui/StatusPill"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { AppOptions } from "../../../components/pwa/AppOptions"
import { AgentSettings } from "../../../components/agent/AgentSettings"

const roleLabel = Object.fromEntries(ROLES.map((role) => [role.id, role.label]))

export default function SettingsPage() {
  const session = useSession()
  const user = session?.user
  const [form, setForm] = useState({ currentPassword: "", nextPassword: "", confirmPassword: "" })
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [tab, setTab] = useState("profile")
  const admin = user?.role === "admin"
  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "app", label: "App" },
    ...(admin ? [{ id: "agent", label: "Agent" }] : []),
  ]

  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get("tab")
    if (wanted && tabs.some((item) => item.id === wanted)) setTab(wanted)
  }, [admin])

  function choose(next) {
    setTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set("tab", next)
    window.history.replaceState(null, "", url)
  }

  if (!user) return null

  async function changePassword(event) {
    event.preventDefault()
    setMessage("")
    if (form.nextPassword !== form.confirmPassword) {
      setError("The new password and confirmation do not match.")
      return
    }
    setPending(true)
    setError("")
    try {
      const data = await api("/auth/password", { method: "POST", body: form })
      session.setUser(data.user)
      setForm({ currentPassword: "", nextPassword: "", confirmPassword: "" })
      setMessage("Your password is updated. Use it the next time you sign in.")
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <div className="workspace">
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title">Settings</h1>
          <div className="property-switch" role="tablist" aria-label="Settings sections">
            {tabs.map((item) => (
              <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} className={tab === item.id ? "is-on" : ""} onClick={() => choose(item.id)}>{item.label}</button>
            ))}
          </div>
        </div>
      </div>
      <div className="settings-panel">
        {tab === "profile" && (
          <section className="panel settings-card">
            <div className="settings-identity">
              <span className="avatar lg">{initials(user.name)}</span>
              <span>
                <strong>{user.name}</strong>
                <small>{user.email}</small>
              </span>
              <StatusPill>{roleLabel[user.role] || user.role}</StatusPill>
            </div>
            <form className="settings-send" onSubmit={changePassword}>
              <div>
                <h2>Password</h2>
                <p>Use the new password the next time you sign in.</p>
              </div>
              {error && <div className="banner settings-wide">{error}</div>}
              {message && <p className="settings-note settings-wide">{message}</p>}
              <label className="field settings-wide"><span>Current password</span><input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required /></label>
              <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={form.nextPassword} onChange={(event) => setForm({ ...form, nextPassword: event.target.value })} minLength={8} required /></label>
              <label className="field"><span>Confirm</span><input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} minLength={8} required /></label>
              <div className="settings-actions"><button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Update password"}</button></div>
            </form>
          </section>
        )}
        {tab === "app" && <AppOptions />}
        {tab === "agent" && admin && <AgentSettings />}
      </div>
    </div>
  )
}
