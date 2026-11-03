"use client"

import { useState, useSyncExternalStore } from "react"
import { enablePush, inNativeApp, installApp, usePwa } from "../../lib/pwa"
import { Icon } from "../ui/Icon"
import { InstallGuide } from "./InstallGuide"

// Closed with its ✕: it stays away on this device (Settings still has Install and Notifications).
const CLOSED_KEY = "synergifund-install-card-closed"
const closedListeners = new Set()

function readClosed() {
  try {
    return localStorage.getItem(CLOSED_KEY) === "1"
  } catch {
    return false
  }
}

function subscribeClosed(listener) {
  closedListeners.add(listener)
  window.addEventListener("storage", listener)
  return () => {
    closedListeners.delete(listener)
    window.removeEventListener("storage", listener)
  }
}

// Closes every copy on the page (the sidebar's and the one at the top of the page).
function closeCard() {
  try {
    localStorage.setItem(CLOSED_KEY, "1")
  } catch {}
  for (const listener of closedListeners) listener()
}

// Step one: install the app. Step two: turn on notifications. Then it disappears, or sooner with its ✕.
export function InstallCard({ className = "" }) {
  const pwa = usePwa()
  const closed = useSyncExternalStore(subscribeClosed, readClosed, () => true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  const [guide, setGuide] = useState(false)

  // The phone app is already installed and brings its own notifications.
  if (!pwa.ready || pwa.pushOn || inNativeApp() || closed) return null
  const close = <button type="button" className="install-close" onClick={closeCard} aria-label="Close" title="Close"><Icon name="close" size={14} /></button>

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
        {close}
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
      {close}
    </div>
  )
}
