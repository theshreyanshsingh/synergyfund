"use client"

import { useState } from "react"
import { Icon } from "../ui/Icon"
import { parseDay, todayKey } from "./taskFormat"

const WEEKDAYS = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"]
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

function typed(value) {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(value).trim())
  if (!match) return ""
  const [, month, day, year] = match.map(Number)
  const date = new Date(year, month - 1, day, 12)
  return date.getMonth() === month - 1 && date.getDate() === day ? todayKey(date) : ""
}

function shown(key) {
  const date = parseDay(key)
  return date ? `${String(date.getMonth() + 1).padStart(2, "0")}/${String(date.getDate()).padStart(2, "0")}/${date.getFullYear()}` : ""
}

// A month to pick a due date from: Today, the date typed as MM/DD/YYYY, the month and year, and Clear.
// `today`: the team's date (the Today button and the underlined day).
export function DatePicker({ value, onPick, today = todayKey() }) {
  const start = parseDay(value) || new Date()
  const [month, setMonth] = useState({ year: start.getFullYear(), month: start.getMonth() })
  const [text, setText] = useState(shown(value))
  const first = new Date(month.year, month.month, 1, 12)
  const lead = (first.getDay() + 6) % 7
  const cells = Array.from({ length: 42 }, (_, index) => todayKey(new Date(month.year, month.month, index - lead + 1, 12)))
  const move = (step) => setMonth(({ year, month: current }) => {
    const date = new Date(year, current + step, 1, 12)
    return { year: date.getFullYear(), month: date.getMonth() }
  })
  const years = Array.from({ length: 11 }, (_, index) => new Date().getFullYear() - 3 + index)
  if (!years.includes(month.year)) years.push(month.year)
  return (
    <div className="date-picker">
      <div className="date-picker-top">
        <button type="button" className="date-picker-today" onClick={() => onPick(today)}>Today</button>
        {value && <button type="button" className="date-picker-clear" onClick={() => onPick("")}>Clear</button>}
      </div>
      <input
        className="date-picker-input"
        value={text}
        placeholder="MM/DD/YYYY"
        aria-label="Due date"
        inputMode="numeric"
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key !== "Enter") return
          event.preventDefault()
          const key = typed(text)
          if (key) onPick(key)
        }}
        onBlur={() => {
          const key = typed(text)
          if (key && key !== value) onPick(key)
        }}
      />
      <div className="date-picker-nav">
        <select aria-label="Month" value={month.month} onChange={(event) => setMonth((current) => ({ ...current, month: Number(event.target.value) }))}>
          {MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}
        </select>
        <select aria-label="Year" value={month.year} onChange={(event) => setMonth((current) => ({ ...current, year: Number(event.target.value) }))}>
          {years.sort((a, b) => a - b).map((year) => <option key={year} value={year}>{year}</option>)}
        </select>
        <span />
        <button type="button" onClick={() => move(-1)} aria-label="Previous month"><Icon name="back" size={16} /></button>
        <button type="button" onClick={() => move(1)} aria-label="Next month" className="is-next"><Icon name="back" size={16} /></button>
      </div>
      <div className="date-picker-grid" role="grid">
        {WEEKDAYS.map((name) => <span key={name} className="date-picker-weekday">{name}</span>)}
        {cells.map((key) => {
          const date = parseDay(key)
          const outside = date.getMonth() !== month.month
          return (
            <button
              key={key}
              type="button"
              className={["date-picker-day", outside ? "is-outside" : "", key === today ? "is-today" : "", key === value ? "is-on" : ""].filter(Boolean).join(" ")}
              aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}
              aria-pressed={key === value}
              onClick={() => onPick(key)}
            >
              {date.getDate()}
            </button>
          )
        })}
      </div>
    </div>
  )
}
