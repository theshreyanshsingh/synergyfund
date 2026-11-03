"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { DndContext, PointerSensor, closestCenter, useSensor, useSensors } from "@dnd-kit/core"
import { SortableContext, arrayMove, rectSortingStrategy, useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import { can } from "@synergifund/shared"
import { Attention } from "../../../components/overview/Attention"
import { CustomizeSheet } from "../../../components/ui/CustomizeSheet"
import { Icon } from "../../../components/ui/Icon"
import { PageSpinner } from "../../../components/ui/Spinner"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
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
  const sourceCards = overview.data?.cards || []
  const [order, setOrder] = useState([])
  const cards = useMemo(() => arrangeCards(sourceCards, order), [sourceCards, order])
  // Each person's own Insights: the sections they hid with Customize.
  const [hidden, setHidden] = useState([])
  const [customizing, setCustomizing] = useState(false)
  const shownCards = cards.filter((card) => !hidden.includes(card.id))
  const projection = overview.data?.projection
  const attention = overview.data?.attention || []
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }))
  // A new window is loading: the figures on screen are still the last window's, so they fade until the new ones arrive.
  const updating = overview.loading && Boolean(overview.data)
  const savingOrder = useRef(false)

  useEffect(() => {
    if (savingOrder.current || !Array.isArray(overview.data?.order)) return
    setOrder(overview.data.order)
  }, [overview.data])

  useEffect(() => {
    if (Array.isArray(overview.data?.hidden)) setHidden(overview.data.hidden)
  }, [overview.data])

  const sections = overview.data ? [
    { id: "attention", name: "Needs attention", hint: `Overdue and the next ${overview.data.days} days, tasks this week` },
    { id: "projection", name: `Next ${overview.data.days} days`, hint: `Costs expected at the pace of the past ${overview.data.days} days` },
    ...cards.map((card) => ({ id: card.id, name: card.title, hint: card.hint })),
  ] : []
  const nothingShown = sections.length > 0 && sections.every((section) => hidden.includes(section.id))

  function choose(next) {
    setDays(next)
  }

  return (
    <div className={updating ? "workspace is-updating" : "workspace"} aria-busy={updating || undefined}>
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title">Insights</h1>
        </div>
        <div className="overview-actions">
          <div className="overview-controls" role="group" aria-label="Projection window">
            {WINDOWS.map((option) => (
              <button key={option} type="button" className={days === option ? "on" : ""} onClick={() => choose(option)}>{option} days</button>
            ))}
          </div>
          {overview.data && (
            <button type="button" className="import-button overview-customize" onClick={() => setCustomizing(true)} aria-label="Customize Insights" title="Choose what your Insights page shows">
              <Icon name="sliders" size={14} />
              <span>Customize</span>
            </button>
          )}
          {writable && (
            <button type="button" className="primary" onClick={() => router.push("/properties?new=1")}>
              <Icon name="plus" size={14} />
              New property
            </button>
          )}
        </div>
      </div>
      {!overview.data && !overview.error && <PageSpinner />}
      {nothingShown && (
        <section className="overview-attention overview-empty">
          <h2>Your Insights page is empty</h2>
          <p>Everything is hidden. Choose what to show here; only your Insights page changes.</p>
          <button type="button" className="primary" onClick={() => setCustomizing(true)}>Customize</button>
        </section>
      )}
      {overview.data && !hidden.includes("attention") && <Attention items={attention} days={overview.data.days} onOpen={(href) => router.push(href)} />}
      {projection && !hidden.includes("projection") && <Projection days={projection.days} projection={projection} />}
      {overview.error && <p className="draws-empty">{overview.error}</p>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={async (event) => {
        const { active, over } = event
        if (!over || active.id === over.id) return
        // Moved among all the cards, so a hidden card keeps its place for when it is shown again.
        const next = arrayMove(cards.map((card) => card.id), cards.findIndex((card) => card.id === active.id), cards.findIndex((card) => card.id === over.id))
        savingOrder.current = true
        setOrder(next)
        try {
          const result = await api("/overview/order", { method: "PATCH", body: { order: next } })
          setOrder(result.order)
        } catch (err) {
          window.alert(err.message)
        } finally {
          savingOrder.current = false
        }
      }}>
        <SortableContext items={shownCards.map((card) => card.id)} strategy={rectSortingStrategy}>
          <div className="overview-grid">
            {shownCards.map((card) => (
              <SortableCard key={card.id} card={card} labels={card.labels || overview.data?.labels || []} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      {customizing && (
        <CustomizeSheet
          eyebrow="Insights"
          title="Customize Insights"
          hint="Choose what your Insights page shows. Only yours changes; drag a chart card by its handle to move it."
          path="/overview/hidden"
          sections={sections}
          hidden={hidden}
          onClose={() => setCustomizing(false)}
          onSaved={(next) => { setHidden(next); setCustomizing(false) }}
        />
      )}
    </div>
  )
}

function SortableCard({ card, labels }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: card.id })
  const style = { transform: CSS.Transform.toString(transform), transition }
  return (
    <article ref={setNodeRef} style={style} className={isDragging ? "overview-card is-dragging" : "overview-card"}>
      <div className="overview-card-top">
        <div className="overview-card-copy">
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
        <button type="button" className="overview-handle" aria-label={`Move ${card.title}`} {...attributes} {...listeners}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true"><circle cx="4" cy="3" r="1.1" /><circle cx="10" cy="3" r="1.1" /><circle cx="4" cy="7" r="1.1" /><circle cx="10" cy="7" r="1.1" /><circle cx="4" cy="11" r="1.1" /><circle cx="10" cy="11" r="1.1" /></svg>
        </button>
      </div>
      <LineChart labels={labels} lines={card.lines} money={card.money} />
      {card.note && <p className="overview-note">{card.note}</p>}
    </article>
  )
}

function arrangeCards(cards, order) {
  const pending = new Map(cards.map((card) => [card.id, card]))
  const arranged = []
  for (const id of order) {
    const card = pending.get(id)
    if (!card) continue
    arranged.push(card)
    pending.delete(id)
  }
  arranged.push(...pending.values())
  return arranged
}

function Projection({ days, projection }) {
  const expenses = projection.expenses || []
  const scheduled = projection.scheduled || []
  return (
    <section className="overview-projection">
      <div>
        <span>Next {days} days</span>
        <strong>{formatMoney(projection.expenseTotal || 0)}</strong>
        <p>Same pace as the past {days} days. Financing is listed here and left off the Rehab costs line.</p>
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
