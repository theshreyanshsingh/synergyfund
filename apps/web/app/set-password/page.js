"use client"

import { Suspense, useEffect, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { api } from "../../lib/api"
import { landingFor, useSession } from "../../components/shell/Providers"
import { PasswordInput } from "../../components/ui/PasswordInput"

// Where a password link opens (an invitation, "Forgot password", or one an admin sent): choose a password, and you're
// signed in. A link works once.
export default function SetPasswordPage() {
  return (
    <Suspense fallback={<main className="auth-screen" />}>
      <SetPassword />
    </Suspense>
  )
}

function SetPassword() {
  const router = useRouter()
  const session = useSession()
  const token = useSearchParams().get("token") || ""
  const [link, setLink] = useState(null)
  const [problem, setProblem] = useState("")
  const [form, setForm] = useState({ password: "", confirm: "" })
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  useEffect(() => {
    if (!token) {
      setProblem("This link is missing its code. Open it from the email again, or ask for a new one.")
      return
    }
    api(`/auth/password-link?token=${encodeURIComponent(token)}`)
      .then(setLink)
      .catch((err) => setProblem(err.message))
  }, [token])

  async function submit(event) {
    event.preventDefault()
    if (form.password !== form.confirm) {
      setError("The passwords don't match.")
      return
    }
    setPending(true)
    setError("")
    try {
      const data = await api("/auth/password-link", { method: "POST", body: { token, password: form.password } })
      session.setUser(data.user)
      router.replace(landingFor(data.user))
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  const invite = link?.purpose === "invite"
  return (
    <main className="auth-screen">
      <form className="auth-card" onSubmit={submit}>
        <span className="mark">S</span>
        <h1>{invite ? "Welcome to SynergiFund" : "Choose a new password"}</h1>
        {problem ? (
          <>
            <div className="banner" role="alert">{problem}</div>
            <div className="auth-links"><Link href="/forgot-password">Get a new link</Link><Link href="/login">Sign in</Link></div>
          </>
        ) : !link ? (
          <p>Checking your link…</p>
        ) : (
          <>
            <p>{invite ? `Hi ${link.name}, choose a password for ${link.email}.` : `For ${link.email}. Your other devices will be signed out.`}</p>
            <div className="stack">
              {error && <div className="banner">{error}</div>}
              <input type="email" autoComplete="username" value={link.email} readOnly hidden />
              <label className="field">
                <span>New password</span>
                <PasswordInput autoComplete="new-password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} minLength={8} required autoFocus />
              </label>
              <label className="field">
                <span>Confirm</span>
                <PasswordInput autoComplete="new-password" value={form.confirm} onChange={(event) => setForm({ ...form, confirm: event.target.value })} minLength={8} required />
              </label>
              <button className="primary" type="submit" disabled={pending}>{pending ? "Saving…" : invite ? "Set password and sign in" : "Save and sign in"}</button>
            </div>
            <div className="auth-links"><Link href="/login">Back to sign in</Link><Link href="/support">Help</Link></div>
          </>
        )}
      </form>
    </main>
  )
}
