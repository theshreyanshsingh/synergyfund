"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { initials } from "@synergifund/shared"
import { channelTitle } from "../../../components/chat/chatFormat"
import { formatClock } from "../../../components/calls/CallLayer"
import { FormSheet } from "../../../components/ui/FormSheet"
import { Icon } from "../../../components/ui/Icon"
import { PageSpinner } from "../../../components/ui/Spinner"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { callTitle, joinCall, peekCall, setMinimized, startCall, useCalls } from "../../../lib/calls"
import { useChatEvents } from "../../../lib/chatSocket"

export default function CallsPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <CallsScreen />
    </Suspense>
  )
}

function when(value) {
  if (!value) return ""
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 1)
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (date.toDateString() === today.toDateString()) return `Today ${time}`
  if (date.toDateString() === yesterday.toDateString()) return `Yesterday ${time}`
  return `${date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() === today.getFullYear() ? undefined : "numeric" })} ${time}`
}

function CallsScreen() {
  const session = useSession()
  const router = useRouter()
  const params = useSearchParams()
  const calls = useCalls()
  const [history, setHistory] = useState(null)
  const [boot, setBoot] = useState(null)
  const [error, setError] = useState("")
  const [picking, setPicking] = useState(false)
  const [filter, setFilter] = useState("all")
  const me = session?.user?.id || ""
  const joinId = params.get("join") || ""
  const joinKey = params.get("key") || ""
  const answerNow = params.get("answer") === "1"
  const [target, setTarget] = useState({ state: "idle" })
  const answered = useRef("")

  async function load() {
    try {
      const data = await api("/calls")
      setHistory(data.items || [])
      setError("")
    } catch (err) {
      setError(err.message)
      setHistory((current) => current || [])
    }
  }

  useEffect(() => {
    load()
    api("/chat/bootstrap").then(setBoot).catch(() => {})
  }, [])

  // Refresh the history when a call starts or ends anywhere the person can see.
  useChatEvents({ "call:update": () => setTimeout(load, 600) }, true)

  const people = useMemo(() => new Map((boot?.people || []).map((person) => [person.id, person])), [boot])
  const live = Object.values(calls.live)
  // Opened from a call link or a phone notification: check the call, and join straight away for "Answer".
  useEffect(() => {
    if (!joinId) {
      setTarget({ state: "idle" })
      return undefined
    }
    let alive = true
    setTarget({ state: "checking" })
    peekCall(joinId, joinKey).then((reply) => {
      if (!alive) return
      if (reply.call) setTarget({ state: "ready", call: reply.call })
      else setTarget({ state: reply.ended ? "ended" : "error", error: reply.error || "" })
    })
    return () => {
      alive = false
    }
  }, [joinId, joinKey])

  useEffect(() => {
    if (target.state !== "ready" || !answerNow || answered.current === joinId) return
    answered.current = joinId
    join(target.call.media)
    // join only reads the current target; running once per call is intended.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.state, answerNow, joinId])

  async function join(media) {
    if (target.state !== "ready") return
    if (await joinCall(target.call.id, media, joinKey)) router.replace("/calls")
  }
  const rows = (history || []).filter((row) => row.outcome !== "live" && (filter === "all" || (filter === "missed" && (row.missed || row.declined))))

  function titleFor(row) {
    if (row.channel) return row.channel.kind === "direct" ? channelTitle(row.channel, people, me) : row.channel.kind === "property" ? row.channel.name : `#${row.channel.name}`
    return row.title || "Call"
  }

  async function call(channelId, media) {
    await startCall(channelId, media)
  }

  return (
    <div className="calls-page">
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title">Calls</h1>
          <p className="calls-sub">Voice and video calls with anyone you chat with. Group calls hold up to 8 people.</p>
        </div>
        <button type="button" className="primary calls-new" disabled={Boolean(calls.current)} onClick={() => setPicking(true)}><Icon name="phone" size={14} />New call</button>
      </div>

      {joinId && (
        <section className="panel calls-join-banner">
          {target.state === "checking" || target.state === "idle" ? (
            <div><strong>{answerNow ? "Answering…" : "Checking the call…"}</strong><span>One moment.</span></div>
          ) : target.state === "ready" ? (
            calls.current?.callId === target.call.id ? (
              <><div><strong>You are in this call.</strong><span>{callTitle(target.call, me)}</span></div><button type="button" className="tool" onClick={() => { setMinimized(false); router.replace("/calls") }}>Open the call</button></>
            ) : (
              <>
                <div><strong>{callTitle(target.call, me)}</strong><span>{target.call.startedByName} started a {target.call.media === "video" ? "video" : "voice"} call · {(target.call.participants || []).length} in the call</span></div>
                <div className="calls-actions">
                  <button type="button" className="tool" onClick={() => router.replace("/calls")}>Not now</button>
                  <button type="button" className="primary" disabled={Boolean(calls.current)} onClick={() => join("audio")}><Icon name="phone" size={14} />Join</button>
                  <button type="button" className="primary" disabled={Boolean(calls.current)} onClick={() => join("video")}><Icon name="video" size={14} />Join with video</button>
                </div>
              </>
            )
          ) : (
            <><div><strong>{target.state === "ended" ? "That call has ended." : "You cannot join this call."}</strong><span>{target.state === "ended" ? "You can call back from the list below." : target.error}</span></div><button type="button" className="tool" onClick={() => router.replace("/calls")}>Close</button></>
          )}
        </section>
      )}

      {live.length > 0 && (
        <section className="calls-section">
          <h2>Happening now</h2>
          <ul className="calls-list">
            {live.map((item) => {
              const mine = calls.current?.callId === item.id
              return (
                <li key={item.id} className="calls-row is-live">
                  <span className="call-avatar is-small is-live">{initials(callTitle(item, me))}</span>
                  <div className="calls-copy">
                    <strong>{callTitle(item, me)}</strong>
                    <span>{item.media === "video" ? "Video" : "Voice"} call · {(item.participants || []).map((person) => person.name).join(", ") || "Starting"}</span>
                  </div>
                  <div className="calls-actions">
                    {mine ? (
                      <button type="button" className="call-pill is-in" onClick={() => setMinimized(false)}><span className="call-live-dot" aria-hidden="true" />In call</button>
                    ) : (
                      <>
                        <button type="button" className="call-pill is-join" disabled={Boolean(calls.current)} onClick={() => joinCall(item.id, "audio")}><Icon name="phone" size={14} />Join</button>
                        <button type="button" className="chat-members-button" disabled={Boolean(calls.current)} onClick={() => joinCall(item.id, "video")} aria-label="Join with video" title="Join with video"><Icon name="video" size={15} /></button>
                      </>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <section className="calls-section">
        <div className="calls-head">
          <h2>Recent</h2>
          <div className="property-switch" role="tablist" aria-label="Call filter">
            <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>All</button>
            <button type="button" role="tab" aria-selected={filter === "missed"} className={filter === "missed" ? "is-on" : ""} onClick={() => setFilter("missed")}>Missed</button>
          </div>
        </div>
        {error && <p className="banner">{error}</p>}
        {!history ? <PageSpinner /> : rows.length === 0 ? (
          <div className="doc-empty"><strong>{filter === "missed" ? "No missed calls." : "No calls yet."}</strong><span>Start one with New call, or from the phone button in any chat.</span></div>
        ) : (
          <ul className="calls-list">
            {rows.map((row) => {
              const title = titleFor(row)
              const missed = row.missed || row.declined
              const icon = row.direction === "outgoing" ? "arrowOut" : "arrowIn"
              const label = row.declined ? "Declined" : row.missed ? "Missed" : row.direction === "outgoing" ? (row.outcome === "completed" ? "Outgoing" : row.outcome === "declined" ? "Declined" : "No answer") : "Incoming"
              return (
                <li key={row.id} className={missed ? "calls-row is-missed" : "calls-row"}>
                  <span className="call-avatar is-small">{initials(title)}</span>
                  <div className="calls-copy">
                    <strong>{title}</strong>
                    <span>
                      <i className="calls-direction"><Icon name={icon} size={13} /></i>
                      {label} {row.media === "video" ? "video" : "voice"} call{row.seconds ? ` · ${formatClock(row.seconds * 1000)}` : ""} · {when(row.startedAt)}
                    </span>
                    {row.participants.length > 2 && <small>{row.participants.join(", ")}</small>}
                  </div>
                  <div className="calls-actions">
                    <button type="button" className="chat-members-button" disabled={!row.channel || Boolean(calls.current)} onClick={() => call(row.channelId, "audio")} aria-label={`Voice call ${title}`} title="Voice call"><Icon name="phone" size={15} /></button>
                    <button type="button" className="chat-members-button" disabled={!row.channel || Boolean(calls.current)} onClick={() => call(row.channelId, "video")} aria-label={`Video call ${title}`} title="Video call"><Icon name="video" size={15} /></button>
                    {row.channel && <button type="button" className="chat-members-button" onClick={() => router.push(`/chat?c=${row.channelId}`)} aria-label={`Open chat with ${title}`} title="Open chat"><Icon name="chat" size={15} /></button>}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <button type="button" className="calls-fab" disabled={Boolean(calls.current)} onClick={() => setPicking(true)} aria-label="New call"><Icon name="phone" size={22} /><span aria-hidden="true">+</span></button>

      {picking && <NewCall boot={boot} me={me} people={people} onClose={() => setPicking(false)} onStart={async (channelId, media) => { setPicking(false); await call(channelId, media) }} />}
    </div>
  )
}

function NewCall({ boot, me, people, onClose, onStart }) {
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState([])
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const needle = query.trim().toLowerCase()
  const everyone = (boot?.people || []).filter((person) => person.id !== me && (!needle || person.name.toLowerCase().includes(needle) || (person.email || "").toLowerCase().includes(needle)))
  const rooms = (boot?.channels || []).filter((channel) => channel.kind !== "direct" && (!needle || channelTitle(channel, people, me).toLowerCase().includes(needle)))

  async function callPeople(media) {
    if (!picked.length) {
      setError("Pick at least one person.")
      return
    }
    if (picked.length > 7) {
      setError("A group call holds up to 8 people, including you.")
      return
    }
    setPending(true)
    setError("")
    try {
      const data = await api("/chat/direct", { method: "POST", body: { userIds: picked } })
      await onStart(data.channel.id, media)
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet eyebrow="Calls" title="New call" hint="Pick one person, several people for a group call, or a room." onClose={onClose} error={error}>
      {!boot ? <PageSpinner /> : (
        <div className="calls-picker">
          <input type="search" className="calls-search" value={query} placeholder="Search people and rooms" onChange={(event) => setQuery(event.target.value)} autoFocus />
          <h3>People</h3>
          <ul className="calls-pick-list">
            {everyone.map((person) => {
              const on = picked.includes(person.id)
              return (
                <li key={person.id}>
                  <label className={on ? "calls-pick is-on" : "calls-pick"}>
                    <input type="checkbox" checked={on} onChange={() => setPicked((current) => (on ? current.filter((id) => id !== person.id) : [...current, person.id]))} />
                    <span className="call-avatar is-small">{initials(person.name)}</span>
                    <span className="calls-copy"><strong>{person.name}</strong><span>{person.online ? "Online" : "Offline"}</span></span>
                  </label>
                </li>
              )
            })}
            {!everyone.length && <li className="property-missing">No one matches.</li>}
          </ul>
          <div className="calls-pick-actions">
            <p className="calls-pick-summary">
              {picked.length
                ? `Calling ${picked.map((id) => people.get(id)?.name || "someone").join(", ")}${picked.length > 1 ? ` · group call of ${picked.length + 1}` : ""}`
                : "Pick one or more people above."}
            </p>
            <button type="button" className="calls-pick-button" disabled={pending || !picked.length} onClick={() => callPeople("audio")}><Icon name="phone" size={16} />Voice call</button>
            <button type="button" className="calls-pick-button" disabled={pending || !picked.length} onClick={() => callPeople("video")}><Icon name="video" size={16} />Video call</button>
          </div>
          {rooms.length > 0 && (
            <>
              <h3>Rooms</h3>
              <ul className="calls-pick-list">
                {rooms.map((channel) => (
                  <li key={channel.id} className="calls-room">
                    <span className="call-avatar is-small"><Icon name={channel.kind === "property" ? "building" : channel.private ? "lock" : "hash"} size={14} /></span>
                    <span className="calls-copy"><strong>{channel.kind === "property" ? channel.name : `#${channel.name}`}</strong><span>{channel.kind === "property" ? "Property room" : channel.private ? "Private channel" : "Channel"}</span></span>
                    <span className="calls-actions">
                      <button type="button" className="chat-members-button" onClick={() => onStart(channel.id, "audio")} aria-label={`Voice call in ${channel.name}`}><Icon name="phone" size={15} /></button>
                      <button type="button" className="chat-members-button" onClick={() => onStart(channel.id, "video")} aria-label={`Video call in ${channel.name}`}><Icon name="video" size={15} /></button>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </FormSheet>
  )
}
