"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { useApi } from "../../lib/useApi"
import { dollars } from "../../lib/format"
import { StatusPill } from "../ui/StatusPill"

// What is being spent, item by item: every cost on the books and every one waiting for approval, with totals per
// property, category and buyer, filters, and exports (Excel, CSV, QuickBooks, receipt photos). On a property page it
// shows that property only.

const PRESETS = [
  { id: "all", label: "All time" },
  { id: "this-month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "this-year", label: "This year" },
  { id: "last-year", label: "Last year" },
  { id: "custom", label: "Choose dates" },
]
const PAGE = 150
const QB_KEY = "synergifund:quickbooks-accounts"

function day(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function dates(preset, custom) {
  const now = new Date()
  if (preset === "this-month") return { from: day(new Date(now.getFullYear(), now.getMonth(), 1)), to: day(new Date(now.getFullYear(), now.getMonth() + 1, 0)) }
  if (preset === "last-month") return { from: day(new Date(now.getFullYear(), now.getMonth() - 1, 1)), to: day(new Date(now.getFullYear(), now.getMonth(), 0)) }
  if (preset === "this-year") return { from: `${now.getFullYear()}-01-01`, to: `${now.getFullYear()}-12-31` }
  if (preset === "last-year") return { from: `${now.getFullYear() - 1}-01-01`, to: `${now.getFullYear() - 1}-12-31` }
  if (preset === "custom") return { from: custom.from, to: custom.to }
  return { from: "", to: "" }
}

function shortDate(value) {
  if (!value) return ""
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function readAccounts() {
  try {
    return { account: "Job Supplies", paidFrom: "Contractor purchases", useCategory: false, ...JSON.parse(window.localStorage.getItem(QB_KEY) || "{}") }
  } catch {
    return { account: "Job Supplies", paidFrom: "Contractor purchases", useCategory: false }
  }
}

// version: bump it to load again (after a receipt is filed from the page).
export function ExpenseTracking({ propertyId = "", action = null, version = 0 }) {
  const [preset, setPreset] = useState("all")
  const [custom, setCustom] = useState({ from: "", to: "" })
  const [status, setStatus] = useState("all")
  const [category, setCategory] = useState("")
  const [buyerId, setBuyerId] = useState("")
  const [place, setPlace] = useState("")
  const [typed, setTyped] = useState("")
  const [q, setQ] = useState("")
  const [shown, setShown] = useState(PAGE)
  const [accounts, setAccounts] = useState({ account: "Job Supplies", paidFrom: "Contractor purchases", useCategory: false })
  const fixed = Boolean(propertyId)
  const qbRef = useRef(null)

  // The QuickBooks panel closes on a click anywhere else.
  useEffect(() => {
    function onDown(event) {
      if (qbRef.current?.open && !qbRef.current.contains(event.target)) qbRef.current.open = false
    }
    document.addEventListener("pointerdown", onDown)
    return () => document.removeEventListener("pointerdown", onDown)
  }, [])

  useEffect(() => setAccounts(readAccounts()), [])
  useEffect(() => {
    const timer = setTimeout(() => setQ(typed.trim()), 300)
    return () => clearTimeout(timer)
  }, [typed])

  const range = dates(preset, custom)
  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (range.from) params.set("from", range.from)
    if (range.to) params.set("to", range.to)
    if (status !== "all") params.set("status", status)
    if (category) params.set("category", category)
    if (buyerId) params.set("buyerId", buyerId)
    if (fixed) params.set("propertyId", propertyId)
    else if (place) params.set("propertyId", place)
    if (q) params.set("q", q)
    return params.toString()
  }, [range.from, range.to, status, category, buyerId, place, q, fixed, propertyId])
  const data = useApi(`/expenses/tracking${query ? `?${query}` : ""}`)
  useEffect(() => setShown(PAGE), [query])
  useEffect(() => {
    if (version) data.reload()
  }, [version])

  function saveAccounts(next) {
    setAccounts(next)
    try {
      window.localStorage.setItem(QB_KEY, JSON.stringify(next))
    } catch {}
  }

  const result = data.data
  const rows = result?.rows || []
  const totals = result?.totals || { approved: 0, pending: 0, total: 0, count: 0, receipts: 0 }
  const options = result?.options || { categories: [], buyers: [], properties: [] }
  const filtered = preset !== "all" || status !== "all" || category || buyerId || place || q
  const exportQuery = query ? `&${query}` : ""
  const qbQuery = new URLSearchParams({ account: accounts.account || "", paidFrom: accounts.paidFrom || "", ...(accounts.useCategory ? { useCategory: "1" } : {}) }).toString()
  const maxCategory = Math.max(1, ...(result?.byCategory || []).map((entry) => Math.abs(entry.total)))
  // The zip holds at most 1,000 photos (see expenses.js); with none, there is nothing to download.
  const photoCount = new Set(rows.flatMap((row) => row.fileIds || [])).size

  return (
    <section className="tracking">
      <div className="tracking-filters">
        <label className="field"><span>Dates</span>
          <select value={preset} onChange={(event) => setPreset(event.target.value)}>{PRESETS.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</select>
        </label>
        {preset === "custom" && (
          <>
            <label className="field"><span>From</span><input type="date" value={custom.from} onChange={(event) => setCustom({ ...custom, from: event.target.value })} /></label>
            <label className="field"><span>To</span><input type="date" value={custom.to} onChange={(event) => setCustom({ ...custom, to: event.target.value })} /></label>
          </>
        )}
        {!fixed && (
          <label className="field"><span>Property</span>
            <select value={place} onChange={(event) => setPlace(event.target.value)}>
              <option value="">All properties</option>
              {options.properties.map((item) => <option key={item.id} value={item.id}>{item.address}</option>)}
              <option value="none">Company-wide (no property)</option>
            </select>
          </label>
        )}
        <label className="field"><span>Category</span>
          <select value={category} onChange={(event) => setCategory(event.target.value)}>
            <option value="">All categories</option>
            {[...new Set([...options.categories, ...(category ? [category] : [])])].map((item) => <option key={item}>{item}</option>)}
          </select>
        </label>
        <label className="field"><span>Bought by</span>
          <select value={buyerId} onChange={(event) => setBuyerId(event.target.value)}>
            <option value="">Everyone</option>
            {options.buyers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
          </select>
        </label>
        <label className="field"><span>Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">All statuses</option>
            <option value="approved">Approved</option>
            <option value="pending">Waiting for approval</option>
          </select>
        </label>
        <label className="field tracking-search"><span>Search</span><input value={typed} onChange={(event) => setTyped(event.target.value)} placeholder="Store, item…" /></label>
        {filtered && <button type="button" className="tool tracking-clear" onClick={() => { setPreset("all"); setStatus("all"); setCategory(""); setBuyerId(""); setPlace(""); setTyped(""); setQ("") }}>Clear filters</button>}
      </div>

      <div className="tracking-stats">
        <article><span>Total</span><b>{dollars(totals.total)}</b><small>{totals.count} {totals.count === 1 ? "item" : "items"}{totals.receipts ? ` · ${totals.receipts} ${totals.receipts === 1 ? "receipt" : "receipts"}` : ""}</small></article>
        <article><span>Approved</span><b>{dollars(totals.approved)}</b><small>On the books</small></article>
        <article><span>Waiting for approval</span><b>{dollars(totals.pending)}</b><small>Submitted, not yet approved</small></article>
        <div className="tracking-export">
          {action}
          <span className="tracking-export-label">Export</span>
          <a className="tool" href={`/api/expenses/tracking/export?format=xlsx${exportQuery}`} data-name="expenses.xlsx">Excel</a>
          <a className="tool" href={`/api/expenses/tracking/export?format=csv${exportQuery}`} data-name="expenses.csv">CSV</a>
          <details className="tracking-qb" ref={qbRef}>
            <summary className="tool">QuickBooks</summary>
            <div className="tracking-qb-pop">
              <p>Journal entries for QuickBooks Online: Settings › Import data › Journal entries. Approved costs only, one entry per receipt and property, each item debited to the expense account and the total credited to the account it was paid from. Accounts must already be in your chart of accounts. Map Name and Class only if those vendors and classes exist in QuickBooks.</p>
              <label className="field"><span>Expense account</span><input value={accounts.account} disabled={accounts.useCategory} onChange={(event) => saveAccounts({ ...accounts, account: event.target.value })} /></label>
              <label className="field-check keep-case"><input type="checkbox" checked={accounts.useCategory} onChange={(event) => saveAccounts({ ...accounts, useCategory: event.target.checked })} /> Use each item's category as the account</label>
              <label className="field"><span>Paid from account</span><input value={accounts.paidFrom} onChange={(event) => saveAccounts({ ...accounts, paidFrom: event.target.value })} /></label>
              <a className="primary" href={`/api/expenses/tracking/export?format=quickbooks${exportQuery}&${qbQuery}`} data-name="quickbooks-journal.csv">Download for QuickBooks</a>
            </div>
          </details>
          {photoCount > 0 && photoCount <= 1000 && <a className="tool" href={`/api/expenses/tracking/receipts?${query}`} data-name="receipts.zip">Receipt photos ({photoCount})</a>}
          {photoCount > 1000 && <span className="tracking-export-note">{photoCount} receipt photos: choose fewer dates to download them</span>}
        </div>
      </div>

      {data.error && <p className="banner">{data.error}</p>}
      {!result && !data.error && <p className="tracking-empty"><span className="spinner tw:animate-spin" /> Loading expenses…</p>}

      {result && !fixed && result.byProperty.length > 0 && (
        <div className="panel tracking-card">
          <h3>By property</h3>
          <table className="tracking-table tracking-totals">
            <thead><tr><th>Property</th><th>Approved</th><th>Waiting</th><th>Total</th><th>Items</th></tr></thead>
            <tbody>
              {result.byProperty.map((entry) => (
                <tr key={entry.propertyId || "none"} className={entry.propertyId ? "is-link" : ""} onClick={() => entry.propertyId && setPlace(entry.propertyId)} title={entry.propertyId ? "Show only this property" : undefined}>
                  <td data-label="Property">{entry.property}</td>
                  <td data-label="Approved">{dollars(entry.approved)}</td>
                  <td data-label="Waiting">{dollars(entry.pending)}</td>
                  <td data-label="Total"><b>{dollars(entry.total)}</b></td>
                  <td data-label="Items">{entry.count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {result && result.byCategory.length > 0 && (
        <div className="panel tracking-card">
          <h3>By category</h3>
          <ul className="tracking-bars">
            {result.byCategory.map((entry) => (
              <li key={entry.category}>
                <button type="button" onClick={() => setCategory(category === entry.category ? "" : entry.category)} className={category === entry.category ? "is-on" : ""}>
                  <span>{entry.category}</span>
                  <i style={{ width: `${Math.max(2, Math.round((Math.abs(entry.total) / maxCategory) * 100))}%` }} />
                  <b>{dollars(entry.total)}</b>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {result && (
        <div className="panel tracking-card">
          <h3>Items</h3>
          {rows.length === 0 ? (
            <p className="tracking-empty">{filtered ? "Nothing matches these filters." : "No expenses yet. Receipts and costs filed on " + (fixed ? "this property" : "your properties") + " show up here."}</p>
          ) : (
            <table className="tracking-table tracking-items">
              <thead>
                <tr><th>Date</th>{!fixed && <th>Property</th>}<th>Store</th><th>Item</th><th>Category</th><th>Bought by</th><th>Amount</th><th>Status</th><th>Receipt</th></tr>
              </thead>
              <tbody>
                {rows.slice(0, shown).map((row) => {
                  const file = row.fileIds?.[0]
                  const url = file ? row.proofUrls?.[file] || `/api/documents/${file}/raw` : ""
                  return (
                    <tr key={row.id}>
                      <td data-label="Date">{shortDate(row.date)}</td>
                      {!fixed && <td data-label="Property">{row.property}</td>}
                      <td data-label="Store">{row.vendor || "—"}</td>
                      <td data-label="Item" className="tracking-item">{row.description}</td>
                      <td data-label="Category">{row.category}</td>
                      <td data-label="Bought by">{row.buyer || "—"}</td>
                      <td data-label="Amount" className="tracking-amount">{dollars(row.amount)}</td>
                      <td data-label="Status"><StatusPill>{row.status}</StatusPill></td>
                      <td data-label="Receipt">{url ? <ReceiptThumb url={url} label={`Receipt for ${row.description}`} /> : "—"}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
          {rows.length > shown && <button type="button" className="tool tracking-more" onClick={() => setShown((count) => count + PAGE)}>Show {Math.min(PAGE, rows.length - shown)} more of {rows.length - shown}</button>}
        </div>
      )}
    </section>
  )
}

function ReceiptThumb({ url, label }) {
  const [failed, setFailed] = useState(false)
  return (
    <a className="tracking-thumb" href={url} target="_blank" rel="noreferrer" aria-label={label}>
      {failed ? <span>Open</span> : <img src={url} alt="" loading="lazy" onError={() => setFailed(true)} />}
    </a>
  )
}
