"use client"

import { useEffect, useState } from "react"

export function VoiceWaves({ listening }) {
  const [heights, setHeights] = useState([0.3, 0.5, 0.8, 0.4, 0.6])

  useEffect(() => {
    if (!listening) return
    const timer = setInterval(() => setHeights((current) => current.map(() => 0.2 + Math.random() * 0.8)), 150)
    return () => clearInterval(timer)
  }, [listening])

  if (!listening) return null
  return (
    <div className="agent-waves" role="status">
      <div className="agent-waves-bars" aria-hidden="true">
        {heights.map((height, index) => (
          <i key={index} style={{ height: `${8 + height * 16}px`, opacity: 0.7 + height * 0.3 }} />
        ))}
      </div>
      <span>Listening...</span>
    </div>
  )
}
