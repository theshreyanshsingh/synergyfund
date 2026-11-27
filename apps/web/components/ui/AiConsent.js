"use client"

import Link from "next/link"
import { useState } from "react"
import { useSession } from "../shell/Providers"
import { api } from "../../lib/api"

// The AI notice, asked once per account before the Agent, Talk, receipt reading or call notes are first used: what goes to outside
// AI models and why, and Agree. (Apple requires clear disclosure and explicit permission before personal data is shared
// with a third-party AI.) `what`: the feature asking, for the first line. `onAgree` runs once they have agreed.
export function AiConsent({ what = "The Agent", compact = false, onAgree = null }) {
  const session = useSession()
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")

  async function agree() {
    setPending(true)
    setError("")
    try {
      const data = await api("/auth/me/ai-consent", { method: "POST", body: { agree: true } })
      session.setUser(data.user)
      onAgree?.()
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <section className={compact ? "ai-consent is-compact" : "ai-consent"} aria-label="About AI in SynergiFund">
      <h3>{what} uses AI from outside companies</h3>
      <p>
        SynergiFund's Agent, Talk, receipt reading, AI call notes and the AI teammate in property chats are powered by AI
        models from other companies, reached through OpenRouter. When you use them, what's needed is sent to that model:
        your question or what you say, files and photos you add, your messages and photos in property chats the teammate
        reads, and the workspace records looked up to answer. It isn't used for advertising.
      </p>
      {error && <p className="ai-consent-error" role="alert">{error}</p>}
      <div className="ai-consent-actions">
        <Link href="/privacy">Privacy policy</Link>
        <button type="button" className="primary" disabled={pending} onClick={agree}>{pending ? "Saving…" : "Agree and continue"}</button>
      </div>
    </section>
  )
}
