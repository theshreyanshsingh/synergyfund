"use client"

import { useEffect, useRef, useState } from "react"
import { initials } from "@synergifund/shared"
import { useChatEvents } from "../../lib/chatSocket"
import { api } from "../../lib/api"
import {
  callEvents,
  callLink,
  dismissBlocked,
  inviteToCall,
  reportAudioBlocked,
  callTitle,
  canShareScreen,
  declineCall,
  dismissNotice,
  joinCall,
  leaveCall,
  leaveOnUnload,
  setCallUser,
  setMinimized,
  soundsReady,
  toggleCamera,
  toggleMute,
  toggleScreen,
  unlockCallSounds,
  useCalls,
} from "../../lib/calls"
import { Icon } from "../ui/Icon"

export function formatClock(ms) {
  const total = Math.max(0, Math.floor(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = total % 60
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}` : `${minutes}:${String(seconds).padStart(2, "0")}`
}

function useNow(active) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!active) return undefined
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [active])
  return now
}

// Listens for calls everywhere in the app and shows the ringing card and the call window.
export function CallLayer({ user }) {
  const calls = useCalls()
  useChatEvents(callEvents, Boolean(user))

  useEffect(() => {
    setCallUser(user?.id || "")
  }, [user?.id])

  useEffect(() => {
    // A tap, click or key press unlocks sound so the next incoming call can ring (phones need a real tap, not a touch-down).
    const events = ["pointerup", "touchend", "keydown", "click"]
    const unlock = () => {
      unlockCallSounds()
      setTimeout(() => {
        if (soundsReady()) for (const name of events) window.removeEventListener(name, unlock, true)
      }, 0)
    }
    for (const name of events) window.addEventListener(name, unlock, true)
    window.addEventListener("pagehide", leaveOnUnload)
    return () => {
      for (const name of events) window.removeEventListener(name, unlock, true)
      window.removeEventListener("pagehide", leaveOnUnload)
    }
  }, [])

  return (
    <>
      {calls.incoming.length > 0 && (
        <div className="call-incoming-stack" role="region" aria-label="Incoming calls" aria-live="assertive">
          {calls.incoming.map((call) => <IncomingCall key={call.id} call={call} me={calls.me} />)}
        </div>
      )}
      {calls.current && <ActiveCall current={calls.current} me={calls.me} myName={user?.name || "You"} audioBlocked={calls.audioBlocked} />}
      {calls.notice && (
        <div className={`call-notice is-${calls.notice.tone}`} role="status">
          <span>{calls.notice.text}</span>
          <button type="button" onClick={dismissNotice} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      )}
    </>
  )
}

function IncomingCall({ call, me }) {
  const [busy, setBusy] = useState(false)
  const card = useRef(null)
  useEffect(() => {
    card.current?.focus({ preventScroll: true })
  }, [])
  const added = call.invitedBy && call.invitedBy !== call.startedByName
  const title = added ? call.invitedBy : call.channel?.kind === "direct" ? call.startedByName : callTitle(call, me)
  const where = added
    ? `added you · ${callTitle(call, me)}`
    : call.channel?.kind === "direct" ? (Object.keys(call.names || {}).length > 2 ? `Group call · ${callTitle(call, me)}` : "") : `${call.startedByName} · ${callTitle(call, me)}`
  async function accept(media) {
    setBusy(true)
    await joinCall(call.id, media)
    setBusy(false)
  }
  return (
    <div className="call-incoming" role="alertdialog" aria-label={`Incoming call from ${call.startedByName}`} ref={card} tabIndex={-1}>
      <span className="call-avatar is-ringing">{initials((added ? call.invitedBy : call.startedByName) || "?")}</span>
      <div className="call-incoming-copy">
        <strong>{title}</strong>
        <span>{call.media === "video" ? "Incoming video call" : "Incoming voice call"}{where ? ` · ${where}` : ""}</span>
      </div>
      <div className="call-incoming-actions">
        <button type="button" className="call-round is-danger" disabled={busy} onClick={() => declineCall(call.id)} aria-label="Decline" title="Decline"><Icon name="phoneOff" size={18} /></button>
        <button type="button" className="call-round is-accept" disabled={busy} onClick={() => accept("audio")} aria-label="Answer with voice" title="Answer with voice"><Icon name="phone" size={18} /></button>
        <button type="button" className="call-round is-accept" disabled={busy} onClick={() => accept("video")} aria-label="Answer with video" title="Answer with video"><Icon name="video" size={18} /></button>
      </div>
    </div>
  )
}

function statusText(current, now) {
  const others = (current.peers || []).length
  if (!others) return current.call?.answered ? "Waiting for others…" : "Ringing…"
  if (!(current.peers || []).some((peer) => peer.status === "connected")) {
    return (current.peers || []).every((peer) => peer.status === "failed") ? "Couldn’t connect" : "Connecting…"
  }
  return formatClock(now - (current.connectedAt || current.startedAt))
}

function ActiveCall({ current, me, myName, audioBlocked }) {
  const now = useNow(true)
  const [adding, setAdding] = useState(false)
  const screen = useRef(null)
  const expanded = !current.minimized
  useEffect(() => {
    if (!expanded) return undefined
    const element = screen.current
    // Focus the window itself (no ring around a button); Tab then moves through the controls.
    element?.focus({ preventScroll: true })
    function onKey(event) {
      if (event.key === "Escape") {
        if (element?.querySelector(".call-sheet")) return
        setMinimized(true)
        return
      }
      if (event.key !== "Tab" || !element) return
      // Keep keyboard focus inside the call window while it is open.
      const items = [...element.querySelectorAll("button:not([disabled]), input:not([disabled])")]
      if (!items.length) return
      const first = items[0]
      const last = items[items.length - 1]
      if (document.activeElement === element) {
        event.preventDefault()
        ;(event.shiftKey ? last : first).focus()
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [expanded])
  const title = callTitle(current.call, me)
  const peers = current.peers || []
  const sharing = peers.find((peer) => peer.screen) || (current.screen ? { peerId: "me" } : null)
  const status = statusText(current, now)

  return (
    <>
      {peers.map((peer) => <RemoteAudio key={peer.peerId} stream={peer.stream} version={peer.version} />)}
      {audioBlocked && (
        <button type="button" className="call-sound-unlock" onClick={() => {
          for (const element of document.querySelectorAll("audio.call-audio")) element.play?.().catch(() => {})
          reportAudioBlocked(false)
        }}>
          <Icon name="phone" size={15} />Tap to hear the call
        </button>
      )}
      {current.minimized ? (
        <div className="call-mini" role="region" aria-label="Call in progress">
          <button type="button" className="call-mini-open" onClick={() => setMinimized(false)} title="Open the call">
            <span className="call-live-dot" aria-hidden="true" />
            <span className="call-mini-copy"><strong>{title}</strong><em>{status}</em></span>
            <Icon name="expand" size={15} />
          </button>
          <button type="button" className={current.muted ? "call-round is-small is-off" : "call-round is-small"} onClick={toggleMute} aria-label={current.muted ? "Unmute" : "Mute"}><Icon name={current.muted ? "micOff" : "mic"} size={16} /></button>
          <button type="button" className="call-round is-small is-danger" onClick={leaveCall} aria-label="Leave call"><Icon name="phoneOff" size={16} /></button>
        </div>
      ) : (
        <div className="call-screen" role="dialog" aria-modal="true" aria-label={`Call with ${title}`} ref={screen} tabIndex={-1}>
          <header className="call-top">
            <div className="call-top-copy">
              <strong>{title}</strong>
              <span>{current.media === "video" ? "Video call" : "Voice call"} · {current.rejoining ? "Reconnecting…" : status}{peers.length ? ` · ${peers.length + 1} people` : ""}</span>
            </div>
            <button type="button" className="call-icon-button" onClick={() => setMinimized(true)} title="Keep the call in a small window and use the app" aria-label="Minimize call"><Icon name="shrink" size={18} /></button>
          </header>
          <div className={sharing ? "call-stage is-spotlight" : `call-stage call-grid count-${Math.min(peers.length + 1, 9)}`}>
            {sharing && (
              <div className="call-spotlight">
                {sharing.peerId === "me" ? (
                  <Tile self name="You" avatarName={myName} stream={current.local} version={current.localVersion} video screen muted={current.muted} speaking={(current.speaking || []).includes("me")} />
                ) : (
                  <Tile name={sharing.name} stream={sharing.stream} version={sharing.version} video screen muted={!sharing.audio} speaking={(current.speaking || []).includes(sharing.peerId)} status={sharing.status} />
                )}
              </div>
            )}
            <div className={sharing ? "call-strip" : "call-tiles"}>
              {(!sharing || sharing.peerId !== "me") && (
                <Tile self name="You" avatarName={myName} stream={current.local} version={current.localVersion} video={current.camera || current.screen} screen={current.screen} muted={current.muted} speaking={(current.speaking || []).includes("me")} />
              )}
              {peers.filter((peer) => !sharing || peer.peerId !== sharing.peerId).map((peer) => (
                <Tile key={peer.peerId} name={peer.name} stream={peer.stream} version={peer.version} video={peer.video || peer.screen} screen={peer.screen} muted={!peer.audio} speaking={(current.speaking || []).includes(peer.peerId)} status={peer.status} />
              ))}
            </div>
            {!peers.length && <p className="call-waiting">{current.call?.answered ? "Everyone else left. You can wait here or leave." : `Calling ${title}…`}</p>}
          </div>
          <footer className="call-controls">
            <ControlButton on={!current.muted} icon={current.muted ? "micOff" : "mic"} label={current.micLost ? "Mic stopped" : current.muted ? "Unmute" : "Mute"} onClick={toggleMute} />
            <ControlButton on={current.camera} icon={current.camera ? "video" : "videoOff"} label={current.camera ? "Stop video" : "Start video"} onClick={toggleCamera} />
            {canShareScreen() && <ControlButton on={current.screen} icon="screen" label={current.screen ? "Stop sharing" : "Share screen"} onClick={toggleScreen} active={current.screen} />}
            <ControlButton on icon="userPlus" label="Add people" onClick={() => setAdding(true)} />
            <button type="button" className="call-control is-leave" onClick={leaveCall}>
              <span className="call-round is-danger"><Icon name="phoneOff" size={20} /></span>
              <em>Leave</em>
            </button>
          </footer>
          {adding && <AddPeople current={current} me={me} onClose={() => setAdding(false)} />}
          {current.blocked && (
            <div className="call-blocked" role="alert">
              <strong>The call could not connect</strong>
              {current.relay ? (
                <span>Check the internet connection on both sides, then leave and call again.</span>
              ) : (
                <span>
                  A network on one side (often mobile data, office Wi‑Fi or a strict router) is blocking a direct connection.
                  These calls need a relay server. An admin can turn it on and test it under Settings › App › Call connection.
                </span>
              )}
              <button type="button" onClick={dismissBlocked}>OK</button>
            </div>
          )}
        </div>
      )}
    </>
  )
}

function ControlButton({ on, icon, label, onClick, active = false }) {
  return (
    <button type="button" className="call-control" onClick={onClick} aria-pressed={active || undefined}>
      <span className={`call-round${on ? "" : " is-off"}${active ? " is-active" : ""}`}><Icon name={icon} size={20} /></span>
      <em>{label}</em>
    </button>
  )
}

function Tile({ self = false, name, avatarName, stream, version, video, screen = false, muted, speaking, status }) {
  const ref = useRef(null)
  const hasVideo = Boolean(video && stream?.getVideoTracks().some((track) => track.readyState === "live" && (self || !track.muted)))
  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (element.srcObject !== stream) element.srcObject = stream || null
    if (stream) element.play?.().catch(() => {})
  }, [stream, version, hasVideo])
  return (
    <div className={`call-tile${self ? " is-self" : ""}${speaking && !muted ? " is-speaking" : ""}${screen ? " is-screen" : ""}`}>
      <video ref={ref} className={hasVideo ? (self && !screen ? "is-mirrored" : "") : "is-hidden"} autoPlay playsInline muted />
      {!hasVideo && <span className="call-avatar">{initials(avatarName || name || "?")}</span>}
      <span className="call-tile-name">
        {muted && <Icon name="micOff" size={13} />}
        {name}{screen ? " · sharing screen" : ""}
      </span>
      {status && status !== "connected" && <span className={status === "failed" ? "call-tile-status is-failed" : "call-tile-status"}>{status === "failed" ? "Couldn’t connect" : status === "reconnecting" ? "Reconnecting…" : "Connecting…"}</span>}
    </div>
  )
}

function RemoteAudio({ stream, version }) {
  const ref = useRef(null)
  useEffect(() => {
    const element = ref.current
    if (!element || !stream) return
    if (element.srcObject !== stream) element.srcObject = stream
    element.play?.().then(() => reportAudioBlocked(false)).catch((error) => {
      if (error?.name === "NotAllowedError") reportAudioBlocked(true)
    })
  }, [stream, version])
  return <audio ref={ref} autoPlay playsInline className="call-audio" />
}

// Ring more people into the call, or share a link that works while the call is on.
function AddPeople({ current, me, onClose }) {
  const [people, setPeople] = useState(null)
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)
  const [copied, setCopied] = useState(false)
  const box = useRef(null)
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  const inCall = new Set([me, ...(current.call?.participants || []).map((person) => person.userId), ...(current.peers || []).map((peer) => peer.userId)])
  const room = Math.max(0, (current.call?.max || 8) - inCall.size)
  const link = callLink()
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function"

  useEffect(() => {
    let alive = true
    api("/chat/bootstrap").then((data) => { if (alive) setPeople(data.people || []) }).catch((error) => { if (alive) { setPeople([]); setMessage({ tone: "bad", text: error.message }) } })
    box.current?.querySelector("input")?.focus({ preventScroll: true })
    function onKey(event) {
      if (event.key === "Escape") closeRef.current()
    }
    document.addEventListener("keydown", onKey)
    return () => {
      alive = false
      document.removeEventListener("keydown", onKey)
    }
  }, [])

  const needle = query.trim().toLowerCase()
  const choices = (people || []).filter((person) => !inCall.has(person.id) && (!needle || person.name.toLowerCase().includes(needle) || (person.email || "").toLowerCase().includes(needle)))

  async function ring() {
    if (!picked.length || busy) return
    setBusy(true)
    setMessage(null)
    const reply = await inviteToCall(picked)
    setBusy(false)
    if (reply.error) {
      setMessage({ tone: "bad", text: reply.error })
      return
    }
    setPicked([])
    setMessage({ tone: "good", text: `Ringing ${reply.names.join(", ")}.` })
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(link)
    } catch {
      const area = document.createElement("textarea")
      area.value = link
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      area.setSelectionRange(0, link.length)
      document.execCommand("copy")
      area.remove()
    }
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="call-sheet-backdrop" onMouseDown={onClose}>
      <div className="call-sheet" role="dialog" aria-modal="true" aria-label="Add people to the call" ref={box} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <strong>Add people</strong>
            <span>{room ? `${room} more ${room === 1 ? "person" : "people"} can join this call.` : "This call is full."}</span>
          </div>
          <button type="button" className="call-icon-button" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>
        <input type="search" className="call-sheet-search" value={query} placeholder="Search people" onChange={(event) => setQuery(event.target.value)} />
        <ul className="call-sheet-list">
          {people === null && <li className="call-sheet-empty">Loading people…</li>}
          {people !== null && !choices.length && <li className="call-sheet-empty">{needle ? "No one matches." : "Everyone you can call is already here."}</li>}
          {choices.map((person) => {
            const on = picked.includes(person.id)
            return (
              <li key={person.id}>
                <label className={on ? "call-sheet-person is-on" : "call-sheet-person"}>
                  <input type="checkbox" checked={on} disabled={!on && picked.length >= room} onChange={() => setPicked((list) => (on ? list.filter((id) => id !== person.id) : [...list, person.id]))} />
                  <span className="call-avatar is-tiny">{initials(person.name)}</span>
                  <span className="call-sheet-copy"><strong>{person.name}</strong><em>{person.online ? "Online" : "Offline"}</em></span>
                </label>
              </li>
            )
          })}
        </ul>
        {message && <p className={`call-sheet-note is-${message.tone}`}>{message.text}</p>}
        <button type="button" className="call-sheet-ring" disabled={!picked.length || busy} onClick={ring}>
          <Icon name="phone" size={15} />{busy ? "Ringing…" : picked.length ? `Ring ${picked.length} ${picked.length === 1 ? "person" : "people"}` : "Pick people to ring"}
        </button>
        {link && (
          <div className="call-sheet-share">
            <strong>Share a link</strong>
            <span>Anyone signed in to SynergiFund with this link can join while this call is on. It stops working when the call ends.</span>
            <div>
              <button type="button" onClick={copy}><Icon name="link" size={15} />{copied ? "Copied" : "Copy link"}</button>
              {canShare && <button type="button" onClick={() => navigator.share({ title: "Join my SynergiFund call", url: link }).catch(() => {})}><Icon name="share" size={15} />Share…</button>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
