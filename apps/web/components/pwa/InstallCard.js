"use client"

import { useState } from "react"
import { enablePush, installApp, usePwa } from "../../lib/pwa"
import { InstallGuide } from "./InstallGuide"

// Step one: install the app. Step two: turn on notifications. Then it disappears.
export function InstallCard({ className = "" }) {
  const pwa = usePwa()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [guide, setGuide] = useState(false)

  if (!pwa.ready || pwa.pushOn) return null

  if (!pwa.installed && pwa.installable) {
    // Chrome and Edge (Android and computers) show their own install prompt; iPhone, iPad and Safari need a short guide.
    async function install() {
      if (!pwa.installEvent) {
        setGuide(true)
        return
      }
      setBusy(true)
      try {
        await installApp()
      } finally {
        setBusy(false)
      }
    }
    return (
      <div className={`install-card ${className}`.trim()}>
        <div>
          <strong>Install the SynergiFund app</strong>
          <span>{pwa.platform === "ios" ? "Add it to your Home Screen to get call and message notifications." : "Open it from your home screen or dock like any other app."}</span>
        </div>
        <button type="button" className="primary" disabled={busy} onClick={install}>{busy ? "Installing…" : "Install"}</button>
        {guide && <InstallGuide platform={pwa.platform} onClose={() => setGuide(false)} />}
      </div>
    )
  }

  if (!pwa.pushChecked || !pwa.pushSupported) return null

  async function turnOn() {
    setError("")
    setBusy(true)
    try {
      await enablePush()
    } catch (err) {
      setError(err.message || "Notifications could not be turned on.")
    } finally {
      setBusy(false)
    }
  }

  const blocked = pwa.permission === "denied"
  return (
    <div className={`install-card ${className}`.trim()}>
      <div>
        <strong>Turn on notifications</strong>
        <span>{error || (blocked ? "Notifications are blocked. Allow them for this site in the browser settings." : "Get draw, chat and payment alerts on this device.")}</span>
      </div>
      {!blocked && <button type="button" className="primary" disabled={busy} onClick={turnOn}>{busy ? "Turning on…" : "Turn on"}</button>}
    </div>
  )
}
