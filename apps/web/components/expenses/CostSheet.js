"use client"

import { useEffect, useState } from "react"
import { COST_GROUPS, COST_TYPES } from "@synergifund/shared"
import { useApi } from "../../lib/useApi"
import { api } from "../../lib/api"
import { dollars } from "../../lib/format"
import { FormSheet } from "../ui/FormSheet"
import { StatusPill } from "../ui/StatusPill"
import { Icon } from "../ui/Icon"

// A property's cost sheet: everything the house has cost, from the purchase price on (closing costs, insurance, taxes,
// interest, labor, materials, selling costs), with subtotals and the all-in cost. Costs can be added like rows on an
// inventory sheet; ones added by hand can be changed or deleted. Receipts and approved requests show here as filed.

const ADDABLE = COST_GROUPS.flatMap((group) => group.types.filter((type) => COST_TYPES[type]).map((type) => ({ group: group.label, type })))

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function shortDate(value) {
  if (!value) return ""
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`)
  return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

// version: bump it to load again (after a receipt or cost is filed elsewhere on the page). onChanged: after a change here.
export function CostSheet({ propertyId, version = 0, onChanged }) {
  const data = useApi(`/expenses/cost-sheet?propertyId=${propertyId}`)
  const [form, setForm] = useState(null)
  const [purchase, setPurchase] = useState(null)
  const [open, setOpen] = useState({})
  const [message, setMessage] = useState("")
  useEffect(() => {
    if (version) data.reload()
  }, [version])

  if (data.error) return <p className="banner">{data.error}</p>
  if (!data.data) return <p className="tracking-empty"><span className="spinner tw:animate-spin" /> Loading the cost sheet…</p>
  const { sheet, property, canAdd, canEditPurchase } = data.data
  const byId = Object.fromEntries(sheet.groups.map((group) => [group.id, group]))
  const spread = property.arv != null ? Number(property.arv) - sheet.total : null

  function changed(note) {
    setMessage(note)
    data.reload()
    onChanged?.()
  }

  async function remove(row) {
    if (!window.confirm(`Delete "${row.description}" (${dollars(row.amount)})? It comes off this property's costs.`)) return
    try {
      await api(`/expenses/costs/${row.id}`, { method: "DELETE" })
      changed(`Deleted ${row.description}.`)
    } catch (err) {
      setMessage(err.message)
    }
  }

  return (
    <section className="cost-sheet">
      <div className="tracking-stats">
        <article className="cost-sheet-total"><span>All-in cost</span><b>{dollars(sheet.total)}</b><small>{sheet.pendingCount ? `${dollars(sheet.pending)} waiting for approval, not included` : "Approved costs and the purchase price"}</small></article>
        <article><span>Purchase</span><b>{dollars(byId.purchase.total)}</b><small>Price and closing costs</small></article>
        <article><span>Holding</span><b>{dollars(byId.holding.total)}</b><small>Insurance, taxes, interest</small></article>
        <article><span>Rehab</span><b>{dollars(byId.rehab.total)}</b><small>Labor and materials</small></article>
        {spread != null && <article><span>ARV less costs</span><b className={spread < 0 ? "is-bad" : undefined}>{dollars(spread)}</b><small>ARV {dollars(property.arv)}</small></article>}
        <div className="tracking-export">
          {canAdd && <button type="button" className="primary" onClick={() => setForm({ mode: "add", type: "Closing costs" })}><Icon name="plus" size={15} /> Add cost</button>}
          <span className="tracking-export-label">Export</span>
          <a className="tool" href={`/api/expenses/cost-sheet/export?propertyId=${propertyId}&format=xlsx`} data-name="cost-sheet.xlsx">Excel</a>
          <a className="tool" href={`/api/expenses/cost-sheet/export?propertyId=${propertyId}&format=csv`} data-name="cost-sheet.csv">CSV</a>
        </div>
      </div>

      {message && <p className="cost-sheet-note">{message}</p>}

      <div className="panel cost-sheet-card">
        {sheet.groups.map((group) => (
          <div key={group.id} className="cost-group">
            <div className="cost-group-head">
              <h3>{group.label}</h3>
              <b>{dollars(group.total)}</b>
            </div>
            {group.types.map((entry) => {
              const key = `${group.id}:${entry.type}`
              const purchaseLine = entry.type === "Purchase price"
              if (purchaseLine) {
                return (
                  <div key={key} className="cost-type cost-purchase">
                    <div className="cost-type-row">
                      <span className="cost-type-name">Purchase price</span>
                      <span className="cost-type-meta">{sheet.purchasePrice == null ? "Not entered yet" : sheet.purchaseDate ? shortDate(sheet.purchaseDate) : "Date not entered"}</span>
                      <b className="cost-type-total">{sheet.purchasePrice == null ? "—" : dollars(sheet.purchasePrice)}</b>
                      {canEditPurchase ? <button type="button" className="tool cost-row-action" onClick={() => setPurchase({ price: sheet.purchasePrice ?? "", date: sheet.purchaseDate || "" })}>{sheet.purchasePrice == null ? "Add" : "Edit"}</button> : <span />}
                    </div>
                  </div>
                )
              }
              const expanded = Boolean(open[key])
              return (
                <div key={key} className={expanded ? "cost-type is-open" : "cost-type"}>
                  <div className="cost-type-row">
                    <button type="button" className="cost-type-toggle" disabled={!entry.count} aria-expanded={expanded} onClick={() => setOpen({ ...open, [key]: !expanded })}>
                      <span className="cost-chevron" aria-hidden="true">{entry.count > 0 && <Icon name="chevron" size={14} />}</span>
                      <span className="cost-type-name">{entry.type}</span>
                    </button>
                    <span className="cost-type-meta">{entry.count ? `${entry.count} ${entry.count === 1 ? "item" : "items"}${entry.pending ? ` · ${dollars(entry.pending)} waiting` : ""}` : "None yet"}</span>
                    <b className="cost-type-total">{entry.count ? dollars(entry.total) : "—"}</b>
                    {canAdd && entry.addable ? <button type="button" className="tool cost-row-action" onClick={() => setForm({ mode: "add", type: entry.type })} aria-label={`Add ${entry.type.toLowerCase()}`}>Add</button> : <span />}
                  </div>
                  {expanded && (
                    <ul className="cost-lines">
                      {entry.rows.map((row) => (
                        <CostLine key={row.id} row={row} canEdit={canAdd} onEdit={() => setForm({ mode: "edit", row, type: entry.type })} onDelete={() => remove(row)} />
                      ))}
                    </ul>
                  )}
                </div>
              )
            })}
          </div>
        ))}
        <div className="cost-group-head cost-sheet-foot">
          <h3>All-in cost</h3>
          <b>{dollars(sheet.total)}</b>
        </div>
        {sheet.loanPayoffs.count > 0 && (
          <p className="cost-sheet-hint">Loan payoffs ({dollars(sheet.loanPayoffs.total)}) are not counted: they repay the loan, and the purchase price is already here.</p>
        )}
        {sheet.pendingCount > 0 && (
          <p className="cost-sheet-hint">{sheet.pendingCount} {sheet.pendingCount === 1 ? "cost is" : "costs are"} waiting for approval ({dollars(sheet.pending)}). {sheet.pendingCount === 1 ? "It counts" : "They count"} once approved.</p>
        )}
      </div>

      {form && <CostForm propertyId={propertyId} form={form} onClose={() => setForm(null)} onSaved={(note) => { setForm(null); changed(note) }} />}
      {purchase && <PurchaseForm propertyId={propertyId} initial={purchase} onClose={() => setPurchase(null)} onSaved={() => { setPurchase(null); changed("Purchase price saved.") }} />}
    </section>
  )
}

function CostLine({ row, canEdit, onEdit, onDelete }) {
  const file = row.fileIds?.[0]
  const url = file ? row.proofUrls?.[file] || `/api/documents/${file}/raw` : ""
  const waiting = row.state !== "approved"
  return (
    <li className={waiting ? "cost-line is-waiting" : "cost-line"}>
      <span className="cost-line-date">{shortDate(row.date) || "No date"}</span>
      <span className="cost-line-what">
        <strong>{row.description || "Cost"}</strong>
        <small>{[row.vendor, row.buyer ? `${row.receiptId || row.requestId ? "Bought by" : "Added by"} ${row.buyer}` : "", row.category && row.category !== row.type ? row.category : ""].filter(Boolean).join(" · ")}</small>
      </span>
      <span className="cost-line-amount">{dollars(row.amount)}</span>
      <span className="cost-line-side">
        {waiting && <StatusPill>{row.status || "Waiting for approval"}</StatusPill>}
        {url && <a className="cost-line-file" href={url} target="_blank" rel="noreferrer" aria-label={`Receipt for ${row.description}`}><Icon name="file" size={14} /></a>}
        {canEdit && row.editable && (
          <>
            <button type="button" className="icon-btn" onClick={onEdit} aria-label={`Change ${row.description}`} title="Change"><Icon name="edit" size={14} /></button>
            <button type="button" className="icon-btn" onClick={onDelete} aria-label={`Delete ${row.description}`} title="Delete"><Icon name="trash" size={14} /></button>
          </>
        )}
      </span>
    </li>
  )
}

function CostForm({ propertyId, form, onClose, onSaved }) {
  const editing = form.mode === "edit"
  const [type, setType] = useState(form.type in COST_TYPES ? form.type : "Other costs")
  const [title, setTitle] = useState(editing ? form.row.description || "" : "")
  const [vendor, setVendor] = useState(editing ? form.row.vendor || "" : "")
  const [date, setDate] = useState(editing ? form.row.date || today() : today())
  const [amount, setAmount] = useState(editing ? String(form.row.amount ?? "") : "")
  const [files, setFiles] = useState([])
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const kind = COST_TYPES[type]

  async function submit(event) {
    event.preventDefault()
    setError("")
    const value = Number(String(amount).replace(/[$,\s]/g, ""))
    if (!title.trim()) return setError("Enter a description, like Title and settlement fees.")
    if (!Number.isFinite(value) || value <= 0) return setError("Enter the amount as a number above $0, like 2,450.00.")
    if (!date) return setError("Enter the date it was paid.")
    setPending(true)
    try {
      if (editing) {
        await api(`/expenses/costs/${form.row.id}`, { method: "PATCH", body: { type, title: title.trim(), vendor: vendor.trim(), date, amount: value } })
        onSaved(`Saved ${title.trim()}.`)
      } else {
        const body = new FormData()
        body.set("propertyId", propertyId)
        body.set("title", title.trim())
        body.set("vendor", vendor.trim())
        body.set("date", date)
        body.set("amount", String(value))
        body.set("category", kind.category)
        body.set("entity", kind.entity)
        body.set("costTreatment", kind.costTreatment)
        for (const file of files) body.append("proof", file, file.name)
        await api("/expenses/post", { method: "POST", body })
        onSaved(`Added ${title.trim()} (${dollars(value)}) to ${type.toLowerCase()}.`)
      }
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet eyebrow="Cost sheet" title={editing ? "Change cost" : "Add cost"} hint={kind?.hint} onClose={onClose} onSubmit={submit} submitLabel={editing ? "Save" : "Add cost"} pending={pending} error={error}>
      <div className="form-grid">
        <label className="field wide"><span>Type</span>
          <select value={type} onChange={(event) => setType(event.target.value)}>
            {COST_GROUPS.filter((group) => ADDABLE.some((item) => item.group === group.label)).map((group) => (
              <optgroup key={group.id} label={group.label}>
                {ADDABLE.filter((item) => item.group === group.label).map((item) => <option key={item.type} value={item.type}>{item.type}</option>)}
              </optgroup>
            ))}
          </select>
        </label>
        <label className="field wide"><span>Description</span><input value={title} onChange={(event) => setTitle(event.target.value)} placeholder={kind?.hint} maxLength={200} required /></label>
        <label className="field"><span>Paid to</span><input value={vendor} onChange={(event) => setVendor(event.target.value)} placeholder="Company or person" maxLength={120} /></label>
        <label className="field"><span>Date paid</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} required /></label>
        <label className="field"><span>Amount</span><input inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} placeholder="0.00" required /></label>
        {!editing && (
          <label className="field"><span>Receipt or statement (optional)</span>
            <input type="file" accept="image/*,application/pdf,.pdf" multiple onChange={(event) => setFiles([...event.target.files].slice(0, 12))} />
          </label>
        )}
      </div>
    </FormSheet>
  )
}

function PurchaseForm({ propertyId, initial, onClose, onSaved }) {
  const [price, setPrice] = useState(initial.price === "" ? "" : String(initial.price))
  const [date, setDate] = useState(initial.date)
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    setError("")
    const text = String(price).replace(/[$,\s]/g, "")
    const value = text === "" ? null : Number(text)
    if (value != null && (!Number.isFinite(value) || value < 0)) return setError("Enter the purchase price as a number, like 168000.")
    setPending(true)
    try {
      await api(`/properties/${propertyId}`, { method: "PATCH", body: { purchasePrice: value, purchaseDate: date || "" } })
      onSaved()
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet eyebrow="Cost sheet" title="Purchase price" hint="What the house was bought for, and the closing date. Closing costs go in their own lines." onClose={onClose} onSubmit={submit} submitLabel="Save" pending={pending} error={error}>
      <div className="form-grid">
        <label className="field"><span>Purchase price</span><input inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} placeholder="168000" /></label>
        <label className="field"><span>Purchase date</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label>
      </div>
    </FormSheet>
  )
}
