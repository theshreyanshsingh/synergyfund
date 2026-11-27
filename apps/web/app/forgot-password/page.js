"use client"

import { useState } from "react"
import Link from "next/link"
import { api } from "../../lib/api"

// "Forgot password": we email a link to choose a new one. The answer is the same whether or not the email has an
// account.
export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("")
  const [sent, setSent] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const data = await api("/auth/forgot", { method: "POST", body: { email } })
      setSent(data.message)
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
        <h1>Forgot password</h1>
        {sent ? (
          <>
            <p role="status">{sent}</p>
            <p>No email after a few minutes? Check your spam folder, or ask your workspace administrator.</p>
          </>
        ) : (
          <>
            <p>Enter the email you sign in with. We'll email you a link to choose a new password.</p>
            <div className="stack">
              {error && <div className="banner">{error}</div>}
              <label className="field">
                <span>Email</span>
                <input type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
              </label>
              <button className="primary" type="submit" disabled={pending}>{pending ? "Sending…" : "Email me a link"}</button>
            </div>
          </>
        )}
        <div className="auth-links"><Link href="/login">Back to sign in</Link><Link href="/support">Help</Link></div>
      </form>
    </main>
  )
}
