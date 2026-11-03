"use client"

import { useState } from "react"
import { Icon } from "../ui/Icon"
import { Modal } from "../ui/Modal"
import { money as formatMoney } from "../../lib/format"

// Needs attention, on Insights (overdue and what is coming up) and on Home (overdue only): the first three, and
// View all for the rest. `subtitle` replaces the line under the title; `empty` is said when there is nothing.
export function Attention({ items, days, onOpen, subtitle = "", empty = "" }) {
  const [showAll, setShowAll] = useState(false)
  const overdue = items.filter((item) => item.tone === "bad").length
  const preview = items.slice(0, 3)
  const openItem = (href) => {
    setShowAll(false)
    onOpen(href)
  }
  return (
    <section className="overview-attention">
      <header>
        <div>
          <h2>Needs attention</h2>
          <p>{items.length > 0 ? `${items.length} ${items.length === 1 ? "item" : "items"}${overdue ? ` · ${overdue} overdue` : ""} · ` : ""}{subtitle || `Overdue and the next ${days} days, tasks this week`}</p>
        </div>
        {items.length > 3 && <button type="button" className="overview-attention-more" onClick={() => setShowAll(true)}>View all</button>}
      </header>
      {items.length === 0 && <p className="overview-attention-empty">{empty || `Nothing in those books is overdue or coming up in the next ${days} days.`}</p>}
      {items.length > 0 && (
        <ul className="overview-attention-list">
          {preview.map((item) => <AttentionItem key={item.id} item={item} onOpen={openItem} />)}
        </ul>
      )}
      {showAll && (
        <Modal title={`Needs attention · ${items.length}`} wide onClose={() => setShowAll(false)}>
          <p className="overview-attention-summary">{overdue ? `${overdue} overdue · ` : ""}Ordered by urgency and due date</p>
          <ul className="overview-attention-list is-all">
            {items.map((item) => <AttentionItem key={item.id} item={item} onOpen={openItem} />)}
          </ul>
        </Modal>
      )}
    </section>
  )
}

function AttentionItem({ item, onOpen }) {
  return (
    <li>
      <button type="button" className={`overview-attn tone-${item.tone}`} onClick={() => onOpen(item.href)}>
        <span className="overview-attn-icon">
          <Icon name={attentionIcon(item.kind)} size={16} />
        </span>
        <span className="overview-attn-copy">
          <small>{item.kind}{item.tone === "bad" ? " · Overdue" : ""}</small>
          <strong>{item.title}</strong>
          {/* Lines break between the parts ("12 Oak Lane · Due within 30 days · Oct 24"), never inside a date. */}
          <em>{[item.property, item.detail, dayLabel(item.date)].filter(Boolean).join("\u00a0· ")}</em>
        </span>
        {item.amount != null && <b>{formatMoney(item.amount)}</b>}
      </button>
    </li>
  )
}

// "2026-10-21" as "Oct 21", with the year only when it is not this year.
function dayLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value || ""
  const date = new Date(`${value}T12:00:00`)
  const options = { month: "short", day: "numeric" }
  if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric"
  return date.toLocaleDateString("en-US", options).replace(/ /g, "\u00a0")
}

function attentionIcon(kind) {
  if (kind === "Draw") return "layers"
  if (kind === "Mortgage" || kind === "Loan") return "bank"
  if (kind === "Insurance") return "file"
  if (kind === "Verify") return "alert"
  return "check"
}

