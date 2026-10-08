"use client"

import { useMemo, useState } from "react"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
const KINDS = [
  { id: "bill", label: "Bills" },
  { id: "loan", label: "Loans" },
  { id: "draw", label: "Draws" },
  { id: "task", label: "To-dos" },
  { id: "expense", label: "Posted costs" },
]

export default function CalendarPage() {
  const [taskScope, setTaskScope] = useState("mine")
  const data = useApi(taskScope === "all" ? "/calendar?tasks=all" : "/calendar")
  const [cursor, setCursor] = useState(() => new Date())
  const [selected, setSelected] = useState("")
  const [kinds, setKinds] = useState({ bill: true, loan: true, draw: true, task: true, expense: true })
  const canSeeAllTasks = Boolean(data.data?.canSeeAllTasks)
  const events = (data.data?.events || []).filter((event) => kinds[event.kind])
  const today = data.data?.today || iso(new Date())
  const cells = useMemo(() => monthCells(cursor), [cursor])
  const selectedEvents = events.filter((event) => event.date === selected)
  const urgent = events.filter((event) => event.urgent)

  function showDate(date) {
    setSelected(date)
    const [year, month] = date.split("-").map(Number)
    setCursor(new Date(year, month - 1, 1))
  }

  function shift(months) {
    setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + months, 1))
    setSelected("")
  }

  return (
    <div className="workspace paycal-page">
      <div className="paycal">
        <aside className="paycal-side">
          <MiniMonth cursor={cursor} today={today} events={events} onPick={showDate} onShift={shift} />
          <div className="paycal-group">
            <h2>Show</h2>
            {KINDS.map((kind) => (
              <div key={kind.id}>
                <label>
                  <input type="checkbox" checked={kinds[kind.id]} onChange={() => setKinds((current) => ({ ...current, [kind.id]: !current[kind.id] }))} />
                  <i className={`tone-${kindTone(kind.id)}`} />
                  {kind.id === "task" && taskScope === "mine" ? "My to-dos" : kind.label}
                </label>
                {kind.id === "task" && canSeeAllTasks && (
                  <div className="paycal-scope" role="group" aria-label="Whose to-dos">
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
              <button key={event.id} type="button" className="paycal-attn" onClick={() => showDate(event.date)}>
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
            <h1>{cursor.toLocaleString("en-US", { month: "long", year: "numeric" })}</h1>
            <button type="button" onClick={() => showDate(today)}>Today</button>
            <span className="paycal-nav">
              <button type="button" aria-label="Previous month" onClick={() => shift(-1)}>‹</button>
              <button type="button" aria-label="Next month" onClick={() => shift(1)}>›</button>
            </span>
          </header>
          <div className="paycal-grid">
            {WEEKDAYS.map((day) => <div key={day} className="paycal-dow">{day}</div>)}
            {cells.map((cell) => {
              const key = iso(cell.date)
              const matches = events.filter((event) => event.date === key)
              return (
                <button key={key} type="button" className={`paycal-cell${cell.inMonth ? "" : " is-outside"}${key === selected ? " is-selected" : ""}`} onClick={() => setSelected(selected === key ? "" : key)}>
                  <span className={key === today ? "paycal-num is-today" : "paycal-num"}>{cell.date.getDate()}</span>
                  {matches.slice(0, 3).map((event) => (
                    <em key={event.id} className={`paycal-pill tone-${event.tone}`}>{event.title}</em>
                  ))}
                  {matches.length > 3 && <em className="paycal-more">+{matches.length - 3} more</em>}
                </button>
              )
            })}
          </div>
        </section>
        {selected && selectedEvents.length > 0 && (
          <div className="paycal-pop-back" onMouseDown={() => setSelected("")}>
            <section className="paycal-pop" onMouseDown={(event) => event.stopPropagation()}>
              <header>
                <h2>{selected === today ? "Today" : selected}</h2>
                <button type="button" aria-label="Close" onClick={() => setSelected("")}>×</button>
              </header>
              {selectedEvents.length === 0 && <p>Nothing is dated on this day.</p>}
              {selectedEvents.map((event) => (
                <article key={event.id}>
                  <i className={`tone-${event.tone}`} />
                  <div>
                    <strong>{event.title}</strong>
                    <p>{[event.detail, kindLabel(event.kind), event.property].filter(Boolean).join(" · ")}</p>
                    {event.payment != null && <p>Payment on file {money(event.payment)}</p>}
                  </div>
                  {event.amount != null && <b>{money(event.amount)}</b>}
                </article>
              ))}
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

function MiniMonth({ cursor, today, events, onPick, onShift }) {
  const cells = useMemo(() => monthCells(cursor), [cursor])
  const marked = new Set(events.map((event) => event.date))
  return (
    <div className="paycal-mini">
      <div className="paycal-mini-head">
        <button type="button" aria-label="Previous month" onClick={() => onShift(-1)}>‹</button>
        <strong>{cursor.toLocaleString("en-US", { month: "long", year: "numeric" })}</strong>
        <button type="button" aria-label="Next month" onClick={() => onShift(1)}>›</button>
      </div>
      <div className="paycal-mini-grid">
        {WEEKDAYS.map((day) => <span key={day}>{day.slice(0, 1)}</span>)}
        {cells.map((cell) => {
          const key = iso(cell.date)
          return (
            <button key={key} type="button" className={`${cell.inMonth ? "" : "is-outside"}${key === today ? " is-today" : ""}`} onClick={() => onPick(key)}>
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
  return KINDS.find((item) => item.id === kind)?.label || "Item"
}

function kindTone(kind) {
  if (kind === "bill") return "warn"
  if (kind === "loan") return "bad"
  if (kind === "draw") return "info"
  if (kind === "task") return "neutral"
  return "good"
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

function iso(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}
