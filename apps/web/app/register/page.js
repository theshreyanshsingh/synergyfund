import Link from "next/link"

export default function RegisterPage() {
  return (
    <main className="auth-screen">
      <section className="auth-card">
        <span className="mark">S</span>
        <h1>Sign in</h1>
        <p>Accounts are created by an admin.</p>
        <div className="auth-links"><Link href="/login">Back to sign in</Link></div>
      </section>
    </main>
  )
}
