"use client"

import { useEffect, useState } from "react"
import { useSession } from "../shell/Providers"
import { api } from "../../lib/api"

export function AppOptions() {
  const session = useSession()
  const admin = session?.user?.role === "admin"
  const [installEvent, setInstallEvent] = useState(null)
  const [installed, setInstalled] = useState(false)
  const [pushOn, setPushOn] = useState(false)
  const [supported, setSupported] = useState(true)
  const [iosHint, setIosHint] = useState(false)
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState({ title: "", body: "", href: "/notifications" })

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)").matches || window.navigator.standalone === true
    setInstalled(standalone)
    const ios = /iphone|ipad|ipod/i.test(window.navigator.userAgent)
    setIosHint(ios && !standalone)
    setSupported("serviceWorker" in navigator && "PushManager" in window && "Notification" in window)
    function rememberInstall(event) {
      event.preventDefault()
      setInstallEvent(event)
    }
    window.addEventListener("beforeinstallprompt", rememberInstall)
    navigator.serviceWorker?.register("/sw.js").then((registration) => registration.pushManager.getSubscription()).then((subscription) => {
      setPushOn(Boolean(subscription))
    }).catch(() => {})
    return () => window.removeEventListener("beforeinstallprompt", rememberInstall)
  }, [])

  async function install() {
    if (!installEvent) return
    installEvent.prompt()
    const choice = await installEvent.userChoice
    setInstallEvent(null)
    if (choice.outcome === "accepted") setInstalled(true)
  }

  async function enablePush() {
    setError("")
    setMessage("")
    if (!supported) {
      setError("This browser cannot receive push notifications.")
      return
    }
    if (iosHint) {
      setError("Add SynergiFund to the Home Screen first, then open it from the icon and turn notifications on.")
      return
    }
    const permission = await Notification.requestPermission()
    if (permission !== "granted") {
      setError("Notifications stay off until the browser is allowed to show them.")
      return
    }
    setPending(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const { publicKey } = await api("/push/vapid-public-key")
      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      })
      await api("/push/subscribe", { method: "POST", body: subscription.toJSON() })
      setPushOn(true)
      setMessage("This device will receive notifications.")
    } catch (err) {
      setError(err.message || "Notifications could not be turned on.")
    } finally {
      setPending(false)
    }
  }

  async function disablePush() {
    setError("")
    setMessage("")
    setPending(true)
    try {
      const registration = await navigator.serviceWorker.ready
      const subscription = await registration.pushManager.getSubscription()
      if (subscription) {
        await api("/push/subscribe", { method: "DELETE", body: { endpoint: subscription.endpoint } })
        await subscription.unsubscribe()
      }
      setPushOn(false)
      setMessage("Notifications are off on this device.")
    } catch (err) {
      setError(err.message || "Notifications could not be turned off.")
    } finally {
      setPending(false)
    }
  }

  async function send(event) {
    event.preventDefault()
    setError("")
    setMessage("")
    setPending(true)
    try {
      const result = await api("/push/send", { method: "POST", body: notice })
      setMessage(`Sent to ${result.sent} device${result.sent === 1 ? "" : "s"}${result.failed ? `. ${result.failed} could not be reached.` : "."}`)
      setNotice({ title: "", body: "", href: "/notifications" })
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <section className="panel settings-card">
      <div className="settings-row">
        <div>
          <h2>Home screen</h2>
          <p>{installed ? "This device is already using the installed app." : iosHint ? "On iPhone, use Share, then Add to Home Screen." : "Install SynergiFund so it opens from your home screen."}</p>
        </div>
        {installEvent && !installed && <button type="button" className="primary" onClick={install}>Install</button>}
      </div>
      <div className="settings-row">
        <div>
          <h2>Notifications</h2>
          <p>{pushOn ? "This device will receive notifications." : "Turn them on for this device."}</p>
        </div>
        {pushOn ? (
          <button type="button" className="tool" disabled={pending} onClick={disablePush}>Turn off</button>
        ) : (
          <button type="button" className="primary" disabled={pending || !supported} onClick={enablePush}>{pending ? "Saving…" : "Turn on"}</button>
        )}
      </div>
      {(error || message) && <p className={error ? "banner" : "settings-note"}>{error || message}</p>}
      {admin && (
        <form className="settings-send" onSubmit={send}>
          <div>
            <h2>Send a notification</h2>
            <p>Only an admin can send this. It reaches every device that has notifications on.</p>
          </div>
          <label className="field"><span>Title</span><input value={notice.title} onChange={(event) => setNotice({ ...notice, title: event.target.value })} required /></label>
          <label className="field"><span>Message</span><input value={notice.body} onChange={(event) => setNotice({ ...notice, body: event.target.value })} /></label>
          <label className="field"><span>Opens</span><input value={notice.href} onChange={(event) => setNotice({ ...notice, href: event.target.value })} placeholder="/notifications" /></label>
          <div className="settings-actions"><button className="primary" type="submit" disabled={pending}>{pending ? "Sending…" : "Send"}</button></div>
        </form>
      )}
    </section>
  )
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}
