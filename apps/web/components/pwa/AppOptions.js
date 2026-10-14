"use client"

import { useState } from "react"
import { useSession } from "../shell/Providers"
import { api } from "../../lib/api"
import { disablePush, enablePush, installApp, usePwa } from "../../lib/pwa"
import { InstallGuide } from "./InstallGuide"
import { can } from "@synergifund/shared"
import { CallCheck } from "../calls/CallCheck"
import { SoundSettings } from "./SoundSettings"

export function AppOptions() {
  const session = useSession()
  const admin = session?.user?.role === "admin"
  const pwa = usePwa()
  const [message, setMessage] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [guide, setGuide] = useState(false)
  const [notice, setNotice] = useState({ title: "", body: "", href: "/notifications" })
  const installed = pwa.installed
  const iosHint = pwa.platform === "ios" && !pwa.standalone

  async function install() {
    if (!pwa.installEvent) {
      setGuide(true)
      return
    }
    await installApp()
  }

  async function turnOn() {
    setError("")
    setMessage("")
    if (iosHint) {
      setError("Add SynergiFund to the Home Screen first, then open it from the icon and turn notifications on.")
      return
    }
    if (!pwa.pushSupported) {
      setError("This browser cannot receive push notifications.")
      return
    }
    setPending(true)
    try {
      await enablePush()
      setMessage("This device will receive notifications.")
    } catch (err) {
      setError(err.message || "Notifications could not be turned on.")
    } finally {
      setPending(false)
    }
  }

  async function turnOff() {
    setError("")
    setMessage("")
    setPending(true)
    try {
      await disablePush()
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
          <p>{installed ? "SynergiFund is installed on this device." : !pwa.installable ? "This browser cannot install apps. Use Chrome, Edge or Safari to install SynergiFund." : iosHint ? "Add SynergiFund to your Home Screen to get call and message notifications." : "Install SynergiFund so it opens from your home screen or dock."}</p>
        </div>
        {!installed && pwa.installable && <button type="button" className="primary" onClick={install}>Install</button>}
        {guide && <InstallGuide platform={pwa.platform} onClose={() => setGuide(false)} />}
      </div>
      <div className="settings-row">
        <div>
          <h2>Notifications</h2>
          <p>{pwa.pushOn ? "This device will receive notifications." : iosHint ? "Add SynergiFund to the Home Screen, open it from the icon, then turn notifications on." : pwa.permission === "denied" ? "Notifications are blocked. Allow them for this site in the browser settings." : pwa.permission === "unsupported" ? "This browser cannot receive notifications." : "Turn them on for this device."}</p>
        </div>
        {pwa.pushOn ? (
          <button type="button" className="tool" disabled={pending} onClick={turnOff}>Turn off</button>
        ) : (
          <button type="button" className="primary" disabled={pending || !pwa.ready || pwa.permission === "denied" || (pwa.permission === "unsupported" && !iosHint)} onClick={turnOn}>{pending ? "Saving…" : "Turn on"}</button>
        )}
      </div>
      {(error || message) && <p className={error ? "banner" : "settings-note"}>{error || message}</p>}
      <SoundSettings />
      {session?.user && can(session.user, "chat.use") && <CallCheck admin={admin} />}
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
