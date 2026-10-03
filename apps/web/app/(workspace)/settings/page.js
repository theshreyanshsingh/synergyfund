"use client"

import { useState } from "react"
import { ROLES, initials } from "@synergifund/shared"
import { StatusPill } from "../../../components/ui/StatusPill"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"

const roleLabel = Object.fromEntries(ROLES.map((role) => [role.id, role.label]))

export default function SettingsPage() {
  const session = useSession()
  const user = session?.user
  const [form, setForm] = useState({ currentPassword: "", nextPassword: "", confirmPassword: "" })
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
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
        <h1 className="page-title">Settings</h1>
      </div>
      <section className="panel settings-account">
        <div className="member-id">
          <span className="avatar lg">{initials(user.name)}</span>
          <span>
            <strong>{user.name}</strong>
            <small>{user.email}</small>
          </span>
        </div>
        <div className="settings-role"><StatusPill>{roleLabel[user.role] || user.role}</StatusPill></div>
        <h2>Change password</h2>
        <p className="muted">Enter your current password, then choose a new one.</p>
        <form onSubmit={changePassword}>
          {error && <div className="banner">{error}</div>}
          {message && <p className="settings-note">{message}</p>}
          <div className="settings-fields">
            <label className="field"><span>Current password</span><input type="password" autoComplete="current-password" value={form.currentPassword} onChange={(event) => setForm({ ...form, currentPassword: event.target.value })} required /></label>
            <label className="field"><span>New password</span><input type="password" autoComplete="new-password" value={form.nextPassword} onChange={(event) => setForm({ ...form, nextPassword: event.target.value })} minLength={8} required /></label>
            <label className="field"><span>Confirm new password</span><input type="password" autoComplete="new-password" value={form.confirmPassword} onChange={(event) => setForm({ ...form, confirmPassword: event.target.value })} minLength={8} required /></label>
          </div>
          <button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : "Update password"}</button>
        </form>
      </section>
    </div>
  )
}
