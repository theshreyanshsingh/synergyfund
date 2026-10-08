"use client"

import { useState } from "react"
import { PAYING_ENTITIES, PAYMENT_CATEGORIES, PAYMENT_RECURRENCES, can } from "@synergifund/shared"
import { FormSheet } from "../../../components/ui/FormSheet"
import { RowMenu } from "../../../components/ui/RowMenu"
import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { useApi } from "../../../lib/useApi"

function cash(value) {
  if (value == null || value === "") return "—"
  const number = Number(value) || 0
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: number % 1 ? 2 : 0, maximumFractionDigits: 2 }).format(number)
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function shift(key, days) {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(year, month - 1, day + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function shortDate(key) {
  if (!/^\d{4}-\d{2}-\d{2}/.test(key || "")) return key || "—"
  const [year, month, day] = key.slice(0, 10).split("-").map(Number)
  return new Date(year, month - 1, day).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function blankPayment() {
  return { title: "", amount: "", due: today(), recurrence: "One time", category: "Other", entity: PAYING_ENTITIES[0], propertyId: "", vendor: "" }
}

export default function PaymentsPage() {
  const session = useSession()
  const list = useApi("/bills")
  const expenses = useApi("/expenses")
  const properties = useApi("/properties")
  const [editing, setEditing] = useState(null)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [notice, setNotice] = useState(null)
  const canPay = session?.user && can(session.user, "expenses.approve")
  const now = today()
  const soon = shift(now, 30)
  const bills = list.data?.items || []
  const posted = (expenses.data?.expenses || [])
    .filter((item) => item.costTreatment !== "Exclude from construction margin")
    .map((item) => ({ id: `posted-${item.id}`, title: item.title, entity: item.entity || "Construction company", due: item.date || "", amount: item.amount, status: "Posted", category: item.category, recurrence: "One time", posted: true }))
  const unpaid = bills.filter((item) => item.status !== "Paid")
  const overdue = unpaid.filter((item) => item.due && item.due < now)
  const dueSoon = unpaid.filter((item) => item.due && item.due <= soon)
  const rows = [
    ...bills.map((item) => ({ ...item, status: item.status === "Paid" ? "Paid" : item.due && item.due < now ? "Overdue" : "Scheduled" })),
    ...posted,
  ]

  function open(payment) {
    setError("")
    setEditing(payment ? { ...blankPayment(), ...payment, amount: String(payment.amount ?? "") } : blankPayment())
  }

  function set(key) {
    return (event) => setEditing((current) => ({ ...current, [key]: event.target.value }))
  }

  async function save(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    const body = {
      title: editing.title,
      amount: editing.amount,
      due: editing.due,
      recurrence: editing.recurrence,
      category: editing.category,
      entity: editing.entity,
      propertyId: editing.propertyId,
      vendor: editing.vendor,
    }
    try {
      if (editing.id) await api(`/bills/${editing.id}`, { method: "PATCH", body })
      else await api("/bills", { method: "POST", body })
      setNotice({ ok: true, text: `${editing.title} ${editing.id ? "updated" : "added"}. It shows on the calendar${editing.recurrence !== "One time" ? ` and repeats ${editing.recurrence.toLowerCase()}` : ""}.` })
      setEditing(null)
      list.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function pay(row) {
    const repeat = row.recurrence && row.recurrence !== "One time"
    if (!window.confirm(`Mark ${row.title} (${cash(row.amount)}) paid? This posts it to the books${repeat ? " and schedules the next one" : ""}.`)) return
    try {
      const result = await api(`/bills/${row.id}/pay`, { method: "POST", body: {} })
      setNotice({ ok: true, text: `${row.title} marked paid.${result.next ? ` Next one is due ${shortDate(result.next.due)}.` : ""}` })
      list.reload()
      expenses.reload()
    } catch (err) {
      setNotice({ ok: false, text: err.message })
    }
  }

  async function remove(row) {
    if (!window.confirm(`Delete ${row.title} due ${shortDate(row.due)}?${row.recurrence !== "One time" ? " Future repeats are removed too." : ""}`)) return
    try {
      await api(`/bills/${row.id}`, { method: "DELETE" })
      setNotice({ ok: true, text: `${row.title} deleted.` })
      list.reload()
    } catch (err) {
      setNotice({ ok: false, text: err.message })
    }
  }

  return (
    <>
      <WorkspacePage
        views={false}
        selectable={false}
        compact
        customize={false}
        loading={(!list.data && !list.error) || (!expenses.data && !expenses.error)}
        title="Upcoming payments"
        action={canPay ? { label: "Add payment", onClick: () => open(null) } : null}
        lead={notice ? <p className={notice.ok ? "settings-note members-notice" : "banner members-notice"}>{notice.text}</p> : null}
        stats={[
          { label: "Due in 30 days", value: cash(dueSoon.reduce((sum, item) => sum + Number(item.amount || 0), 0)), hint: `${dueSoon.length} ${dueSoon.length === 1 ? "payment" : "payments"}, overdue included` },
          { label: "Overdue", value: String(overdue.length), hint: overdue.length ? cash(overdue.reduce((sum, item) => sum + Number(item.amount || 0), 0)) : "Nothing late" },
          { label: "Repeating", value: String(unpaid.filter((item) => item.recurrence && item.recurrence !== "One time").length), hint: "Scheduled again when paid" },
          { label: "Posted costs", value: cash(posted.reduce((sum, item) => sum + Number(item.amount || 0), 0)), hint: "Approved onto the books" },
        ]}
        filters={[
          { key: "status", label: "Status", options: ["Overdue", "Scheduled", "Paid", "Posted"], value: (row) => row.status },
          { key: "category", label: "Type", options: PAYMENT_CATEGORIES, value: (row) => row.category },
          { key: "property", label: "Property", value: (row) => row.property || (row.posted ? "" : "Company-wide") },
        ]}
        important={(row) => row.status === "Overdue" || (row.status === "Scheduled" && row.due <= soon)}
        columns={[
          { key: "title", label: "Payment", render: (row) => <span className="person-copy"><strong>{row.title}</strong><small>{[row.category, row.vendor].filter(Boolean).join(" · ") || row.entity}</small></span> },
          { key: "due", label: "Due", render: (row) => <span className="person-copy"><span>{shortDate(row.due)}</span>{row.recurrence && row.recurrence !== "One time" && <small>Repeats {row.recurrence.toLowerCase()}</small>}</span> },
          { key: "amount", label: "Amount", render: (row) => cash(row.amount) },
          { key: "status", label: "Status", render: (row) => <StatusPill>{row.status}</StatusPill> },
          { key: "property", label: "Property", render: (row) => row.posted ? "—" : row.property || "Company-wide" },
          { key: "actions", label: "", pin: "right", className: "menu-col", render: (row) => canPay && !row.posted && row.status !== "Paid" ? (
            <RowMenu
              label={`Actions for ${row.title}`}
              items={[
                { label: "Mark paid", onClick: () => pay(row) },
                { label: "Edit", onClick: () => open(row) },
                { label: "Delete", danger: true, onClick: () => remove(row) },
              ]}
            />
          ) : null },
        ]}
        rows={rows}
        onRow={canPay ? (row) => !row.posted && row.status !== "Paid" && open(row) : undefined}
        empty={canPay ? "No payments yet. Add a mortgage, tax, insurance or any other payment and it shows on the calendar." : "No payments scheduled."}
      />
      {editing && (
        <FormSheet
          eyebrow="Payments"
          title={editing.id ? "Edit payment" : "Add a payment"}
          hint="This records a payment you need to make. It does not send money. It shows on the calendar on its due date."
          onClose={() => setEditing(null)}
          onSubmit={save}
          submitLabel={editing.id ? "Save payment" : "Add payment"}
          pending={pending}
          error={error}
        >
          <div className="form-grid">
            <label className="field wide"><span>Name</span><input value={editing.title} onChange={set("title")} placeholder="Kiavi mortgage, County property tax…" maxLength={160} required /></label>
            <label className="field"><span>Amount</span><input value={editing.amount} onChange={set("amount")} inputMode="decimal" placeholder="1,450.00" required /></label>
            <label className="field"><span>Due date</span><input type="date" value={editing.due} onChange={set("due")} required /></label>
            <label className="field"><span>Repeats</span>
              <select value={editing.recurrence} onChange={set("recurrence")}>{PAYMENT_RECURRENCES.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="field"><span>Type</span>
              <select value={editing.category} onChange={set("category")}>{PAYMENT_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="field"><span>Paid by</span>
              <select value={editing.entity} onChange={set("entity")}>{PAYING_ENTITIES.map((item) => <option key={item}>{item}</option>)}</select>
            </label>
            <label className="field"><span>Property</span>
              <select value={editing.propertyId} onChange={set("propertyId")}>
                <option value="">Company-wide</option>
                {(properties.data?.items || []).map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}
              </select>
            </label>
            <label className="field wide"><span>Payee</span><input value={editing.vendor} onChange={set("vendor")} placeholder="Who gets paid (optional)" maxLength={120} /></label>
          </div>
        </FormSheet>
      )}
    </>
  )
}
