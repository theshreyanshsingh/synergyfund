"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { homeFor } from "@synergifund/shared"
import { api } from "../../lib/api"
import { useSession } from "../../components/shell/Providers"

export default function LoginPage() {
  const router = useRouter()
  const session = useSession()
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const data = await api("/auth/login", { method: "POST", body: { email, password } })
      session.setUser(data.user)
      router.replace(homeFor(data.user))
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <span className="mark">S</span>
        <h1>Sign in</h1>
        <p>Use the email and password for your SynergiFund workspace.</p>
        <div className="stack">
          {error && <div className="banner">{error}</div>}
          <label className="field">
            <span>Email</span>
            <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required />
          </label>
          <label className="field">
            <span>Password</span>
            <input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} required />
          </label>
          <button className="primary" type="submit" disabled={pending}>{pending ? "Signing in…" : "Sign in"}</button>
        </div>
      </form>
    </main>
  )
}
