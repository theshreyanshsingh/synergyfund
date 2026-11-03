"use client"

import { useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter } from "next/navigation"
import { PERMISSIONS, can, initials } from "@synergifund/shared"
import { channelTitle } from "../../../components/chat/chatFormat"
import { Attention } from "../../../components/overview/Attention"
import { useSession } from "../../../components/shell/Providers"
import { CustomizeSheet } from "../../../components/ui/CustomizeSheet"
import { Icon } from "../../../components/ui/Icon"
import { PageSpinner } from "../../../components/ui/Spinner"
import { api } from "../../../lib/api"
import { useChatEvents } from "../../../lib/chatSocket"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

// Home: each person's own start page, top to bottom. Customize hides sections for this person only.
const SECTIONS = [
  { id: "greeting", name: "Greeting", hint: "Good morning, today's date and your day in one line" },
  { id: "attention", name: "Needs attention", hint: "Overdue tasks, payments and draws, matured loans, expired insurance" },
  { id: "today", name: "Today", hint: "Today's calendar, then what is coming up in the next 7 days" },
  { id: "tasks", name: "My tasks", hint: "Tasks assigned to you: overdue, today and this week" },
  { id: "catchup", name: "Catch up", hint: "Unread direct messages, mentions and missed calls" },
]
const COMING_UP = 8
const MISSED_DAYS = 7

export default function HomePage() {
  const router = useRouter()
  const session = useSession()
  const user = session?.user
  const home = useApi("/home")
  const [hidden, setHidden] = useState([])
  const [customizing, setCustomizing] = useState(false)

  useEffect(() => {
    if (Array.isArray(home.data?.hidden)) setHidden(home.data.hidden)
  }, [home.data])

  const seesProperties = Boolean(user && can(user, PERMISSIONS.propertiesRead))
  const seesCalendar = Boolean(user && can(user, PERMISSIONS.expensesRead))
  const chats = Boolean(user && can(user, PERMISSIONS.chatUse))
  const available = SECTIONS.filter((section) => {
    if (section.id === "attention" || section.id === "tasks") return seesProperties
    if (section.id === "today") return seesCalendar
    if (section.id === "catchup") return chats
    return true
  })
  const shows = (id) => available.some((section) => section.id === id) && !hidden.includes(id)

  // The calendar feeds Today and the payments in the greeting; chat and calls feed Catch up.
  const calendar = useApi(seesCalendar && (shows("today") || shows("greeting")) ? "/calendar" : null)
  const bootstrap = useApi(chats && shows("catchup") ? "/chat/bootstrap" : null)
  const calls = useApi(chats && shows("catchup") ? "/calls" : null)
  const refreshTimer = useRef(null)
  const refreshChat = () => {
    clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => bootstrap.reload(), 1200)
  }
  useEffect(() => () => clearTimeout(refreshTimer.current), [])
  useChatEvents({ "message:new": refreshChat, read: refreshChat, "channel:remove": refreshChat, "chat:refresh": refreshChat, reconnect: refreshChat }, chats && shows("catchup"))

  // Ticked and added here: shown until the next visit, so a tick can be undone.
  const [tasks, setTasks] = useState([])
  useEffect(() => {
    if (Array.isArray(home.data?.tasks)) setTasks(home.data.tasks)
  }, [home.data])

  if (!user) return null
  if (!home.data) return home.error ? <div className="workspace"><p className="banner">{home.error}</p></div> : <PageSpinner />

  const today = home.data.today
  const week = shiftDay(today, 7)
  const events = (calendar.data?.events || []).filter((event) => event.kind !== "task" && event.kind !== "expense")
  const payments = (calendar.data?.events || []).filter((event) => event.date >= today && event.date <= week && ((event.kind === "bill" && event.status !== "Paid") || String(event.id).startsWith("loan-payment-")))
  const dueToday = tasks.filter((task) => !task.done && task.due === today).length
  const summary = [
    seesProperties ? (dueToday ? `${dueToday} ${dueToday === 1 ? "task" : "tasks"} due today` : "no tasks due today") : "",
    seesCalendar && calendar.data ? (payments.length ? `${payments.length} ${payments.length === 1 ? "payment" : "payments"} this week` : "no payments this week") : "",
  ].filter(Boolean).join(", ")
  const attention = home.data.attention || []
  const nothingShown = available.every((section) => hidden.includes(section.id))
  const hello = `${greetingFor(new Date().getHours())}, ${firstName(user.name)}`

  return (
    <div className={shows("greeting") ? "workspace home-page has-hero" : "workspace home-page"}>
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title">{shows("greeting") ? hello : "Home"}</h1>
        </div>
        <button type="button" className="import-button home-customize" onClick={() => setCustomizing(true)} aria-label="Customize Home" title="Customize Home">
          <Icon name="sliders" size={15} />
        </button>
      </div>

      {shows("greeting") && (
        <div className="home-greeting">
          <p>Your day at a glance · {longDay(today)}</p>
          {summary && <strong>{capitalize(summary)}.</strong>}
        </div>
      )}
      {/* Phones: the date, then the greeting in two big lines. */}
      {shows("greeting") && (
        <div className="home-hero">
          <p className="home-hero-date">{longDay(today)}</p>
          <h2 className="home-hero-hello">{hello}.<br />Here's your day at a glance.</h2>
          {summary && <p className="home-hero-summary">{capitalize(summary)}.</p>}
        </div>
      )}

      {nothingShown && (
        <section className="overview-attention overview-empty">
          <h2>Your Home is empty</h2>
          <p>Everything is hidden. Choose what to show here; only your Home changes.</p>
          <button type="button" className="primary" onClick={() => setCustomizing(true)}>Customize</button>
        </section>
      )}

      {/* Shown when something is overdue; on phones it is a card either way, empty when nothing is. */}
      {shows("attention") && attention.length > 0 && (
        <Attention items={attention} days={7} subtitle="Deal with these first" onOpen={(href) => router.push(href)} />
      )}
      {shows("attention") && attention.length === 0 && (
        <div className="home-attention-none">
          <Card title="Needs attention">
            <Blank art="check" text="Nothing needs attention right now." action={<Link href="/overview" className="tool">Open Insights</Link>} />
          </Card>
        </div>
      )}

      <div className="home-grid">
        {shows("today") && <TodayCard today={today} events={events} loading={calendar.loading && !calendar.data} error={calendar.error} />}
        {shows("tasks") && <TasksCard user={user} today={today} tasks={tasks} setTasks={setTasks} />}
        {shows("catchup") && <CatchUpCard bootstrap={bootstrap} calls={calls} />}
      </div>

      {customizing && (
        <CustomizeSheet
          eyebrow="Home"
          title="Customize Home"
          hint="Choose what your Home shows. Only yours changes."
          path="/home/hidden"
          sections={available}
          hidden={hidden}
          onClose={() => setCustomizing(false)}
          onSaved={(next) => { setHidden(next); setCustomizing(false) }}
        />
      )}
    </div>
  )
}

// An empty card: a small picture, one line, and the next thing to do.
function Blank({ art, text, action = null }) {
  return (
    <div className="home-blank">
      <BlankArt kind={art} />
      <p>{text}</p>
      {action}
    </div>
  )
}

function BlankArt({ kind }) {
  return (
    <svg className="home-blank-art" width="88" height="64" viewBox="0 0 88 64" fill="none" aria-hidden="true">
      <ellipse cx="44" cy="34" rx="38" ry="26" className="home-blank-glow" />
      {kind === "check" && <><circle cx="44" cy="32" r="16" className="home-blank-paper" /><path d="M36.5 32.5l5 5 10-11" className="home-blank-ink" /></>}
      {kind === "calendar" && <><rect x="28" y="16" width="32" height="30" rx="5" className="home-blank-paper" /><path d="M28 25h32M36 12v8M52 12v8" className="home-blank-line" /><rect x="34" y="31" width="7" height="6" rx="1.5" className="home-blank-fill" /></>}
      {kind === "tasks" && <><rect x="29" y="12" width="30" height="38" rx="5" className="home-blank-paper" /><path d="M35 23l2.5 2.5L42 21M35 33l2.5 2.5L42 31" className="home-blank-ink" /><path d="M46 23h7M46 33h7M35 42h18" className="home-blank-line" /></>}
      {kind === "chat" && <><path d="M22 18h30a4 4 0 0 1 4 4v14a4 4 0 0 1-4 4H34l-8 6v-6h-4a4 4 0 0 1-4-4V22a4 4 0 0 1 4-4z" className="home-blank-paper" /><path d="M27 26h20M27 32h12" className="home-blank-line" /><path d="M60 28h6a4 4 0 0 1 4 4v10a4 4 0 0 1-4 4h-2v5l-6-5h-6a4 4 0 0 1-4-4v-2" className="home-blank-paper is-back" /></>}
    </svg>
  )
}

function Card({ title, link, children }) {
  return (
    <section className="home-card">
      <header className="home-card-head">
        <h2>{title}</h2>
        {link}
      </header>
      {children}
    </section>
  )
}

// Today's calendar (bills, loan payments and maturities, insurance, draws, meetings), then the next 7 days. Tasks are
// under My tasks, and posted costs stay on the Calendar.
function TodayCard({ today, events, loading, error }) {
  const now = events.filter((event) => event.date === today).sort((a, b) => (a.start || "99").localeCompare(b.start || "99"))
  const next = events.filter((event) => event.date > today && event.date <= shiftDay(today, 7))
  const more = next.length - COMING_UP
  return (
    <Card title="Today" link={<Link href={`/calendar?date=${today}`} className="home-card-link">Calendar</Link>}>
      {error ? <p className="home-empty">{error}</p> : loading ? <p className="home-empty">Loading the calendar…</p> : !now.length && !next.length ? (
        <Blank art="calendar" text="Nothing on your calendar today or in the next 7 days." action={<Link href={`/calendar?date=${today}`} className="tool">Open calendar</Link>} />
      ) : (
        <>
          {now.length ? <ul className="home-list">{now.map((event) => <EventRow key={event.id} event={event} />)}</ul> : <p className="home-empty">Nothing on the calendar today.</p>}
          <h3 className="home-sub">Coming up</h3>
          {next.length ? (
            <ul className="home-list">{next.slice(0, COMING_UP).map((event) => <EventRow key={event.id} event={event} day />)}</ul>
          ) : <p className="home-empty">Nothing in the next 7 days.</p>}
          {more > 0 && <Link href="/calendar" className="home-more">{more} more in the next 7 days on the Calendar</Link>}
        </>
      )}
    </Card>
  )
}

function EventRow({ event, day = false }) {
  const when = event.kind === "event" ? event.detail : ""
  const line = [day ? shortDay(event.date) : "", when, event.property, event.kind === "event" ? "" : event.detail].filter(Boolean).join(" · ")
  return (
    <li>
      <Link href={event.href || `/calendar?date=${event.date}`} className={`home-row is-${event.tone || "neutral"}`}>
        <span className="home-row-icon"><Icon name={eventIcon(event.kind)} size={16} /></span>
        <span className="home-row-copy">
          <strong>{event.title}</strong>
          {line && <small>{line}</small>}
        </span>
        {event.amount != null && <b>{money(event.amount)}</b>}
      </Link>
    </li>
  )
}

// Tasks assigned to me: overdue, today, the next 7 days. Tick to complete (tick again to reopen); add one for today.
function TasksCard({ user, today, tasks, setTasks }) {
  const [draft, setDraft] = useState("")
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState("")
  const field = useRef(null)
  const canTick = can(user, PERMISSIONS.tasksEdit) || can(user, PERMISSIONS.tasksManage)
  const canAdd = can(user, PERMISSIONS.tasksManage)
  const week = shiftDay(today, 7)
  const groups = [
    { id: "overdue", name: "Overdue", items: tasks.filter((task) => task.due && task.due < today), empty: "" },
    { id: "today", name: "Today", items: tasks.filter((task) => task.due === today), empty: "No tasks due today." },
    { id: "week", name: "This week", items: tasks.filter((task) => task.due > today && task.due <= week), empty: "" },
  ]

  async function tick(task) {
    const done = !task.done
    setError("")
    setTasks((list) => list.map((item) => (item.id === task.id ? { ...item, done } : item)))
    try {
      await api(`/tasks/${task.id}`, { method: "PATCH", body: { done } })
    } catch (err) {
      setTasks((list) => list.map((item) => (item.id === task.id ? { ...item, done: !done } : item)))
      setError(err.message)
    }
  }

  async function add(event) {
    event.preventDefault()
    const title = draft.trim()
    if (!title || adding) return
    setAdding(true)
    setError("")
    try {
      const result = await api("/tasks", { method: "POST", body: { title, assigneeId: user.id, due: today, quiet: true } })
      setTasks((list) => [...list, { ...result.task, property: "" }])
      setDraft("")
    } catch (err) {
      setError(err.message)
    } finally {
      setAdding(false)
    }
  }

  return (
    <Card title="My tasks" link={<Link href="/tasks" className="home-card-link">All tasks</Link>}>
      {!groups.some((group) => group.items.length) ? (
        <Blank
          art="tasks"
          text="You have no tasks due this week."
          action={canAdd ? <button type="button" className="tool" onClick={() => field.current?.focus()}>Create task</button> : <Link href="/tasks" className="tool">Open tasks</Link>}
        />
      ) : groups.map((group) => (group.items.length || group.empty) && (
        <div key={group.id} className={`home-task-group is-${group.id}`}>
          <h3 className="home-sub">{group.name}{group.items.length ? <em>{group.items.length}</em> : null}</h3>
          {group.items.length ? (
            <ul className="home-list">
              {group.items.map((task) => (
                <li key={task.id} className={task.done ? "home-task is-done" : "home-task"}>
                  <label className="home-check" title={canTick ? (task.done ? "Mark as not done" : "Mark as done") : "You can't edit tasks"}>
                    <input type="checkbox" checked={task.done} disabled={!canTick} onChange={() => tick(task)} aria-label={`${task.done ? "Reopen" : "Complete"} “${task.title}”`} />
                  </label>
                  <Link href={`/tasks?task=${task.id}`} className="home-task-copy">
                    <strong>{task.title}</strong>
                    <small>{[task.property, group.id === "today" ? "" : `Due ${shortDay(task.due)}`, task.priority === "High" ? "High priority" : "", (task.labels || []).includes("Verify") ? "Verify" : ""].filter(Boolean).join(" · ") || "No property"}</small>
                  </Link>
                </li>
              ))}
            </ul>
          ) : <p className="home-empty">{group.empty}</p>}
        </div>
      ))}
      {error && <p className="banner">{error}</p>}
      {canAdd && (
        <form className="home-add" onSubmit={add}>
          <input ref={field} value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="Add a task for today" aria-label="Add a task" maxLength={200} />
          <button type="submit" className="tool" disabled={!draft.trim() || adding}>{adding ? "Adding…" : "Add"}</button>
        </form>
      )}
    </Card>
  )
}

// Unread direct messages, channels that mention me, and calls I missed in the last week that nobody has talked on since.
function CatchUpCard({ bootstrap, calls }) {
  const me = bootstrap.data?.me || ""
  // Names by id, as the chat helpers read them.
  const people = new Map((bootstrap.data?.people || []).map((person) => [person.id, person]))
  const channels = bootstrap.data?.channels || []
  const directs = channels.filter((channel) => channel.kind === "direct" && channel.unread > 0).sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0))
  const mentions = channels.filter((channel) => channel.kind !== "direct" && channel.mentions > 0).sort((a, b) => new Date(b.lastMessageAt || 0) - new Date(a.lastMessageAt || 0))
  const history = calls.data?.items || []
  const since = Date.now() - MISSED_DAYS * 86400000
  const missed = history.filter((call) => call.missed && new Date(call.startedAt).getTime() >= since && !history.some((later) => later.channelId === call.channelId && new Date(later.startedAt) > new Date(call.startedAt) && (later.joined || later.direction === "outgoing")))
  const loading = (!bootstrap.data && !bootstrap.error) || (!calls.data && !calls.error)
  const nothing = !directs.length && !mentions.length && !missed.length
  const name = (channel) => (channel.kind === "direct" ? channelTitle(channel, people, me) : channel.kind === "property" ? channel.name : `#${channel.name}`)
  return (
    <Card title="Catch up" link={<Link href="/messages" className="home-card-link">Messages</Link>}>
      {bootstrap.error && <p className="home-empty">{bootstrap.error}</p>}
      {loading && !bootstrap.error ? <p className="home-empty">Loading messages and calls…</p> : nothing && !bootstrap.error ? (
        <Blank art="chat" text="You're all caught up: no unread messages, mentions or missed calls." action={<Link href="/messages" className="tool">Open messages</Link>} />
      ) : (
        <ul className="home-list">
          {directs.map((channel) => (
            <li key={channel.id}>
              <Link href={`/messages?c=${channel.id}`} className="home-row">
                <span className="avatar">{initials(name(channel))}</span>
                <span className="home-row-copy"><strong>{name(channel)}</strong><small>Direct message</small></span>
                <em className="home-count">{channel.unread} unread</em>
              </Link>
            </li>
          ))}
          {mentions.map((channel) => (
            <li key={channel.id}>
              <Link href={`/chat?c=${channel.id}`} className="home-row">
                <span className="home-row-icon"><Icon name="at" size={16} /></span>
                <span className="home-row-copy"><strong>{name(channel)}</strong><small>You were mentioned</small></span>
                <em className="home-count">{channel.mentions} {channel.mentions === 1 ? "mention" : "mentions"}</em>
              </Link>
            </li>
          ))}
          {missed.map((call) => (
            <li key={call.id}>
              <Link href="/calls" className="home-row is-bad">
                <span className="home-row-icon"><Icon name={call.media === "video" ? "video" : "phone"} size={16} /></span>
                <span className="home-row-copy"><strong>{call.channel ? name(call.channel) : call.title || "Call"}</strong><small>Missed {call.media === "video" ? "video call" : "call"} · {callWhen(call.startedAt)}</small></span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  )
}

function eventIcon(kind) {
  if (kind === "bill") return "card"
  if (kind === "loan") return "bank"
  if (kind === "property") return "file"
  if (kind === "draw") return "layers"
  return "calendar"
}

function greetingFor(hour) {
  if (hour >= 5 && hour < 12) return "Good morning"
  if (hour >= 12 && hour < 17) return "Good afternoon"
  return "Good evening"
}

function firstName(name) {
  return String(name || "").trim().split(/\s+/)[0] || "there"
}

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

function parseDay(key) {
  const [year, month, day] = String(key).split("-").map(Number)
  return new Date(year, month - 1, day, 12)
}

function shiftDay(key, days) {
  const date = parseDay(key)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

// "Tuesday, November 3, 2026"
function longDay(key) {
  return parseDay(key).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })
}

// "Wed, Nov 4"
function shortDay(key) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(key || "")) return key || ""
  return parseDay(key).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" })
}

// "Today 3:14 PM", "Mon 9:02 AM"
function callWhen(value) {
  const date = new Date(value)
  const time = date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  return new Date().toDateString() === date.toDateString() ? `Today ${time}` : `${date.toLocaleDateString("en-US", { weekday: "short" })} ${time}`
}
