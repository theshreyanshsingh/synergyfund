"use client"

import { useEffect, useState } from "react"
import { useRouter } from "next/navigation"
import { can } from "@synergifund/shared"
import { Icon } from "../../../components/ui/Icon"
import { useSession } from "../../../components/shell/Providers"
import { useApi } from "../../../lib/useApi"
import { money as formatMoney } from "../../../lib/format"

const LINE_COLORS = ["var(--ink)", "var(--good)", "var(--warn)"]
const WINDOWS = [30, 60, 90]

export default function OverviewPage() {
  const router = useRouter()
  const session = useSession()
  const [days, setDays] = useState(30)
  const overview = useApi(`/overview?days=${days}`)
  const writable = session?.user && can(session.user, "properties.write")
  const cards = overview.data?.cards || []
  const projection = overview.data?.projection

  useEffect(() => {
    const stored = Number(window.localStorage.getItem("synergifund-overview-days"))
    if (WINDOWS.includes(stored)) setDays(stored)
  }, [])

  function choose(next) {
    setDays(next)
    window.localStorage.setItem("synergifund-overview-days", String(next))
  }

  return (
    <div className="workspace">
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title">Overview</h1>
        </div>
        <div className="overview-actions">
          <div className="overview-controls" role="group" aria-label="Projection window">
            {WINDOWS.map((option) => (
              <button key={option} type="button" className={days === option ? "on" : ""} onClick={() => choose(option)}>{option} days</button>
            ))}
          </div>
          {writable && (
            <button type="button" className="primary" onClick={() => router.push("/properties?new=1")}>
              <Icon name="plus" size={14} />
              New property
            </button>
          )}
        </div>
      </div>
      {projection && <Projection days={projection.days} projection={projection} />}
      {overview.error && <p className="draws-empty">{overview.error}</p>}
      {overview.loading && !cards.length && <p className="draws-empty">Loading the portfolio…</p>}
      <div className="overview-grid">
        {cards.map((card) => (
          <article key={card.title} className="overview-card">
            <div className="overview-card-top">
              <div>
                <span>{card.title}</span>
                <strong>{card.value}</strong>
                <p>{card.hint}</p>
              </div>
              <div className="overview-legend">
                {card.lines.map((line, index) => (
                  <span key={line.name}><i style={{ background: LINE_COLORS[index % LINE_COLORS.length] }} />{line.name}</span>
                ))}
                <span><i className="overview-legend-dash" />Projection</span>
              </div>
            </div>
            <LineChart labels={card.labels || overview.data?.labels || []} lines={card.lines} money={card.money} />
            {card.note && <p className="overview-note">{card.note}</p>}
          </article>
        ))}
      </div>
    </div>
  )
}

function Projection({ days, projection }) {
  const expenses = projection.expenses || []
  const scheduled = projection.scheduled || []
  return (
    <section className="overview-projection">
      <div>
        <span>Next {days} days</span>
        <strong>{formatMoney(projection.expenseTotal || 0)}</strong>
        <p>Posted in the past {days} days, by category. The last point on each graph repeats that same window. Financing is included here and left off the Rehab costs line.</p>
      </div>
      <ul>
        {expenses.map((item) => (
          <li key={item.category}><span>{item.category}</span><b>{formatMoney(item.amount)}</b></li>
        ))}
        {!expenses.length && <li><span>No expenses were posted in the past {days} days.</span></li>}
      </ul>
      {scheduled.length > 0 && (
        <p className="overview-note">Already scheduled, not added to the lines: {scheduled.map((item) => `${item.title} ${formatMoney(item.amount)} on ${item.due}`).join(" · ")}.</p>
      )}
    </section>
  )
}

function LineChart({ labels = [], lines = [], money }) {
  const width = 640
  const height = 210
  const pad = { left: 56, right: 12, top: 16, bottom: 28 }
  const values = lines.flatMap((line) => line.points || [])
  const max = Math.max(...values, 1)
  const innerW = width - pad.left - pad.right
  const innerH = height - pad.top - pad.bottom
  const xAt = (index) => pad.left + (labels.length <= 1 ? innerW / 2 : (index / (labels.length - 1)) * innerW)
  const yAt = (value) => pad.top + innerH - (value / max) * innerH
  const ticks = [max, max / 2, 0]

  return (
    <svg className="overview-line" viewBox={`0 0 ${width} ${height}`} role="img">
      {ticks.map((tick) => (
        <g key={tick}>
          <line x1={pad.left} x2={width - pad.right} y1={yAt(tick)} y2={yAt(tick)} className="overview-gridline" />
          <text x={pad.left - 8} y={yAt(tick) + 4} textAnchor="end" className="overview-axis">{formatTick(tick, money)}</text>
        </g>
      ))}
      {labels.length > 1 && (
        <line x1={xAt(labels.length - 1)} x2={xAt(labels.length - 1)} y1={pad.top} y2={height - pad.bottom} className="overview-future" />
      )}
      {lines.map((line, index) => {
        const color = LINE_COLORS[index % LINE_COLORS.length]
        const values = line.points || []
        const actual = values.slice(0, -1)
        const solid = actual.map((value, point) => `${xAt(point).toFixed(1)},${yAt(value).toFixed(1)}`).join(" ")
        const last = actual.length - 1
        const dash = actual.length && values.length > actual.length
          ? `${xAt(last).toFixed(1)},${yAt(actual[last]).toFixed(1)} ${xAt(values.length - 1).toFixed(1)},${yAt(values[values.length - 1]).toFixed(1)}`
          : ""
        return (
          <g key={line.name}>
            <polyline points={solid} fill="none" stroke={color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
            {dash && <polyline points={dash} fill="none" stroke={color} strokeWidth="2.5" strokeDasharray="5 4" strokeLinecap="round" />}
            {actual.map((value, point) => (
              <circle key={point} cx={xAt(point)} cy={yAt(value)} r="3" fill={color} />
            ))}
            {values.length > actual.length && (
              <circle cx={xAt(values.length - 1)} cy={yAt(values[values.length - 1])} r="3.5" fill="var(--white)" stroke={color} strokeWidth="2" />
            )}
          </g>
        )
      })}
      {labels.map((label, index) => (
        <text key={label + index} x={xAt(index)} y={height - 8} textAnchor="middle" className={index === labels.length - 1 ? "overview-axis overview-forecast" : "overview-axis"}>{label}</text>
      ))}
    </svg>
  )
}

function formatTick(value, money) {
  const number = Math.round(value)
  if (!money) return String(number)
  if (Math.abs(number) >= 1000000) return `$${(number / 1000000).toFixed(1)}M`
  if (Math.abs(number) >= 1000) return `$${Math.round(number / 1000)}k`
  return `$${number}`
}
