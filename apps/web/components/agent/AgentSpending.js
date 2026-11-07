"use client"

import { useEffect, useState } from "react"
import { api } from "../../lib/api"

const FEATURES = {
  agent: "Agent questions",
  memory: "Agent memory",
  receipts: "Receipt reading",
  documents: "Document reading",
  calls: "Call notes",
  teammate: "AI teammate",
  other: "Other",
}

// An AI cost to the cent, and under a cent as "<$0.01" (one question can cost a fraction of a cent).
export function spend(value) {
  const number = Number(value) || 0
  if (number > 0 && number < 0.005) return "<$0.01"
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(number)
}

const count = (value) => Number(value || 0).toLocaleString("en-US")

// "November 2026" (the heading over the picker says when it is this month).
function monthName(month) {
  const [year, number] = month.split("-").map(Number)
  return new Date(Date.UTC(year, number - 1, 1, 12)).toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })
}

function dayName(day) {
  return new Date(`${day}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" })
}

// Settings → Agent: the team's monthly AI budget, and what the AI cost in a month (each day, by what it was for, by
// person and by model). `settings` from /agent/settings: monthlyLimit, spent, resets.
export function AgentSpending({ settings, onSaved }) {
  const [limit, setLimit] = useState(settings.monthlyLimit == null ? "" : String(settings.monthlyLimit))
  const [month, setMonth] = useState("")
  const [usage, setUsage] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [message, setMessage] = useState("")

  useEffect(() => {
    let live = true
    api(`/agent/usage${month ? `?month=${month}` : ""}`)
      .then((data) => live && setUsage(data))
      .catch((err) => live && setError(err.message))
    return () => {
      live = false
    }
  }, [month, settings.monthlyLimit])

  const saved = settings.monthlyLimit == null ? "" : String(settings.monthlyLimit)
  const typed = limit.replace(/[$,\s]/g, "")
  const changed = typed !== saved && !(typed === "" && saved === "")

  async function save(event) {
    event.preventDefault()
    if (typed && !/^\d+(\.\d{1,2})?$/.test(typed)) {
      setError("Enter the monthly budget in dollars, like 500, or leave it blank for no limit.")
      return
    }
    setPending(true)
    setError("")
    setMessage("")
    try {
      const data = await api("/agent/settings", { method: "PATCH", body: { monthlyLimit: typed === "" ? null : Number(typed) } })
      onSaved(data.settings)
      setLimit(data.settings.monthlyLimit == null ? "" : String(data.settings.monthlyLimit))
      setMessage(data.settings.monthlyLimit == null ? "Saved. There is no monthly limit." : `Saved. New AI work stops once this month's spending reaches ${spend(data.settings.monthlyLimit)}.`)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  const budget = settings.monthlyLimit
  const share = budget ? Math.min(100, (settings.spent / budget) * 100) : 0
  const tone = budget == null ? "" : settings.spent >= budget ? "is-bad" : share >= 80 ? "is-warn" : "is-good"
  return (
    <section className="panel settings-card agent-spend">
      <div>
        <h2>AI spending</h2>
        <p>What the AI models cost the team: Agent questions and memory, reading receipts and documents, call notes and the AI teammate. The figures are what OpenRouter charged.</p>
      </div>
      {error && <div className="banner">{error}</div>}
      <div className="agent-spend-now">
        <p><strong>{spend(settings.spent)}</strong> spent this month{budget != null && <> of the {spend(budget)} budget</>}</p>
        {budget != null && <div className={`agent-spend-bar ${tone}`} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(share)} aria-label="This month's AI budget used"><i style={{ width: `${share}%` }} /></div>}
        <p className="agent-spend-detail">{budget != null && settings.spent >= budget ? `The budget is used up: new AI work is paused until ${settings.resets}, or until the budget is raised.` : `Starts again on ${settings.resets}.`}</p>
      </div>
      <form className="agent-spend-budget" onSubmit={save}>
        <label className="field">
          <span>Monthly budget (USD)</span>
          <input value={limit} onChange={(event) => { setLimit(event.target.value); setMessage("") }} inputMode="decimal" placeholder="No limit" maxLength={12} />
        </label>
        <button type="submit" className="primary" disabled={pending || !changed}>{pending ? "Saving…" : "Save budget"}</button>
        <p className="agent-spend-hint">New AI work stops when this month's spending reaches it, and admins are notified at 80% and 100%. A question already being answered finishes. Leave it blank for no limit.</p>
        {message && <p className="settings-note">{message}</p>}
      </form>
      {usage && <SpendingMonth usage={usage} onMonth={setMonth} />}
    </section>
  )
}

function SpendingMonth({ usage, onMonth }) {
  const empty = !usage.calls
  return (
    <div className="agent-spend-month">
      <div className="agent-spend-month-head">
        <h3>{usage.current ? "This month" : monthName(usage.month)}</h3>
        <label className="agent-spend-pick">
          <span className="sr-only">Month</span>
          <select value={usage.month} onChange={(event) => onMonth(event.target.value)}>
            {usage.months.map((month) => <option key={month} value={month}>{monthName(month)}</option>)}
          </select>
        </label>
      </div>
      <p className="agent-spend-total"><strong>{spend(usage.total)}</strong> · {count(usage.calls)} model {usage.calls === 1 ? "call" : "calls"}</p>
      {empty ? (
        <p className="agent-spend-none">No AI use was recorded {usage.current ? "this month yet" : "that month"}.</p>
      ) : (
        <>
          <DailyBars days={usage.byDay} />
          <div className="agent-spend-tables">
            <SpendTable title="By what it was for" rows={usage.byFeature.map((row) => ({ key: row.feature, name: FEATURES[row.feature] || row.feature, ...row }))} total={usage.total} />
            <SpendTable title="By person" rows={usage.byPerson.map((row) => ({ key: row.id || "background", ...row }))} total={usage.total} />
            <SpendTable title="By model" rows={usage.byModel.map((row) => ({ key: row.model, name: row.model, ...row }))} total={usage.total} keepCase />
          </div>
          {usage.estimated && <p className="agent-spend-hint">Some figures are estimates from the models' listed prices, where the model service gave no cost.</p>}
        </>
      )}
    </div>
  )
}

// Each day's spending as a bar (the tallest sets the scale); hover or focus a day for its figures.
function DailyBars({ days }) {
  const [shown, setShown] = useState(-1)
  const top = Math.max(...days.map((day) => day.cost), 0)
  const peak = days.findIndex((day) => day.cost === top && top > 0)
  const ticks = [0, Math.floor((days.length - 1) / 2), days.length - 1].filter((value, index, list) => list.indexOf(value) === index)
  // Near the ends a label lines up with its bar's outer side, so it stays inside the chart on a narrow phone.
  const edge = (index) => (index > days.length * 0.66 ? " is-left" : index < days.length * 0.33 ? " is-right" : "")
  return (
    <figure className="agent-spend-chart" aria-label="Spending each day">
      <div className="agent-spend-scale" aria-hidden="true"><span>{spend(top)}</span><span>$0</span></div>
      <div className="agent-spend-plot" onMouseLeave={() => setShown(-1)}>
        {days.map((day, index) => (
          <button
            key={day.day}
            type="button"
            className={index === shown ? "agent-spend-day is-on" : "agent-spend-day"}
            onMouseEnter={() => setShown(index)}
            onFocus={() => setShown(index)}
            onBlur={() => setShown(-1)}
            aria-label={`${dayName(day.day)}: ${spend(day.cost)}, ${count(day.calls)} calls`}
          >
            <i style={{ height: top ? `${Math.max(day.cost > 0 ? 3 : 0, (day.cost / top) * 100)}%` : 0 }} />
            {index === peak && shown === -1 && <em className={`agent-spend-peak${edge(index)}`}>{spend(day.cost)}</em>}
            {index === shown && (
              <span className={`agent-spend-tip keep-case${edge(index)}`} role="tooltip">
                <strong>{dayName(day.day)}</strong>
                <span>{spend(day.cost)} · {count(day.calls)} {day.calls === 1 ? "call" : "calls"}</span>
              </span>
            )}
          </button>
        ))}
      </div>
      <div className="agent-spend-axis" aria-hidden="true">
        {ticks.map((index) => <span key={index} style={{ left: `${((index + 0.5) / days.length) * 100}%` }}>{Number(days[index].day.slice(8, 10))}</span>)}
      </div>
    </figure>
  )
}

// `keepCase`: names written exactly as they are (model ids such as moonshotai/kimi-k3).
function SpendTable({ title, rows, total, keepCase = false }) {
  return (
    <div className="agent-spend-table">
      <h4>{title}</h4>
      <table>
        <thead><tr><th scope="col">Name</th><th scope="col">Cost</th><th scope="col">Calls</th></tr></thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" className={keepCase ? "keep-case" : undefined}>{row.name}<i style={{ width: `${total ? Math.max(2, (row.cost / total) * 100) : 0}%` }} aria-hidden="true" /></th>
              <td>{spend(row.cost)}</td>
              <td>{count(row.calls)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
