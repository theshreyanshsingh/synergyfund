"use client"

import Link from "next/link"
import { useEffect, useState } from "react"
import { ROLES, initials } from "@synergifund/shared"
import { StatusPill } from "../../../components/ui/StatusPill"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { AppOptions } from "../../../components/pwa/AppOptions"
import { AgentSettings } from "../../../components/agent/AgentSettings"
import { TeammateSettings } from "../../../components/agent/TeammateSettings"
import { PasswordInput } from "../../../components/ui/PasswordInput"
import { BackupSettings } from "../../../components/settings/BackupSettings"
import { pushEndpoint } from "../../../lib/pwa"

const roleLabel = Object.fromEntries(ROLES.map((role) => [role.id, role.label]))

export default function SettingsPage() {
  const session = useSession()
  const user = session?.user
  const [form, setForm] = useState({ currentPassword: "", nextPassword: "", confirmPassword: "" })
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [tab, setTab] = useState("profile")
  const [everywhere, setEverywhere] = useState({ pending: false, message: "", error: "" })
  const admin = user?.role === "admin"
  const tabs = [
    { id: "profile", label: "Profile" },
    { id: "app", label: "App" },
    ...(admin ? [{ id: "agent", label: "Agent" }, { id: "backups", label: "Backups" }] : []),
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

  // Every other phone and browser signs out (and stops getting notifications); this one stays signed in.
  async function signOutEverywhere() {
    if (!window.confirm("Sign out of SynergiFund on every other phone and computer? You stay signed in here.")) return
    setEverywhere({ pending: true, message: "", error: "" })
    try {
      const keepEndpoint = await pushEndpoint()
      const keepToken = window.SynergiFundNative?.pushToken || ""
      const data = await api("/auth/sign-out-everywhere", { method: "POST", body: { keepEndpoint, keepToken } })
      session.setUser(data.user)
      setEverywhere({ pending: false, message: "Your other phones and computers are signed out. You're still signed in here.", error: "" })
    } catch (err) {
      setEverywhere({ pending: false, message: "", error: err.message })
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
              <label className="field settings-wide"><span>Current password</span><PasswordInput autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required /></label>
              <label className="field"><span>New password</span><PasswordInput autoComplete="new-password" value={form.nextPassword} onChange={(event) => setForm({ ...form, nextPassword: event.target.value })} minLength={8} required /></label>
              <label className="field"><span>Confirm</span><PasswordInput autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} minLength={8} required /></label>
              <div className="settings-actions"><button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Update password"}</button></div>
            </form>
            <div className="settings-send">
              <div>
                <h2>Signed-in devices</h2>
                <p>Lost a phone, or signed in on a shared computer? Sign out everywhere else. They stop getting notifications too.</p>
              </div>
              {everywhere.error && <div className="banner settings-wide">{everywhere.error}</div>}
              {everywhere.message && <p className="settings-note settings-wide">{everywhere.message}</p>}
              <div className="settings-actions"><button type="button" onClick={signOutEverywhere} disabled={everywhere.pending}>{everywhere.pending ? "Signing out…" : "Sign out of other devices"}</button></div>
            </div>
            <p className="settings-note">How SynergiFund handles your information: <Link href="/privacy">Privacy Policy</Link></p>
          </section>
        )}
        {tab === "app" && <AppOptions />}
        {tab === "agent" && admin && <AgentSettings />}
        {tab === "agent" && admin && <TeammateSettings />}
        {tab === "backups" && admin && <BackupSettings />}
      </div>
    </div>
  )
}
