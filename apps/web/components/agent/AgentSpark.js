"use client"

import { useId } from "react"

// The Agent's mark: a four-pointed spark in the Agent's colours (the violet, pink and sky blue of its Talk light).
// While it works (`live`) the spark turns and breathes, and its colours run round it.
export function AgentSpark({ size = 18, live = false, className = "" }) {
  const id = `agent-spark-${useId().replace(/[^a-zA-Z0-9_-]/g, "")}`
  return (
    <svg className={["agent-spark", live ? "is-live" : "", className].filter(Boolean).join(" ")} width={size} height={size} viewBox="0 0 24 24" aria-hidden="true">
      <defs>
        <linearGradient id={id} x1="3" y1="3" x2="21" y2="21" gradientUnits="userSpaceOnUse">
          <stop offset="0" stopColor="#7b6cff" />
          <stop offset="0.55" stopColor="#ff62c7" />
          <stop offset="1" stopColor="#36c5ff" />
          {live && <animateTransform attributeName="gradientTransform" type="rotate" from="0 12 12" to="360 12 12" dur="2.4s" repeatCount="indefinite" />}
        </linearGradient>
      </defs>
      <path d="M12 2C12.6 7.4 16.6 11.4 22 12C16.6 12.6 12.6 16.6 12 22C11.4 16.6 7.4 12.6 2 12C7.4 11.4 11.4 7.4 12 2Z" fill={`url(#${id})`} />
    </svg>
  )
}
