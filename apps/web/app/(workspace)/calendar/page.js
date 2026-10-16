"use client"

import { Suspense, useEffect, useMemo, useRef, useState } from "react"
import Link from "next/link"
import { useSearchParams } from "next/navigation"
import { PERMISSIONS, can } from "@synergifund/shared"
import { useSession } from "../../../components/shell/Providers"
import { MultiSelect } from "../../../components/ui/MultiSelect"
import { Icon } from "../../../components/ui/Icon"
import { PageSpinner } from "../../../components/ui/Spinner"
import { api } from "../../../lib/api"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const KINDS = [
  { id: "event", label: "Events" },
  { id: "bill", label: "Bills" },
  { id: "loan", label: "Loans" },
  { id: "draw", label: "Draws" },
  { id: "task", label: "Tasks" },
  { id: "expense", label: "Posted costs" },
]
const VIEWS = [{ id: "month", label: "Month" }, { id: "week", label: "Week" }, { id: "day", label: "Day" }]
const VIEW_KEY = "synergifund-calendar-view"
const HOUR = 48
const OPEN_LABELS = { bill: "Open in Payments", loan: "Open the loan", draw: "Open the draws", task: "Open the task", expense: "Open in Expenses" }

export default function CalendarPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <CalendarScreen />
    </Suspense>
  )
}

function CalendarScreen() {
  const session = useSession()
  const params = useSearchParams()
  const [taskScope, setTaskScope] = useState("mine")
  const data = useApi(taskScope === "all" ? "/calendar?tasks=all" : "/calendar")
  const [view, setView] = useState("month")
  const [cursor, setCursor] = useState(() => new Date())
  const [dayOpen, setDayOpen] = useState("")
  const [detail, setDetail] = useState(null)
  const [editor, setEditor] = useState(null)
  const [creating, setCreating] = useState(false)
  const createBox = useRef(null)
  const [kinds, setKinds] = useState({ event: true, bill: true, loan: true, draw: true, task: true, expense: true })
  const canSeeAllTasks = Boolean(data.data?.canSeeAllTasks)
  const canTask = Boolean(session?.user && can(session.user, PERMISSIONS.tasksManage))
  const events = (data.data?.events || []).filter((event) => kinds[event.kind])
  const today = iso(new Date())
  const urgent = events.filter((event) => event.urgent)

  // Remember the view; a link to a date (from an invitation) opens that day.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(VIEW_KEY)
      if (VIEWS.some((item) => item.id === saved)) setView(saved)
    } catch {}
  }, [])
  useEffect(() => {
    const date = params.get("date")
    if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
      setCursor(parse(date))
      setDayOpen(date)
    }
  }, [params])

  useEffect(() => {
    if (!creating) return undefined
    function away(event) {
      if (!createBox.current?.contains(event.target)) setCreating(false)
    }
    function onKey(event) {
      if (event.key === "Escape") setCreating(false)
    }
    document.addEventListener("mousedown", away)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", away)
      document.removeEventListener("keydown", onKey)
    }
  }, [creating])

  function chooseView(next) {
    setView(next)
    try {
      localStorage.setItem(VIEW_KEY, next)
    } catch {}
  }

  function goTo(date) {
    setCursor(parse(date))
    if (view === "month") setDayOpen(date)
  }

  function shift(direction) {
    const next = new Date(cursor)
    if (view === "month") next.setMonth(next.getMonth() + direction, 1)
    else next.setDate(next.getDate() + direction * (view === "week" ? 7 : 1))
    setCursor(next)
  }

  // A new event or task, on a day (and time) or at the next full hour today.
  function create(kind, date = "", start = "") {
    setCreating(false)
    setDayOpen("")
    const now = new Date()
    const hour = Math.min(22, now.getHours() + 1)
    const from = start || `${String(hour).padStart(2, "0")}:00`
    setEditor({ kind, date: date || (view === "day" ? iso(cursor) : today), start: from, end: addMinutes(from, 60), allDay: false })
  }

  const days = view === "day" ? [iso(cursor)] : view === "week" ? weekDays(cursor) : []
  const title = view === "month"
    ? cursor.toLocaleString("en-US", { month: "long", year: "numeric" })
    : view === "week" ? weekTitle(days) : parse(days[0]).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })

  return (
    <div className="workspace paycal-page">
      <div className="paycal">
        <aside className="paycal-side">
          <div className="cal-create" ref={createBox}>
            <button type="button" className="cal-create-button" onClick={() => setCreating((open) => !open)} aria-expanded={creating}>
              <Icon name="plus" size={16} /> Create <Icon name="chevron" size={12} />
            </button>
            {creating && (
              <div className="cal-create-menu" role="menu">
                <button type="button" role="menuitem" onClick={() => create("event")}><Icon name="calendar" size={15} /> Event</button>
                {canTask && <button type="button" role="menuitem" onClick={() => create("task")}><Icon name="check" size={15} /> Task</button>}
              </div>
            )}
          </div>
          <MiniMonth cursor={cursor} today={today} events={events} onPick={goTo} />
          <div className="paycal-group">
            <h2>Show</h2>
            {KINDS.map((kind) => (
              <div key={kind.id}>
                <label>
                  <input type="checkbox" checked={kinds[kind.id]} onChange={() => setKinds((current) => ({ ...current, [kind.id]: !current[kind.id] }))} />
                  <i className={`tone-${kindTone(kind.id)}`} />
                  {kind.id === "task" && taskScope === "mine" ? "My tasks" : kind.label}
                </label>
                {kind.id === "task" && canSeeAllTasks && (
                  <div className="paycal-scope" role="group" aria-label="Whose tasks">
                    <button type="button" className={taskScope === "mine" ? "is-on" : undefined} onClick={() => setTaskScope("mine")}>Mine</button>
                    <button type="button" className={taskScope === "all" ? "is-on" : undefined} onClick={() => setTaskScope("all")}>Everyone</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          <div className="paycal-group">
            <h2>Needs attention</h2>
            {urgent.length === 0 && <p>Nothing overdue or due soon.</p>}
            {urgent.map((event) => (
              <button key={event.id} type="button" className="paycal-attn" onClick={() => setDetail(event)}>
                <i className={`tone-${event.tone}`} />
                <span>
                  <strong>{event.title}</strong>
                  <em>{event.detail} · {event.date}</em>
                </span>
              </button>
            ))}
          </div>
        </aside>
        <section className="paycal-main">
          <header className="paycal-head">
            <h1>{title}</h1>
            <button type="button" onClick={() => { setCursor(parse(today)); setDayOpen("") }}>Today</button>
            <span className="paycal-nav">
              <button type="button" aria-label={`Previous ${view}`} onClick={() => shift(-1)}>‹</button>
              <button type="button" aria-label={`Next ${view}`} onClick={() => shift(1)}>›</button>
            </span>
            <span className="cal-views" role="group" aria-label="View">
              {VIEWS.map((item) => <button key={item.id} type="button" className={view === item.id ? "is-on" : undefined} onClick={() => chooseView(item.id)}>{item.label}</button>)}
            </span>
          </header>
          {!data.data && !data.error ? <PageSpinner /> : view === "month" ? (
            <MonthView cursor={cursor} events={events} today={today} selected={dayOpen} onDay={setDayOpen} onItem={setDetail} />
          ) : (
            <TimeGrid days={days} events={events} today={today} onDay={(date) => { setCursor(parse(date)); chooseView("day") }} onMore={setDayOpen} onSlot={(date, start) => create("event", date, start)} onItem={setDetail} />
          )}
          {data.error && <p className="banner">{data.error}</p>}
        </section>
        {dayOpen && (
          <DayList
            date={dayOpen}
            today={today}
            items={events.filter((event) => event.date === dayOpen)}
            canTask={canTask}
            onClose={() => setDayOpen("")}
            onCreate={(kind) => create(kind, dayOpen)}
            onItem={(item) => setDetail(item)}
          />
        )}
        {detail && (
          <ItemDetail
            item={detail}
            onClose={() => setDetail(null)}
            onEdit={() => { setEditor({ kind: "event", ...detail, editing: true }); setDetail(null) }}
            onDeleted={() => { setDetail(null); data.reload() }}
          />
        )}
        {editor && (
          <Editor
            initial={editor}
            canTask={canTask}
            canAssign={Boolean(session?.user && can(session.user, PERMISSIONS.tasksAssign))}
            me={session?.user?.id || ""}
            onClose={() => setEditor(null)}
            onSaved={() => { setEditor(null); data.reload() }}
          />
        )}
      </div>
    </div>
  )
}

/* ---------- month ---------- */

function MonthView({ cursor, events, today, selected, onDay, onItem }) {
  const cells = useMemo(() => monthCells(cursor), [cursor])
  return (
    <div className="paycal-grid">
      {WEEKDAYS.map((day) => <div key={day} className="paycal-dow">{day}</div>)}
      {cells.map((cell) => {
        const key = iso(cell.date)
        const matches = sortDay(events.filter((event) => event.date === key))
        return (
          <div key={key} role="button" tabIndex={0} className={`paycal-cell${cell.inMonth ? "" : " is-outside"}${key === selected ? " is-selected" : ""}`} onClick={() => onDay(key)} onKeyDown={(event) => { if (event.key === "Enter" && event.target === event.currentTarget) onDay(key) }}>
            <span className={key === today ? "paycal-num is-today" : "paycal-num"}>{cell.date.getDate()}</span>
            {matches.slice(0, 3).map((event) => (
              <button key={event.id} type="button" className={`paycal-pill tone-${event.tone}`} onClick={(click) => { click.stopPropagation(); onItem(event) }}>
                {event.kind === "event" && !event.allDay && <b>{shortTime(event.start)}</b>}{event.title}
              </button>
            ))}
            {matches.length > 3 && <em className="paycal-more">+{matches.length - 3} more</em>}
          </div>
        )
      })}
    </div>
  )
}

/* ---------- week and day ---------- */

function TimeGrid({ days, events, today, onDay, onMore, onSlot, onItem }) {
  const scroller = useRef(null)
  const [now, setNow] = useState(() => new Date())
  // Open on the working day: 7 AM, or a couple of hours before now when today is shown late in the day.
  useEffect(() => {
    const hour = days.includes(today) ? Math.min(Math.max(new Date().getHours() - 2, 7), 16) : 7
    if (scroller.current) scroller.current.scrollTop = hour * HOUR - 12
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [days.length])
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60000)
    return () => clearInterval(timer)
  }, [])
  const timed = (event) => event.kind === "event" && !event.allDay && event.start
  const nowMinutes = now.getHours() * 60 + now.getMinutes()
  const columns = `var(--cal-gutter) repeat(${days.length}, minmax(0, 1fr))`

  function slotAt(date, click) {
    const box = click.currentTarget.getBoundingClientRect()
    const minutes = Math.max(0, Math.min(23 * 60 + 30, Math.floor(((click.clientY - box.top) / HOUR) * 2) * 30))
    onSlot(date, fromMinutes(minutes))
  }

  return (
    <div className="cal-time" ref={scroller}>
      <div className="cal-time-top">
      <div className="cal-time-head" style={{ gridTemplateColumns: columns }}>
        <span />
        {days.map((date) => {
          const day = parse(date)
          return (
            <button key={date} type="button" className={date === today ? "cal-day-head is-today" : "cal-day-head"} onClick={() => onDay(date)} title="Open this day">
              <em>{WEEKDAYS[day.getDay()]}</em>
              <b>{day.getDate()}</b>
            </button>
          )
        })}
      </div>
      <div className="cal-allday" style={{ gridTemplateColumns: columns }}>
        <span className="cal-gutter-label">All day</span>
        {days.map((date) => {
          const items = sortDay(events.filter((event) => event.date === date && !timed(event)))
          return (
            <div key={date} className="cal-allday-cell">
              {items.slice(0, 3).map((event) => (
                <button key={event.id} type="button" className={`paycal-pill tone-${event.tone}`} onClick={() => onItem(event)}>{event.title}</button>
              ))}
              {items.length > 3 && <button type="button" className="paycal-more" onClick={() => onMore(date)}>+{items.length - 3} more</button>}
            </div>
          )
        })}
      </div>
      </div>
        <div className="cal-hours" style={{ gridTemplateColumns: columns, height: HOUR * 24 }}>
          <div className="cal-gutter">
            {Array.from({ length: 24 }, (_, hour) => <span key={hour} style={{ top: hour * HOUR }}>{hour ? clockLabel(`${String(hour).padStart(2, "0")}:00`) : ""}</span>)}
          </div>
          {days.map((date) => {
            const placed = layout(events.filter((event) => event.date === date && timed(event)))
            return (
              <div key={date} className="cal-column" onClick={(click) => slotAt(date, click)} title="Click to add an event">
                {placed.map(({ event, column, columns: count }) => {
                  const top = (toMinutes(event.start) / 60) * HOUR
                  const height = Math.max(22, ((toMinutes(event.end) - toMinutes(event.start)) / 60) * HOUR - 2)
                  return (
                    <button
                      key={event.id}
                      type="button"
                      className="cal-event"
                      style={{ top, height, left: `calc(${(column / count) * 100}% + 2px)`, width: `calc(${100 / count}% - 4px)` }}
                      onClick={(click) => { click.stopPropagation(); onItem(event) }}
                    >
                      <b>{event.title}</b>
                      <em>{clockLabel(event.start)} – {clockLabel(event.end)}{event.location ? ` · ${event.location}` : ""}</em>
                    </button>
                  )
                })}
                {date === today && <i className="cal-now" style={{ top: (nowMinutes / 60) * HOUR }} aria-hidden="true" />}
              </div>
            )
          })}
        </div>
    </div>
  )
}

// Side by side when events overlap, like a paper diary. Blocks are at least half an hour tall on screen, so a 15-minute
// event and the one right after it sit side by side instead of covering each other.
function shownEnd(event) {
  return Math.max(toMinutes(event.end), toMinutes(event.start) + 30)
}

function layout(items) {
  const sorted = [...items].sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || shownEnd(b) - shownEnd(a))
  const placed = []
  let group = []
  let groupEnd = -1
  const flush = () => {
    const ends = []
    for (const item of group) {
      let column = ends.findIndex((end) => end <= toMinutes(item.start))
      if (column === -1) column = ends.length
      ends[column] = shownEnd(item.event)
      item.column = column
    }
    for (const item of group) placed.push({ event: item.event, column: item.column, columns: ends.length })
    group = []
  }
  for (const event of sorted) {
    if (group.length && toMinutes(event.start) >= groupEnd) flush()
    group.push({ event, start: event.start, end: event.end })
    groupEnd = group.length === 1 ? shownEnd(event) : Math.max(groupEnd, shownEnd(event))
  }
  if (group.length) flush()
  return placed
}

/* ---------- popovers ---------- */

function Popover({ title, onClose, children, wide = false }) {
  const back = useRef(null)
  useEffect(() => {
    function onKey(event) {
      // A list inside (the guest picker) handles its own Escape first, and only the popover on top closes.
      if (event.key !== "Escape" || event.defaultPrevented) return
      const open = document.querySelectorAll(".paycal-pop-back")
      if (open[open.length - 1] === back.current) onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  return (
    <div className="paycal-pop-back" ref={back} onMouseDown={onClose}>
      <section className={wide ? "paycal-pop cal-pop is-wide" : "paycal-pop cal-pop"} role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        {children}
      </section>
    </div>
  )
}

function DayList({ date, today, items, canTask, onClose, onCreate, onItem }) {
  const sorted = sortDay(items)
  return (
    <Popover title={longDate(date)} onClose={onClose}>
      <header>
        <h2>{date === today ? `Today · ${longDate(date)}` : longDate(date)}</h2>
        <button type="button" aria-label="Close" onClick={onClose}>×</button>
      </header>
      <div className="cal-day-actions">
        <button type="button" onClick={() => onCreate("event")}><Icon name="plus" size={14} /> Event</button>
        {canTask && <button type="button" onClick={() => onCreate("task")}><Icon name="plus" size={14} /> Task</button>}
      </div>
      {sorted.length === 0 && <p className="cal-empty">Nothing on this day yet.</p>}
      <div className="cal-day-list">
        {sorted.map((event) => (
          <button key={event.id} type="button" className="cal-day-item" onClick={() => onItem(event)}>
            <i className={`tone-${event.tone}`} />
            <span>
              <strong>{event.title}</strong>
              <em>{[event.detail, kindLabel(event.kind), event.property].filter(Boolean).join(" · ")}</em>
            </span>
            {event.amount != null && <b>{money(event.amount)}</b>}
          </button>
        ))}
      </div>
    </Popover>
  )
}

function ItemDetail({ item, onClose, onEdit, onDeleted }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")
  async function remove() {
    if (!window.confirm(`Delete “${item.title}”?${item.guests?.length ? " Guests are told it is canceled." : ""}`)) return
    setBusy(true)
    try {
      await api(`/calendar/events/${item.eventId}`, { method: "DELETE" })
      onDeleted()
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }
  return (
    <Popover title={item.title} onClose={onClose}>
      <header>
        <span className="cal-detail-kind"><i className={`tone-${item.tone}`} />{kindLabel(item.kind)}</span>
        <span className="cal-detail-tools">
          {item.kind === "event" && item.canEdit && <button type="button" aria-label="Edit" title="Edit" onClick={onEdit}><Icon name="edit" size={16} /></button>}
          {item.kind === "event" && item.canEdit && <button type="button" aria-label="Delete" title="Delete" disabled={busy} onClick={remove}><Icon name="trash" size={16} /></button>}
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </span>
      </header>
      <h2 className="cal-detail-title">{item.title}</h2>
      <p className="cal-detail-when">{longDate(item.date)} · {item.kind === "event" ? (item.allDay ? "All day" : `${clockLabel(item.start)} – ${clockLabel(item.end)}`) : item.detail}</p>
      <dl className="cal-detail-facts">
        {item.property && <div><dt><Icon name="building" size={14} /></dt><dd>{item.property}</dd></div>}
        {item.location && <div><dt><Icon name="globe" size={14} /></dt><dd>{/^https?:\/\//i.test(item.location) ? <a href={item.location} target="_blank" rel="noreferrer">{item.location}</a> : item.location}</dd></div>}
        {item.guests?.length > 0 && <div><dt><Icon name="users" size={14} /></dt><dd>{[item.createdByName && `${item.createdByName} (organizer)`, ...item.guests.map((guest) => guest.name)].filter(Boolean).join(", ")}</dd></div>}
        {item.amount != null && <div><dt>$</dt><dd>{money(item.amount)}{item.payment != null ? ` · monthly payment ${money(item.payment)}` : ""}</dd></div>}
        {item.status && item.kind !== "event" && item.status !== item.detail && <div><dt><Icon name="pulse" size={14} /></dt><dd>{item.status}</dd></div>}
        {item.description && <div><dt><Icon name="file" size={14} /></dt><dd className="cal-detail-notes">{item.description}</dd></div>}
      </dl>
      {error && <p className="banner">{error}</p>}
      {item.href && <Link className="primary cal-open" href={item.href}>{OPEN_LABELS[item.kind] || "Open"}</Link>}
    </Popover>
  )
}

/* ---------- create and edit ---------- */

function Editor({ initial, canTask, canAssign, me, onClose, onSaved }) {
  const editing = Boolean(initial.editing)
  const [kind, setKind] = useState(initial.kind === "task" && canTask ? "task" : "event")
  const [title, setTitle] = useState(editing ? initial.title : "")
  const [date, setDate] = useState(initial.date)
  const [allDay, setAllDay] = useState(Boolean(initial.allDay))
  const [start, setStart] = useState(initial.start || "09:00")
  const [end, setEnd] = useState(initial.end || "10:00")
  const [guestIds, setGuestIds] = useState(editing ? (initial.guests || []).map((guest) => guest.id) : [])
  const [location, setLocation] = useState(editing ? initial.location || "" : "")
  const [description, setDescription] = useState(editing ? initial.description || "" : "")
  const [propertyId, setPropertyId] = useState(editing ? initial.propertyId || "" : "")
  const [priority, setPriority] = useState("Medium")
  const [assigneeId, setAssigneeId] = useState(me)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const people = useApi("/calendar/people")
  const properties = useApi("/properties")
  const assignees = useApi(canAssign && kind === "task" ? "/tasks/assignees" : "")

  const lastLength = useRef(60)
  function moveStart(value) {
    // Keep the same length when the start moves (remembered while the start is being retyped).
    if (start && end && toMinutes(end) > toMinutes(start)) lastLength.current = toMinutes(end) - toMinutes(start)
    setStart(value)
    if (value) setEnd(fromMinutes(Math.min(23 * 60 + 59, toMinutes(value) + Math.max(15, lastLength.current))))
  }

  async function save(event) {
    event.preventDefault()
    setError("")
    if (!title.trim()) {
      setError(kind === "task" ? "Say what needs to happen." : "Give the event a title.")
      return
    }
    setPending(true)
    try {
      if (kind === "task") {
        await api("/tasks", { method: "POST", body: { title: title.trim(), due: date, priority, propertyId: propertyId || undefined, notes: description, ...(canAssign ? { assigneeId } : {}) } })
      } else {
        const body = { title: title.trim(), date, allDay, start: allDay ? "" : start, end: allDay ? "" : end, guestIds, location, description, propertyId }
        if (editing) await api(`/calendar/events/${initial.eventId}`, { method: "PATCH", body })
        else await api("/calendar/events", { method: "POST", body })
      }
      onSaved()
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  const organizer = initial.organizerId || me
  const options = (people.data?.items || []).filter((person) => person.id !== organizer).map((person) => ({ id: person.id, label: person.name, hint: person.email }))
  return (
    <Popover title={editing ? "Edit event" : kind === "task" ? "New task" : "New event"} onClose={pending ? () => {} : onClose} wide>
      <form className="cal-editor" onSubmit={save}>
        <header>
          <span />
          <button type="button" aria-label="Close" onClick={onClose}>×</button>
        </header>
        <input className="cal-editor-title" value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind === "task" ? "Add a task" : "Add title"} maxLength={200} autoFocus />
        {!editing && canTask && (
          <div className="cal-kind" role="tablist">
            <button type="button" role="tab" aria-selected={kind === "event"} className={kind === "event" ? "is-on" : undefined} onClick={() => setKind("event")}>Event</button>
            <button type="button" role="tab" aria-selected={kind === "task"} className={kind === "task" ? "is-on" : undefined} onClick={() => setKind("task")}>Task</button>
          </div>
        )}
        <div className="cal-editor-row">
          <Icon name="calendar" size={16} />
          <div className="cal-when">
            <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required aria-label={kind === "task" ? "Due date" : "Date"} />
            {kind === "event" && !allDay && (
              <>
                <input type="time" value={start} step="900" onChange={(event) => moveStart(event.target.value)} required aria-label="Starts" />
                <span>–</span>
                <input type="time" value={end} step="900" onChange={(event) => setEnd(event.target.value)} required aria-label="Ends" />
              </>
            )}
            {kind === "event" && <label className="cal-allday-toggle"><input type="checkbox" checked={allDay} onChange={(event) => setAllDay(event.target.checked)} /> All day</label>}
            {kind === "task" && (
              <select value={priority} onChange={(event) => setPriority(event.target.value)} aria-label="Priority">
                {["Low", "Medium", "High"].map((item) => <option key={item} value={item}>{item} Priority</option>)}
              </select>
            )}
          </div>
        </div>
        {kind === "event" && (
          <div className="cal-editor-row">
            <Icon name="users" size={16} />
            <MultiSelect options={options} selected={guestIds} onChange={setGuestIds} placeholder="Add guests" noun={["person", "people"]} emptyText={people.error ? `Couldn't load people: ${people.error}` : people.data ? "Nobody else uses the calendar yet." : "Loading people…"} />
          </div>
        )}
        {kind === "task" && canAssign && (
          <div className="cal-editor-row">
            <Icon name="users" size={16} />
            <select value={assigneeId} onChange={(event) => setAssigneeId(event.target.value)} aria-label="Assignee">
              <option value="">Unassigned</option>
              {(assignees.data?.items || (me ? [{ id: me, name: "Me" }] : [])).map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}
            </select>
          </div>
        )}
        {kind === "event" && (
          <div className="cal-editor-row">
            <Icon name="globe" size={16} />
            <input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="Add location or meeting link" maxLength={200} />
          </div>
        )}
        <div className="cal-editor-row">
          <Icon name="building" size={16} />
          <select value={propertyId} onChange={(event) => setPropertyId(event.target.value)} aria-label="Property">
            <option value="">No Property</option>
            {(properties.data?.items || []).map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
          </select>
        </div>
        <div className="cal-editor-row">
          <Icon name="file" size={16} />
          <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder={kind === "task" ? "Add a note" : "Add a description"} rows={3} maxLength={4000} />
        </div>
        {error && <p className="banner">{error}</p>}
        <footer>
          {kind === "event" && guestIds.length > 0 && <span className="cal-editor-note">{guestIds.length === 1 ? "Your guest gets" : `Your ${guestIds.length} guests get`} an invitation{editing ? " if anything changes" : ""}.</span>}
          <button type="button" className="tool" onClick={onClose} disabled={pending}>Cancel</button>
          <button type="submit" className="primary" disabled={pending}>{pending ? "Saving…" : "Save"}</button>
        </footer>
      </form>
    </Popover>
  )
}

/* ---------- small pieces ---------- */

function MiniMonth({ cursor, today, events, onPick }) {
  const [shown, setShown] = useState(() => new Date(cursor.getFullYear(), cursor.getMonth(), 1))
  useEffect(() => {
    setShown(new Date(cursor.getFullYear(), cursor.getMonth(), 1))
  }, [cursor])
  const cells = useMemo(() => monthCells(shown), [shown])
  const marked = new Set(events.map((event) => event.date))
  const selected = iso(cursor)
  return (
    <div className="paycal-mini">
      <div className="paycal-mini-head">
        <button type="button" aria-label="Previous month" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() - 1, 1))}>‹</button>
        <strong>{shown.toLocaleString("en-US", { month: "long", year: "numeric" })}</strong>
        <button type="button" aria-label="Next month" onClick={() => setShown(new Date(shown.getFullYear(), shown.getMonth() + 1, 1))}>›</button>
      </div>
      <div className="paycal-mini-grid">
        {WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 1)}</span>)}
        {cells.map((cell) => {
          const key = iso(cell.date)
          return (
            <button key={key} type="button" className={`${cell.inMonth ? "" : "is-outside"}${key === today ? " is-today" : ""}${key === selected && key !== today ? " is-picked" : ""}`} onClick={() => onPick(key)}>
              {cell.date.getDate()}
              {marked.has(key) && <i />}
            </button>
          )
        })}
      </div>
    </div>
  )
}

function kindLabel(kind) {
  return { event: "Event", bill: "Bill", loan: "Loan", draw: "Draw", task: "Task", expense: "Posted cost" }[kind] || "Item"
}

function kindTone(kind) {
  if (kind === "event") return "event"
  if (kind === "bill") return "warn"
  if (kind === "loan") return "bad"
  if (kind === "draw") return "info"
  if (kind === "task") return "neutral"
  return "good"
}

// Timed events first (by time), then the rest.
function sortDay(items) {
  return [...items].sort((a, b) => {
    const at = a.kind === "event" && !a.allDay ? toMinutes(a.start) : -1
    const bt = b.kind === "event" && !b.allDay ? toMinutes(b.start) : -1
    return at - bt || Number(b.urgent) - Number(a.urgent)
  })
}

function monthCells(cursor) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const start = new Date(first)
  start.setDate(1 - first.getDay())
  return Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return { date, inMonth: date.getMonth() === cursor.getMonth() }
  })
}

function weekDays(cursor) {
  const start = new Date(cursor)
  start.setDate(cursor.getDate() - cursor.getDay())
  return Array.from({ length: 7 }, (_, index) => {
    const date = new Date(start)
    date.setDate(start.getDate() + index)
    return iso(date)
  })
}

function weekTitle(days) {
  const first = parse(days[0])
  const last = parse(days[6])
  const sameMonth = first.getMonth() === last.getMonth()
  return `${first.toLocaleDateString("en-US", { month: "short", day: "numeric" })} – ${last.toLocaleDateString("en-US", sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" })}, ${last.getFullYear()}`
}

function longDate(value) {
  return parse(value).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })
}

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function parse(value) {
  const [year, month, day] = String(value).split("-").map(Number)
  return new Date(year, month - 1, day)
}

function toMinutes(value) {
  const [hours, minutes] = String(value || "0:0").split(":").map(Number)
  return (hours || 0) * 60 + (minutes || 0)
}

function fromMinutes(total) {
  return `${String(Math.floor(total / 60)).padStart(2, "0")}:${String(total % 60).padStart(2, "0")}`
}

function addMinutes(value, minutes) {
  return fromMinutes(Math.min(23 * 60 + 59, toMinutes(value) + minutes))
}

function clockLabel(value) {
  const total = toMinutes(value)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  const suffix = hours >= 12 ? "PM" : "AM"
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""} ${suffix}`
}

// "3:30p" in a month cell, like Google.
function shortTime(value) {
  const total = toMinutes(value)
  const hours = Math.floor(total / 60)
  const minutes = total % 60
  return `${hours % 12 || 12}${minutes ? `:${String(minutes).padStart(2, "0")}` : ""}${hours >= 12 ? "p" : "a"} `
}
