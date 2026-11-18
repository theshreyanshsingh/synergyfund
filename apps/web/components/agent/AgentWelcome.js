"use client"

import { useState } from "react"
import { useSession } from "../shell/Providers"
import { Icon } from "../ui/Icon"
import { pickGreeting, suggestionsFor } from "./greetings"

// A new chat: a big two-line greeting (picked at random from greetings.js each time), then Suggested: questions to
// start with a tap (`onSuggest` gets the one tapped). A temporary chat says so instead.
export function AgentWelcome({ temporary, onSuggest = null }) {
  const session = useSession()
  const name = String(session?.user?.name || "").trim().split(/\s+/)[0] || "there"
  const [greeting] = useState(() => pickGreeting(name))
  const suggestions = onSuggest ? suggestionsFor(session?.user) : []
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
      <h2><span>{greeting.hello}</span> <span>{greeting.ask}</span></h2>
      {suggestions.length > 0 && (
        <section className="agent-suggest" aria-label="Suggested">
          <p>Suggested</p>
          <ul>
            {suggestions.map((item) => (
              <li key={item.text}>
                <button type="button" onClick={() => onSuggest(item)}>
                  <Icon name="suggest" size={15} />
                  <span>{item.text}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}
