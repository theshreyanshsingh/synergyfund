"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { initials } from "@synergifund/shared"
import { channelTitle } from "../../../components/chat/chatFormat"
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

const DAY = 86400000

function dayStart(value) {
  const date = new Date(value)
  date.setHours(0, 0, 0, 0)
  return date.getTime()
}

function clock(value) {
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

// "Today", "Yesterday", a weekday within the week, else the date.
function dayName(value) {
  const date = new Date(value)
  const days = Math.round((dayStart(Date.now()) - dayStart(date)) / DAY)
  if (days <= 0) return "Today"
  if (days === 1) return "Yesterday"
  if (days < 7) return date.toLocaleDateString("en-US", { weekday: "long" })
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: date.getFullYear() === new Date().getFullYear() ? undefined : "numeric" })
}

// The time on the right of a row: the hour today, else the day.
function shortWhen(value) {
  const name = dayName(value)
  return name === "Today" ? clock(value) : name
}

// "1 hr, 44 min", "5 min", "35 sec".
function duration(seconds) {
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours) return minutes ? `${hours} hr, ${minutes} min` : `${hours} hr`
  if (minutes) return `${minutes} min`
  return `${seconds} sec`
}

// What a call was for this person.
function kindOf(row) {
  if (row.declined) return "declined"
  if (row.missed) return "missed"
  if (row.direction === "outgoing") return row.outcome === "completed" ? "outgoing" : row.outcome === "declined" ? "refused" : "unanswered"
  return "incoming"
}
const SHORT = { declined: "Declined", missed: "Missed", outgoing: "Outgoing", refused: "Declined", unanswered: "No answer", incoming: "Incoming" }
const LONG = { declined: "Declined", missed: "Missed", outgoing: "Outgoing", refused: "Outgoing", unanswered: "Outgoing", incoming: "Incoming" }
const isMissed = (kind) => kind === "missed" || kind === "declined"
const arrow = (kind) => (kind === "outgoing" || kind === "refused" || kind === "unanswered" ? "arrowOut" : "arrowIn")

// Calls in a row from the same conversation, of the same kind, on the same day, are one line: "Missed (2)".
function groupCalls(rows) {
  const groups = []
  for (const row of rows) {
    const key = `${row.channelId}|${kindOf(row)}|${row.media}|${dayStart(row.startedAt)}`
    const last = groups.at(-1)
    if (last && last.key === key) last.calls.push(row)
    else groups.push({ key, id: row.id, calls: [row] })
  }
  return groups
}

function isGroupChannel(channel) {
  return Boolean(channel) && (channel.kind !== "direct" || (channel.memberIds || []).length > 2)
}

// A person shows their initials; a group or room shows what it is.
function Face({ channel, title, size = "" }) {
  const icon = channel?.kind === "property" ? "building" : channel && channel.kind !== "direct" ? (channel.private ? "lock" : "hash") : isGroupChannel(channel) ? "users" : ""
  const className = `calls-face${size ? ` is-${size}` : ""}${icon ? " is-group" : ""}`
  return <span className={className} aria-hidden="true">{icon ? <Icon name={icon} size={size === "big" ? 40 : size === "tiny" ? 16 : 22} /> : initials(title || "?")}</span>
}

let openedFromList = false

function CallsScreen() {
  const session = useSession()
  const router = useRouter()
  const params = useSearchParams()
  const calls = useCalls()
  const [history, setHistory] = useState(null)
  const [favorites, setFavorites] = useState([])
  const [boot, setBoot] = useState(null)
  const [error, setError] = useState("")
  const [picking, setPicking] = useState(false)
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState(false)
  const [filter, setFilter] = useState("all")
  const [query, setQuery] = useState("")
  const me = session?.user?.id || ""
  const joinId = params.get("join") || ""
  const joinKey = params.get("key") || ""
  const answerNow = params.get("answer") === "1"
  const infoId = params.get("info") || ""
  const [target, setTarget] = useState({ state: "idle" })
  const answered = useRef("")

  async function load() {
    try {
      const data = await api("/calls")
      setHistory(data.items || [])
      setFavorites(data.favorites || [])
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
  const channels = useMemo(() => new Map((boot?.channels || []).map((channel) => [channel.id, channel])), [boot])
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

  function nameOf(channel) {
    if (!channel) return "Call"
    return channel.kind === "direct" ? channelTitle(channel, people, me) : channel.kind === "property" ? channel.name : `#${channel.name}`
  }

  function titleFor(row) {
    return row.channel ? nameOf(row.channel) : row.title || "Call"
  }

  const needle = query.trim().toLowerCase()
  const matches = (text, extra = []) => !needle || [text, ...extra].some((value) => String(value || "").toLowerCase().includes(needle))
  const past = (history || []).filter((row) => row.outcome !== "live")
  const groups = groupCalls(past.filter((row) => filter === "all" || isMissed(kindOf(row)))).filter((group) => matches(titleFor(group.calls[0]), group.calls[0].participants))
  const favoriteChannels = favorites.map((id) => channels.get(id)).filter(Boolean)
  const shownFavorites = favoriteChannels.filter((channel) => matches(nameOf(channel)))
  const shownLive = live.filter((item) => matches(callTitle(item, me)))
  const busy = Boolean(calls.current)
  // Nothing to edit once no favourite is left (or none can be shown).
  const editingNow = editing && favoriteChannels.length > 0

  async function call(channelId, media) {
    await startCall(channelId, media)
  }

  function openChat(channel) {
    if (channel) router.push(`${channel.kind === "direct" ? "/messages" : "/chat"}?c=${channel.id}`)
  }

  async function messagePerson(userId) {
    try {
      const data = await api("/chat/direct", { method: "POST", body: { userIds: [userId] } })
      router.push(`/messages?c=${data.channel.id}`)
    } catch (err) {
      setError(err.message)
    }
  }

  function openInfo(group) {
    openedFromList = true
    router.push(`/calls?info=${group.id}`)
  }

  function closeInfo() {
    if (openedFromList) {
      openedFromList = false
      router.back()
    } else router.replace("/calls")
  }

  async function saveFavorites(next) {
    const before = favorites
    setFavorites(next)
    try {
      const data = await api("/calls/favorites", { method: "PUT", body: { channelIds: next } })
      setFavorites(data.favorites || [])
      setError("")
    } catch (err) {
      setFavorites(before)
      setError(err.message)
    }
  }

  function toggleFavorite(channelId) {
    const next = favorites.includes(channelId) ? favorites.filter((id) => id !== channelId) : [...favorites, channelId]
    if (!next.length) setEditing(false)
    saveFavorites(next)
  }

  // Keeps a conversation made just now (a direct chat for a new favourite) so it can be shown.
  function remember(channel) {
    setBoot((current) => (current ? { ...current, channels: [...(current.channels || []).filter((item) => item.id !== channel.id), channel] } : current))
  }

  if (infoId) {
    if (!history) return <PageSpinner />
    const all = groupCalls(past)
    const group = all.find((item) => item.calls.some((row) => row.id === infoId))
    if (!group) {
      return (
        <div className="calls-page call-info">
          <InfoTop onBack={closeInfo} />
          <div className="doc-empty"><strong>This call is not in your history.</strong><span>It may be older than your last 150 calls.</span></div>
        </div>
      )
    }
    const first = group.calls[0]
    const channel = first.channel ? channels.get(first.channel.id) || first.channel : null
    return (
      <CallInfo
        group={group}
        conversation={past.filter((row) => row.channelId === first.channelId)}
        channel={channel}
        title={titleFor(first)}
        people={people}
        me={me}
        busy={busy}
        error={error}
        favorite={Boolean(channel) && favorites.includes(channel.id)}
        onBack={closeInfo}
        onMessage={() => openChat(channel)}
        onCall={(media) => call(channel.id, media)}
        onFavorite={() => toggleFavorite(channel.id)}
        onMessagePerson={messagePerson}
      />
    )
  }

  return (
    <div className="calls-page">
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title">Calls</h1>
        </div>
        <button type="button" className="primary calls-new" disabled={busy} onClick={() => setPicking(true)}><Icon name="phone" size={14} />New call</button>
      </div>

      <label className="calls-find">
        <Icon name="search" size={18} />
        <input type="search" value={query} placeholder="Search names and rooms" aria-label="Search calls" onChange={(event) => setQuery(event.target.value)} />
      </label>

      {error && <p className="banner">{error}</p>}

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
                  <button type="button" className="primary" disabled={busy} onClick={() => join("audio")}><Icon name="phone" size={14} />Join</button>
                  <button type="button" className="primary" disabled={busy} onClick={() => join("video")}><Icon name="video" size={14} />Join with video</button>
                </div>
              </>
            )
          ) : (
            <><div><strong>{target.state === "ended" ? "That call has ended." : "You cannot join this call."}</strong><span>{target.state === "ended" ? "You can call back from the list below." : target.error}</span></div><button type="button" className="tool" onClick={() => router.replace("/calls")}>Close</button></>
          )}
        </section>
      )}

      {shownLive.length > 0 && (
        <section className="calls-section">
          <h2>Happening now</h2>
          <ul className="calls-list">
            {shownLive.map((item) => {
              const mine = calls.current?.callId === item.id
              const title = callTitle(item, me)
              return (
                <li key={item.id} className="calls-line">
                  <div className="calls-item is-static">
                    <span className="calls-face is-live" aria-hidden="true">{initials(title)}</span>
                    <span className="calls-copy">
                      <strong>{title}</strong>
                      <span className="calls-meta"><span className="call-live-dot" aria-hidden="true" />{item.media === "video" ? "Video" : "Voice"} call · {(item.participants || []).map((person) => person.name).join(", ") || "Starting"}</span>
                    </span>
                  </div>
                  <span className="calls-line-actions">
                    {mine ? (
                      <button type="button" className="call-pill is-in" onClick={() => setMinimized(false)}>In call</button>
                    ) : (
                      <>
                        <button type="button" className="call-pill is-join" disabled={busy} onClick={() => joinCall(item.id, "audio")}><Icon name="phone" size={14} />Join</button>
                        <button type="button" className="calls-icon-button" disabled={busy} onClick={() => joinCall(item.id, "video")} aria-label={`Join ${title} with video`} title="Join with video"><Icon name="video" size={18} /></button>
                      </>
                    )}
                  </span>
                </li>
              )
            })}
          </ul>
        </section>
      )}

      {(!needle || shownFavorites.length > 0) && <section className="calls-section">
        <div className="calls-head">
          <h2>Favourites</h2>
          {favoriteChannels.length > 0 && <button type="button" className="calls-text-button" onClick={() => setEditing(!editingNow)}>{editingNow ? "Done" : "Edit"}</button>}
        </div>
        <ul className="calls-list">
          {shownFavorites.map((channel) => {
            const title = nameOf(channel)
            return (
              <li key={channel.id} className="calls-line">
                <button type="button" className="calls-item" onClick={() => openChat(channel)} title={`Open the chat with ${title}`}>
                  <Face channel={channel} title={title} />
                  <span className="calls-copy"><strong>{title}</strong></span>
                </button>
                <span className="calls-line-actions">
                  {editingNow ? (
                    <button type="button" className="calls-icon-button is-remove" onClick={() => toggleFavorite(channel.id)} aria-label={`Remove ${title} from favourites`} title="Remove"><Icon name="close" size={18} /></button>
                  ) : (
                    <>
                      <button type="button" className="calls-icon-button" disabled={busy} onClick={() => call(channel.id, "audio")} aria-label={`Voice call ${title}`} title="Voice call"><Icon name="phone" size={19} /></button>
                      <button type="button" className="calls-icon-button" disabled={busy} onClick={() => call(channel.id, "video")} aria-label={`Video call ${title}`} title="Video call"><Icon name="video" size={20} /></button>
                    </>
                  )}
                </span>
              </li>
            )
          })}
          {!needle && (
            <li className="calls-line">
              <button type="button" className="calls-item" onClick={() => setAdding(true)}>
                <span className="calls-face is-add" aria-hidden="true"><Icon name="userPlus" size={22} /></span>
                <span className="calls-copy"><strong>Add favourite</strong></span>
              </button>
            </li>
          )}
        </ul>
      </section>}

      <section className="calls-section">
        <div className="calls-head">
          <h2>Recent</h2>
          <div className="calls-chips" role="tablist" aria-label="Call filter">
            <button type="button" role="tab" aria-selected={filter === "all"} className={filter === "all" ? "is-on" : ""} onClick={() => setFilter("all")}>All</button>
            <button type="button" role="tab" aria-selected={filter === "missed"} className={filter === "missed" ? "is-on" : ""} onClick={() => setFilter("missed")}>Missed</button>
          </div>
        </div>
        {!history ? <PageSpinner /> : groups.length === 0 ? (
          <div className="doc-empty"><strong>{needle ? "No calls match." : filter === "missed" ? "No missed calls." : "No calls yet."}</strong><span>{needle ? "Try another name." : "Start one with New call, or from the phone button in any chat."}</span></div>
        ) : (
          <ul className="calls-list">
            {groups.map((group) => {
              const first = group.calls[0]
              const title = titleFor(first)
              const kind = kindOf(first)
              const count = group.calls.length
              const notes = group.calls.some((row) => (row.notes || []).some((note) => note.status === "ready"))
              return (
                <li key={group.id} className="calls-line">
                  <button type="button" className="calls-item" onClick={() => openInfo(group)} aria-label={`${title}: ${SHORT[kind]}${count > 1 ? ` ${count} times` : ""}, ${first.media === "video" ? "video" : "voice"}, ${shortWhen(first.startedAt)}. Open call info.`}>
                    <Face channel={first.channel} title={title} />
                    <span className="calls-copy">
                      <strong>{title}</strong>
                      <span className={isMissed(kind) ? "calls-meta is-missed" : "calls-meta"}>
                        <Icon name={arrow(kind)} size={15} />
                        {SHORT[kind]}{count > 1 ? ` (${count})` : ""}
                        {first.media === "video" && <span className="calls-meta-media"><Icon name="video" size={14} /></span>}
                        {notes && <span className="calls-meta-notes"><Icon name="spark" size={12} />AI notes</span>}
                      </span>
                    </span>
                    <span className="calls-when">{shortWhen(first.startedAt)}</span>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </section>

      <button type="button" className="calls-fab" disabled={busy} onClick={() => setPicking(true)} aria-label="New call"><Icon name="phone" size={22} /><span aria-hidden="true">+</span></button>

      {picking && <NewCall boot={boot} me={me} people={people} onClose={() => setPicking(false)} onStart={async (channelId, media) => { setPicking(false); await call(channelId, media) }} />}
      {adding && (
        <AddFavorite
          boot={boot}
          me={me}
          people={people}
          favorites={favorites}
          onClose={() => setAdding(false)}
          onAdd={(channel) => {
            remember(channel)
            setAdding(false)
            if (!favorites.includes(channel.id)) saveFavorites([...favorites, channel.id])
          }}
        />
      )}
    </div>
  )
}

function InfoTop({ onBack }) {
  return (
    <div className="workspace-top call-info-top">
      <button type="button" className="call-info-back" onClick={onBack} aria-label="Back to calls" title="Back"><Icon name="back" size={20} /></button>
      <div className="page-heading"><h1 className="page-title">Call info</h1></div>
      <span className="call-info-spacer" aria-hidden="true" />
    </div>
  )
}

// One conversation's calls, like a phone's call details: who, what happened, and who joined.
function CallInfo({ group, conversation, channel, title, people, me, busy, error, favorite, onBack, onMessage, onCall, onFavorite, onMessagePerson }) {
  const [all, setAll] = useState(false)
  const first = group.calls[0]
  const shown = all ? conversation : group.calls
  const sections = []
  for (const row of shown) {
    const day = dayName(row.startedAt)
    if (sections.at(-1)?.day === day) sections.at(-1).calls.push(row)
    else sections.push({ day, calls: [row] })
  }
  const more = conversation.length > group.calls.length

  let subtitle = "Call"
  if (channel?.kind === "direct" && !isGroupChannel(channel)) {
    const other = (channel.memberIds || []).find((id) => id !== me)
    const person = people.get(other)
    subtitle = person ? `${person.email || ""}${person.online ? " · Online" : ""}`.replace(/^ · /, "") : "Direct message"
  } else if (channel?.kind === "direct") subtitle = `Group · ${(channel.memberIds || []).length} people`
  else if (channel?.kind === "property") subtitle = "Property room"
  else if (channel) subtitle = channel.memberList || channel.private ? `Channel · ${(channel.memberIds || []).length} members` : "Channel"

  // Who joined the latest of these calls (whoever started it first), and who was rung but did not.
  const showPeople = isGroupChannel(channel) || (!channel && first.joinedPeople?.length > 2)
  const joinedIds = new Set((first.joinedPeople || []).map((person) => person.id))
  const joined = [...(first.joinedPeople || [])].sort((a, b) => (a.id === first.startedBy ? -1 : b.id === first.startedBy ? 1 : 0))
  if (!joinedIds.has(first.startedBy) && first.startedByName) joined.unshift({ id: first.startedBy, name: first.startedByName })
  const absent = (first.invitedIds || []).filter((id) => !joinedIds.has(id) && id !== first.startedBy).map((id) => ({ id, name: people.get(id)?.name || "" })).filter((person) => person.name)
  const declined = new Set(first.declinedIds || [])

  function personRow(person, note) {
    const mine = person.id === me
    const inner = (
      <>
        <span className="calls-face is-small" aria-hidden="true">{initials(person.name)}</span>
        <span className="calls-copy"><strong>{mine ? "You" : person.name}</strong>{note && <span className="calls-meta">{note}</span>}</span>
      </>
    )
    return (
      <li key={person.id} className="call-info-person">
        {mine ? <div className="call-info-person-row">{inner}</div> : (
          <button type="button" className="call-info-person-row" onClick={() => onMessagePerson(person.id)} title={`Message ${person.name}`}>
            {inner}
            <span className="call-info-chevron" aria-hidden="true"><Icon name="back" size={16} /></span>
          </button>
        )}
      </li>
    )
  }

  return (
    <div className="calls-page call-info">
      <InfoTop onBack={onBack} />
      {error && <p className="banner">{error}</p>}
      <div className="call-info-hero">
        <Face channel={channel} title={title} size="big" />
        <h2>{title}</h2>
        <p>{subtitle}</p>
      </div>
      <div className="call-info-tiles">
        <button type="button" disabled={!channel} onClick={onMessage}><Icon name="chat" size={22} />Message</button>
        <button type="button" disabled={!channel || busy} onClick={() => onCall("audio")}><Icon name="phone" size={22} />Voice</button>
        <button type="button" disabled={!channel || busy} onClick={() => onCall("video")}><Icon name="video" size={22} />Video</button>
        <button type="button" disabled={!channel} onClick={onFavorite} aria-pressed={favorite} className={favorite ? "is-on" : ""}><Icon name={favorite ? "star" : "starLine"} size={22} />Favourite</button>
      </div>

      {sections.map((section, index) => (
        <section key={section.day} className="call-info-section">
          <div className="call-info-head">
            <h3>{section.day}</h3>
            {index === 0 && more && <button type="button" className="calls-text-button is-pill" onClick={() => setAll((current) => !current)}>{all ? "Less" : "More"}</button>}
          </div>
          <ul className="call-info-card">
            {section.calls.map((row) => {
              const kind = kindOf(row)
              const right = row.seconds ? duration(row.seconds) : kind === "unanswered" ? "No answer" : kind === "refused" ? "Declined" : ""
              return (
                <li key={row.id} className="call-info-call">
                  <span className={isMissed(kind) ? "call-info-kind is-missed" : "call-info-kind"} aria-hidden="true"><Icon name={arrow(kind)} size={18} /></span>
                  <span className="calls-copy">
                    <strong className={isMissed(kind) ? "is-missed" : ""}>{LONG[kind]} {row.media === "video" ? "video" : "voice"} call</strong>
                    <span className="calls-meta">{clock(row.startedAt)}{row.direction === "incoming" && row.startedByName && isGroupChannel(channel) ? ` · from ${row.startedByName}` : ""}</span>
                    {(row.notes || []).length > 0 && (
                      <span className="calls-notes">
                        {row.notes.map((note, number) => (
                          <Link key={note.id} href={`/calls/notes/${note.id}`} className={`calls-notes-link is-${note.status}`}>
                            <Icon name="spark" size={12} />
                            {note.status === "ready" ? note.title || "AI notes" : note.status === "failed" ? "AI notes · not written" : note.status === "empty" ? "AI notes · nothing heard" : "AI notes · being written"}
                            {row.notes.length > 1 ? ` (${number + 1})` : ""}
                          </Link>
                        ))}
                      </span>
                    )}
                  </span>
                  {right && <span className="call-info-length">{right}</span>}
                </li>
              )
            })}
          </ul>
        </section>
      ))}

      {showPeople && joined.length > 0 && (
        <section className="call-info-section">
          <div className="call-info-head"><h3>Joined</h3><span>{joined.length} {joined.length === 1 ? "person" : "people"}</span></div>
          <ul className="call-info-card">{joined.map((person) => personRow(person, person.id === first.startedBy ? "Started the call" : ""))}</ul>
        </section>
      )}
      {showPeople && absent.length > 0 && (
        <section className="call-info-section">
          <div className="call-info-head"><h3>Didn&apos;t join</h3><span>{absent.length} {absent.length === 1 ? "person" : "people"}</span></div>
          <ul className="call-info-card">{absent.map((person) => personRow(person, declined.has(person.id) ? "Declined" : ""))}</ul>
        </section>
      )}
    </div>
  )
}

// Pick a person or a room to keep under Favourites.
function AddFavorite({ boot, me, people, favorites, onClose, onAdd }) {
  const [query, setQuery] = useState("")
  const [error, setError] = useState("")
  const [pending, setPending] = useState("")
  const needle = query.trim().toLowerCase()
  const favoriteSet = new Set(favorites)
  // People whose one-to-one chat is already a favourite are left out.
  const taken = new Set((boot?.channels || []).filter((channel) => favoriteSet.has(channel.id) && channel.kind === "direct" && (channel.memberIds || []).length === 2).flatMap((channel) => channel.memberIds))
  const everyone = (boot?.people || []).filter((person) => person.id !== me && !person.bot && !taken.has(person.id) && (!needle || person.name.toLowerCase().includes(needle) || (person.email || "").toLowerCase().includes(needle)))
  const rooms = (boot?.channels || []).filter((channel) => !favoriteSet.has(channel.id) && (channel.kind !== "direct" || (channel.memberIds || []).length > 2) && (!needle || channelTitle(channel, people, me).toLowerCase().includes(needle)))

  async function pickPerson(person) {
    setPending(person.id)
    setError("")
    try {
      const data = await api("/chat/direct", { method: "POST", body: { userIds: [person.id] } })
      onAdd(data.channel)
    } catch (err) {
      setError(err.message)
      setPending("")
    }
  }

  return (
    <FormSheet eyebrow="Calls" title="Add favourite" hint="Favourites stay at the top of Calls, one tap from a call." onClose={onClose} error={error}>
      {!boot ? <PageSpinner /> : (
        <div className="calls-picker">
          <input type="search" className="calls-search" value={query} placeholder="Search people and rooms" onChange={(event) => setQuery(event.target.value)} autoFocus />
          <h3>People</h3>
          <ul className="calls-pick-list">
            {everyone.map((person) => (
              <li key={person.id}>
                <button type="button" className="calls-pick-row" disabled={Boolean(pending)} onClick={() => pickPerson(person)}>
                  <span className="calls-face is-small" aria-hidden="true">{initials(person.name)}</span>
                  <span className="calls-copy"><strong>{person.name}</strong><span className="calls-meta">{person.email}</span></span>
                  <Icon name="plus" size={16} />
                </button>
              </li>
            ))}
            {!everyone.length && <li className="property-missing">No one to add.</li>}
          </ul>
          {rooms.length > 0 && (
            <>
              <h3>Groups and rooms</h3>
              <ul className="calls-pick-list">
                {rooms.map((channel) => {
                  const title = channel.kind === "direct" ? channelTitle(channel, people, me) : channel.kind === "property" ? channel.name : `#${channel.name}`
                  return (
                    <li key={channel.id}>
                      <button type="button" className="calls-pick-row" disabled={Boolean(pending)} onClick={() => onAdd(channel)}>
                        <Face channel={channel} title={title} size="small" />
                        <span className="calls-copy"><strong>{title}</strong><span className="calls-meta">{channel.kind === "property" ? "Property room" : channel.kind === "direct" ? "Group" : channel.private ? "Private channel" : "Channel"}</span></span>
                        <Icon name="plus" size={16} />
                      </button>
                    </li>
                  )
                })}
              </ul>
            </>
          )}
        </div>
      )}
    </FormSheet>
  )
}

function NewCall({ boot, me, people, onClose, onStart }) {
  const [query, setQuery] = useState("")
  const [picked, setPicked] = useState([])
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const needle = query.trim().toLowerCase()
  const everyone = (boot?.people || []).filter((person) => person.id !== me && !person.bot && (!needle || person.name.toLowerCase().includes(needle) || (person.email || "").toLowerCase().includes(needle)))
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
    <FormSheet eyebrow="Calls" title="New call" hint="Pick one person, several people for a group call (up to 8 with you), or a room." onClose={onClose} error={error}>
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
                    <span className="calls-face is-small">{initials(person.name)}</span>
                    <span className="calls-copy"><strong>{person.name}</strong><span className="calls-meta">{person.online ? "Online" : "Offline"}</span></span>
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
                    <Face channel={channel} title={channel.name} size="small" />
                    <span className="calls-copy"><strong>{channel.kind === "property" ? channel.name : `#${channel.name}`}</strong><span className="calls-meta">{channel.kind === "property" ? "Property room" : channel.private ? "Private channel" : "Channel"}</span></span>
                    <span className="calls-line-actions">
                      <button type="button" className="calls-icon-button" onClick={() => onStart(channel.id, "audio")} aria-label={`Voice call in ${channel.name}`}><Icon name="phone" size={18} /></button>
                      <button type="button" className="calls-icon-button" onClick={() => onStart(channel.id, "video")} aria-label={`Video call in ${channel.name}`}><Icon name="video" size={18} /></button>
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
