"use client"

import { useState } from "react"
import { useSession } from "../shell/Providers"
import { Icon } from "../ui/Icon"
import { pickGreeting } from "./greetings"

// A new chat: one big greeting (picked at random from greetings.js each time). A temporary chat says so instead.
export function AgentWelcome({ temporary }) {
  const session = useSession()
  const name = String(session?.user?.name || "").trim().split(/\s+/)[0] || "there"
  const [greeting] = useState(() => pickGreeting(name))
  if (temporary) {
    return (
      <div className="agent-welcome is-temporary">
        <span className="agent-welcome-icon"><Icon name="tempChat" size={28} /></span>
        <h2>You're in a temporary chat</h2>
      </div>
    )
  }
  return (
    <div className="agent-welcome">
      <h2>{greeting}</h2>
    </div>
  )
}
