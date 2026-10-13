"use client"

import { useEffect, useSyncExternalStore } from "react"
import { createRoot } from "react-dom/client"
import { callTitle, canShareScreen, leaveCall, toggleCamera, toggleMute, toggleScreen, useCalls } from "../../lib/calls"
import { Icon } from "../ui/Icon"
import { statusText, Tile, useNow } from "./CallParts"

// A small call window that floats above other tabs and apps (Chrome and Edge on computers),
// like Google Meet's. It opens by itself when you switch away during a call, or from "Pop out".

let pipWindow = null
let pipRoot = null
let opening = null
const listeners = new Set()

function changed() {
  for (const listener of listeners) listener()
}

export function pipSupported() {
  return typeof window !== "undefined" && "documentPictureInPicture" in window
}

export function usePipOpen() {
  return useSyncExternalStore((listener) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  }, () => Boolean(pipWindow), () => false)
}

// The floating window is a separate page; give it the app's styles, font and theme.
function copyLook(target) {
  for (const sheet of [...document.styleSheets]) {
    try {
      const style = target.document.createElement("style")
      style.textContent = [...sheet.cssRules].map((rule) => rule.cssText).join("\n")
      target.document.head.appendChild(style)
    } catch {
      if (!sheet.href) continue
      const link = target.document.createElement("link")
      link.rel = "stylesheet"
      link.href = sheet.href
      target.document.head.appendChild(link)
    }
  }
  const theme = document.documentElement.dataset.theme
  if (theme) target.document.documentElement.dataset.theme = theme
  target.document.body.className = `${document.body.className} call-pip-body`
  target.document.title = "SynergiFund call"
}

export async function openCallPip({ myName } = {}) {
  if (!pipSupported()) return false
  if (pipWindow) return true
  if (opening) return opening
  opening = (async () => {
    try {
      const target = await window.documentPictureInPicture.requestWindow({ width: 340, height: 400 })
      copyLook(target)
      const host = target.document.createElement("div")
      host.className = "call-pip-host"
      target.document.body.appendChild(host)
      pipRoot = createRoot(host)
      pipRoot.render(<PipView myName={myName || "You"} />)
      pipWindow = target
      target.addEventListener("pagehide", () => {
        try {
          pipRoot?.unmount()
        } catch {}
        pipRoot = null
        pipWindow = null
        changed()
      }, { once: true })
      changed()
      return true
    } catch {
      // Chrome only allows this right after a click or when switching away during a call.
      return false
    } finally {
      opening = null
    }
  })()
  return opening
}

export function closeCallPip() {
  try {
    pipWindow?.close()
  } catch {}
}

// While a call is on, let Chrome open the floating window by itself when you switch to another tab or app.
export function useAutoPip(active, myName) {
  useEffect(() => {
    if (!active || typeof navigator === "undefined" || !navigator.mediaSession || !pipSupported()) return undefined
    try {
      navigator.mediaSession.setActionHandler("enterpictureinpicture", () => {
        openCallPip({ myName })
      })
    } catch {
      // This browser does not offer automatic picture-in-picture.
    }
    return () => {
      try {
        navigator.mediaSession.setActionHandler("enterpictureinpicture", null)
      } catch {}
    }
  }, [active, myName])

  useEffect(() => {
    if (!active) closeCallPip()
  }, [active])
}

function PipView({ myName }) {
  const calls = useCalls()
  const current = calls.current
  const now = useNow(true)

  useEffect(() => {
    if (current) return undefined
    const timer = setTimeout(closeCallPip, 1200)
    return () => clearTimeout(timer)
  }, [current])

  if (!current) return <div className="call-pip is-over"><strong>Call ended</strong></div>

  const peers = current.peers || []
  const sharing = peers.find((peer) => peer.screen)
  const shown = sharing ? [sharing] : peers.slice(0, 4)
  return (
    <div className="call-pip">
      <header>
        <span className="call-live-dot" aria-hidden="true" />
        <div>
          <strong>{callTitle(current.call, calls.me)}</strong>
          <em>{statusText(current, now)}{peers.length ? ` · ${peers.length + 1} people` : ""}</em>
        </div>
      </header>
      <div className={`call-pip-tiles count-${Math.min(shown.length + (sharing ? 0 : 1), 5)}`}>
        {shown.map((peer) => (
          <Tile key={peer.peerId} name={peer.name} stream={peer.stream} version={peer.version} video={peer.video || peer.screen} screen={peer.screen} muted={!peer.audio} speaking={(current.speaking || []).includes(peer.peerId)} status={peer.status} />
        ))}
        {!sharing && (
          <Tile self name="You" avatarName={myName} stream={current.local} version={current.localVersion} video={current.camera || current.screen} screen={current.screen} muted={current.muted} speaking={(current.speaking || []).includes("me")} />
        )}
      </div>
      <footer>
        <button type="button" className={current.muted ? "call-round is-small is-off" : "call-round is-small"} onClick={toggleMute} aria-label={current.muted ? "Unmute" : "Mute"} title={current.muted ? "Unmute" : "Mute"}><Icon name={current.muted ? "micOff" : "mic"} size={16} /></button>
        <button type="button" className={current.camera ? "call-round is-small" : "call-round is-small is-off"} onClick={toggleCamera} aria-label={current.camera ? "Stop video" : "Start video"} title={current.camera ? "Stop video" : "Start video"}><Icon name={current.camera ? "video" : "videoOff"} size={16} /></button>
        {current.screen && canShareScreen() && (
          <button type="button" className="call-round is-small is-active" onClick={toggleScreen} aria-label="Stop sharing your screen" title="Stop sharing your screen"><Icon name="screen" size={16} /></button>
        )}
        <button type="button" className="call-round is-small is-danger" onClick={leaveCall} aria-label="Leave call" title="Leave call"><Icon name="phoneOff" size={16} /></button>
      </footer>
    </div>
  )
}
