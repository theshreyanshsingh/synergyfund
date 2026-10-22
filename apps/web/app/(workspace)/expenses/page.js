"use client"

import { useEffect, useRef, useState } from "react"
import { useSearchParams } from "next/navigation"
import { can, EXPENSE_CATEGORIES, PAYING_ENTITIES, RECEIPT_CATEGORIES, SALES_TAX, fromCents, toCents } from "@synergifund/shared"
import { FormSheet, InfoSheet } from "../../../components/ui/FormSheet"
import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { dollars, money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"
import { CameraCapture } from "../../../components/photos/CameraCapture"
import { ReceiptSheet } from "../../../components/receipts/ReceiptSheet"
import { ExpenseTracking } from "../../../components/expenses/ExpenseTracking"

export default function ExpensesPage() {
  const session = useSession()
  const list = useApi("/expenses")
  const properties = useApi("/properties")
  const [open, setOpen] = useState(false)
  const [error, setError] = useState("")
  const [propertyId, setPropertyId] = useState("")
  const [selected, setSelected] = useState(null)
  const [busyId, setBusyId] = useState("")
  const deciding = useRef(false)
  const [proofs, setProofs] = useState([])
  const camera = session?.user?.role === "contractor"
  const canSubmit = session?.user && can(session.user, "expenses.submit")
  const canApprove = session?.user && can(session.user, "expenses.approve")
  const canReapply = (row) => row.book === "Request" && row.status === "Rejected" && session?.user?.role === "contractor" && row.requestedBy === session?.user?.id
  const canFile = Boolean(canSubmit || canApprove)
  const receipts = useApi(canFile ? "/receipts" : null)
  const [receipt, setReceipt] = useState(null)
  const [filed, setFiled] = useState("")
  const [trackingVersion, setTrackingVersion] = useState(0)
  const search = useSearchParams()
  const staff = Boolean(session?.user && session.user.role !== "contractor")
  const [tab, setTab] = useState("requests")
  useEffect(() => {
    if (search.get("tab") === "tracking" && staff) setTab("tracking")
    if (search.get("receipt") === "new" && canFile) setReceipt({ draft: null })
  }, [staff, canFile])
  function chooseTab(next) {
    setTab(next)
    const url = new URL(window.location.href)
    url.searchParams.set("tab", next)
    window.history.replaceState(null, "", url)
  }
  const drafts = receipts.data?.drafts || []
  const receiptProps = {
    properties: (properties.data?.items || []).map((property) => ({ id: property.id, address: property.address })),
    buyers: receipts.data?.buyers || [],
    posts: Boolean(receipts.data?.posts),
    readingAvailable: receipts.data?.readingAvailable !== false,
  }
  function onFiled(result) {
    setReceipt(null)
    const parts = result.filed.map((part) => `${part.address} (${dollars(part.totalCents / 100)})`)
    setFiled(`${result.posted ? "Posted to" : "Sent for approval on"} ${parts.join(" and ")}.`)
    list.reload()
    receipts.reload()
    setTrackingVersion((value) => value + 1)
  }
  const requests = list.data?.requests || []
  const posted = list.data?.expenses || []
  const postedRequestIds = new Set(posted.map((item) => item.requestId).filter(Boolean))
  const visibleRequests = requests.filter((item) => item.status !== "Approved" || !postedRequestIds.has(item.id))
  const rows = [
    ...visibleRequests.map((item) => ({ ...item, book: "Request" })),
    ...posted.map((item) => ({ ...item, book: "Posted", status: item.reapplied ? "Reapplied" : "Approved" })),
  ]
  const names = new Map((properties.data?.items || []).map((property) => [property.id, property.address]))

  async function submit(event) {
    event.preventDefault()
    const form = new FormData(event.currentTarget)
    setError("")
    if (camera) {
      if (!proofs.length) {
        setError("Take at least one photo with the camera.")
        return
      }
      for (const shot of proofs) form.append("proof", shot.file, shot.file.name)
    }
    try {
      await api("/expenses", { method: "POST", body: form })
      for (const shot of proofs) URL.revokeObjectURL(shot.url)
      setProofs([])
      setOpen(false)
      list.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  // One decision at a time, so a double click cannot approve twice.
  async function decide(id, action, confirmOverBudget = false) {
    if (deciding.current && !confirmOverBudget) return
    deciding.current = true
    setBusyId(id)
    try {
      await api(`/expenses/${id}/decision`, { method: "POST", body: { action, confirmOverBudget } })
      list.reload()
    } catch (err) {
      if (err.status === 409 && window.confirm(`${err.message}\n\nApprove above the rehab budget?`)) {
        await decide(id, action, true)
        return
      }
      window.alert(err.message)
    } finally {
      if (!confirmOverBudget) {
        deciding.current = false
        setBusyId("")
      }
    }
  }

  async function reapply(row) {
    try {
      const result = await api(`/expenses/${row.id}/reapply`, { method: "POST", body: {} })
      setSelected({ ...row, ...result.request, book: "Request" })
      await list.reload()
    } catch (err) {
      window.alert(err.message)
    }
  }

  return (
    <>
      <WorkspacePage
        views={false}
        loading={!list.data && !list.error}
        title="Expenses"
        underTitle={staff ? (
          <div className="property-switch expenses-tabs" role="tablist" aria-label="Expenses views">
            <button type="button" role="tab" aria-selected={tab === "requests"} className={tab === "requests" ? "is-on" : ""} onClick={() => chooseTab("requests")}>Requests and costs</button>
            <button type="button" role="tab" aria-selected={tab === "tracking"} className={tab === "tracking" ? "is-on" : ""} onClick={() => chooseTab("tracking")}>Expense tracking</button>
          </div>
        ) : null}
        action={canFile ? { label: canApprove ? "Add receipt" : "Scan receipt", onClick: () => { setFiled(""); setReceipt({ draft: null }) } } : null}
        secondary={canSubmit && !camera ? { label: "Add expense", onClick: () => setOpen(true) } : null}
        lead={(filed || drafts.length > 0 || camera) ? (
          <div className="receipt-lead">
            {filed && <p className="settings-note receipt-filed">{filed}</p>}
            {drafts.length > 0 && (
              <div className="panel receipt-drafts">
                <h3>Receipts you started</h3>
                <ul>
                  {drafts.map((draft) => (
                    <li key={draft.id}>
                      <span>
                        <strong>{draft.vendor || "Receipt"}{draft.date ? ` · ${new Date(`${draft.date}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</strong>
                        <small>{draft.read.status === "reading" ? "Reading…" : `${draft.items.length} ${draft.items.length === 1 ? "item" : "items"} · not filed yet`}</small>
                      </span>
                      <button type="button" className="tool" onClick={() => { setFiled(""); setReceipt({ draft }) }}>Continue</button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {camera && canSubmit && <p className="receipt-manual">No receipt? <button type="button" className="keep-case" onClick={() => setOpen(true)}>Add an expense by hand</button></p>}
          </div>
        ) : null}
        stats={tab === "tracking" && staff ? [] : camera ? [
          { label: "Your requests", value: String(visibleRequests.length), hint: "Waiting for a decision" },
          { label: "Posted", value: String(posted.length), hint: "Approved costs you filed" },
        ] : [
          { label: "Requests", value: String(visibleRequests.length), hint: "Waiting and closed" },
          { label: "Posted", value: String(posted.length), hint: "On the property books" },
          { label: "Materials pending", value: String(visibleRequests.filter((item) => item.category === "Materials" && !["Approved", "Rejected"].includes(item.status)).length), hint: "Not yet accounted for" },
          { label: "Posted spend", value: money(posted.reduce((sum, item) => sum + Number(item.amount || 0), 0)), hint: "Approved expenses" },
          { label: "Unassigned", value: String(posted.filter((item) => !item.propertyId && item.category === "Materials").length), hint: "Materials without a property" },
        ]}
        columns={[
          { key: "title", label: "Name", avatar: (row) => row.title, render: (row) => row.title },
          { key: "book", label: "Book" },
          { key: "vendor", label: "Vendor" },
          { key: "property", label: "Property", render: (row) => names.get(row.propertyId) || "Company" },
          { key: "amount", label: "Amount", render: (row) => dollars(row.amount) },
          { key: "status", label: "Status", render: (row) => <StatusPill>{row.status}</StatusPill> },
          { key: "actions", label: "", pin: "right", render: (row) => (
            <span className="row-actions">
              <button type="button" onClick={(event) => { event.stopPropagation(); setSelected(row) }}>Open</button>
              {canReapply(row) && <button type="button" onClick={(event) => { event.stopPropagation(); reapply(row) }}>Reapply</button>}
              {canApprove && row.book === "Request" && !["Approved", "Rejected"].includes(row.status) && (
                <>
                  <button type="button" disabled={busyId === row.id} onClick={(event) => { event.stopPropagation(); decide(row.id, "approve") }}>Approve</button>
                  <button type="button" disabled={busyId === row.id} onClick={(event) => { event.stopPropagation(); decide(row.id, "reject") }}>Reject</button>
                </>
              )}
            </span>
          ) },
        ]}
        rows={rows}
        onRow={setSelected}
        important={(row) => ["Submitted", "Needs information", "Needs second approval"].includes(row.status)}
      >
        {tab === "tracking" && staff ? <ExpenseTracking version={trackingVersion} /> : null}
      </WorkspacePage>
      {receipt && (
        <ReceiptSheet
          draft={receipt.draft}
          {...receiptProps}
          onClose={() => { setReceipt(null); receipts.reload() }}
          onChanged={() => receipts.reload()}
          onFiled={onFiled}
        />
      )}
      {selected && (
        <ExpenseSheet
          item={selected}
          properties={properties.data?.items || []}
          canEdit={selected.book === "Request" && !["Approved", "Rejected"].includes(selected.status) && session?.user?.role === "contractor" && selected.requestedBy === session?.user?.id}
          canApprove={canApprove && selected.book === "Request" && !["Approved", "Rejected"].includes(selected.status)}
          canReapply={canReapply(selected)}
          camera={camera}
          onClose={() => setSelected(null)}
          onSaved={async (request) => {
            setSelected({ ...request, book: "Request" })
            await list.reload()
            setSelected(null)
          }}
          busy={busyId === selected.id}
          onDecide={async (action) => { await decide(selected.id, action); setSelected(null) }}
          onReapply={() => reapply(selected)}
        />
      )}
      {open && (
        <FormSheet eyebrow="Expenses" title="Add an expense" hint="Proof is required. An admin posts it onto the property after approval." onClose={() => setOpen(false)} onSubmit={submit} submitLabel="Submit request" error={error}>
          <div className="form-grid">
            <label className="field wide"><span>Description</span><input name="title" required /></label>
            <label className="field"><span>Amount</span><input name="amount" type="number" min="0" step="0.01" required /></label>
            <label className="field"><span>Date</span><input name="date" type="date" required /></label>
            <label className="field"><span>Vendor</span><input name="vendor" /></label>
            <label className="field"><span>Category</span><select name="category">{EXPENSE_CATEGORIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>Paying entity</span><select name="entity">{PAYING_ENTITIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field wide"><span>Property</span><select name="propertyId" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}><option value="">Company / unassigned</option>{(properties.data?.items || []).map((property) => <option key={property.id} value={property.id}>{property.address}</option>)}</select></label>
            <label className="field wide"><span>Part of the house</span>
              <select name="scopeLineId">
                <option value="">Whole property</option>
                {((properties.data?.items || []).find((property) => property.id === propertyId)?.scopeLines || []).map((line) => <option key={line._id} value={line._id}>{line.title}</option>)}
              </select>
            </label>
            <label className="field"><span>Margin</span><select name="costTreatment"><option>Include in construction margin</option><option>Exclude from construction margin</option></select></label>
            <label className="field wide"><span>Proof photos</span>{camera ? <CameraCapture shots={proofs} onChange={setProofs} max={12} /> : <input name="proof" type="file" accept="image/*" multiple required />}</label>
          </div>
        </FormSheet>
      )}
    </>
  )
}

function proofIds(item) {
  const ids = [...(item.proofFileIds || [])]
  if (item.proofFileId && !ids.includes(item.proofFileId)) ids.unshift(item.proofFileId)
  return ids
}

function ExpenseSheet({ item, properties, canEdit, canApprove, canReapply, camera, busy, onClose, onSaved, onDecide, onReapply }) {
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const [removed, setRemoved] = useState([])
  const [proofs, setProofs] = useState([])
  const itemized = (item.lines || []).length > 0
  const [lines, setLines] = useState(() => (item.lines || []).map((entry) => ({ ...entry, amount: Number(entry.amount).toFixed(2) })))
  const photos = proofIds(item).filter((id) => !removed.includes(id))
  const property = properties.find((entry) => entry.id === item.propertyId)
  const line = (property?.scopeLines || []).find((entry) => String(entry._id) === item.scopeLineId)
  const linesCents = lines.reduce((total, entry) => total + (toCents(entry.amount) || 0), 0)
  const linesTable = itemized && (
    <table className="sow-table receipt-lines">
      <thead><tr><th>Item</th><th>Category</th><th>Amount</th></tr></thead>
      <tbody>
        {item.lines.map((entry, index) => (
          <tr key={index}><td>{entry.description}</td><td>{entry.category}</td><td>{dollars(entry.amount)}</td></tr>
        ))}
      </tbody>
      <tfoot><tr><td colSpan="2">Total</td><td>{dollars(item.amount)}</td></tr></tfoot>
    </table>
  )

  async function save(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const body = new FormData(event.currentTarget)
      if (itemized) body.set("lines", JSON.stringify(lines))
      for (const shot of proofs) body.append("proof", shot.file, shot.file.name)
      const result = await api(`/expenses/${item.id}`, { method: "PATCH", body })
      await onSaved(result.request)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  const photosBlock = (
    <div className="property-photos">
      {photos.map((id) => (
        <div key={id} className="proof-tile">
          <a href={item.proofUrls?.[id] || `/api/documents/${id}/raw`} target="_blank" rel="noreferrer">
            <img src={item.proofUrls?.[id] || `/api/documents/${id}/raw`} alt="Proof" />
          </a>
          {canEdit && !item.receiptId && <button type="button" onClick={() => setRemoved((current) => [...current, id])}>Remove</button>}
        </div>
      ))}
      {photos.length === 0 && <p className="property-missing">No proof photo was attached.</p>}
      {item.receiptId && <p className="property-missing receipt-kept">The original receipt stays with this expense.</p>}
    </div>
  )

  if (!canEdit) {
    return (
      <InfoSheet eyebrow="Expenses" title={<span className="keep-case">{item.title}</span>} hint={`${item.book} · ${property?.address || "Company"}`} onClose={onClose}>
        {photosBlock}
        {linesTable}
        <dl className="property-facts">
          <div><dt>Amount</dt><dd>{dollars(item.amount)}</dd></div>
          {item.receiptId && item.book === "Posted" && <div><dt>Category</dt><dd>{item.category}</dd></div>}
          <div><dt>Status</dt><dd>{item.status}</dd></div>
          <div><dt>Vendor</dt><dd>{item.vendor || "Not entered"}</dd></div>
          <div><dt>Part of the house</dt><dd>{line?.title || "Whole property"}</dd></div>
          {item.note && <div className="wide"><dt>Note</dt><dd>{item.note}</dd></div>}
          {item.reviewNote && <div className="wide"><dt>Review</dt><dd>{item.reviewNote}</dd></div>}
        </dl>
        {canReapply && (
          <div className="row-actions" style={{ marginTop: 16 }}>
            <button type="button" onClick={onReapply}>Reapply</button>
          </div>
        )}
        {canApprove && (
          <div className="row-actions" style={{ marginTop: 16 }}>
            <button type="button" disabled={busy} onClick={() => onDecide("approve")}>Approve</button>
            <button type="button" disabled={busy} onClick={() => onDecide("reject")}>Reject</button>
          </div>
        )}
      </InfoSheet>
    )
  }

  return (
    <FormSheet eyebrow="Expenses" title={<span className="keep-case">{item.title}</span>} hint="Save sends this request back for review. You can still change the photos until it is approved or rejected." onClose={onClose} onSubmit={save} submitLabel="Save changes" pending={pending} error={error}>
      {photosBlock}
      <div className="form-grid">
        {removed.map((id) => <input key={id} type="hidden" name="removeProof" value={id} />)}
        <label className="field wide"><span>Description</span><input name="title" defaultValue={item.title} required /></label>
        {itemized ? (
          <div className="field wide receipt-line-editor">
            <span>Items on this receipt</span>
            {lines.map((entry, index) => (
              <div key={index} className="receipt-line-edit">
                <input value={entry.description} onChange={(event) => setLines(lines.map((other, at) => (at === index ? { ...other, description: event.target.value } : other)))} aria-label={`Item ${index + 1}`} disabled={entry.kind === "tax"} />
                {entry.kind === "tax" ? <span className="receipt-line-tax">{SALES_TAX}</span> : (
                  <select value={entry.category} onChange={(event) => setLines(lines.map((other, at) => (at === index ? { ...other, category: event.target.value } : other)))} aria-label={`Category of item ${index + 1}`}>
                    {RECEIPT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
                  </select>
                )}
                <input inputMode="decimal" value={entry.amount} onChange={(event) => setLines(lines.map((other, at) => (at === index ? { ...other, amount: event.target.value } : other)))} aria-label={`Amount of item ${index + 1}`} />
                {lines.length > 1 ? <button type="button" onClick={() => setLines(lines.filter((_, at) => at !== index))} aria-label={`Remove item ${index + 1}`}>×</button> : <span />}
              </div>
            ))}
            <em>Total {dollars(fromCents(linesCents))}</em>
          </div>
        ) : (
          <label className="field"><span>Amount</span><input name="amount" type="number" min="0.01" step="0.01" defaultValue={item.amount} required /></label>
        )}
        <label className="field"><span>Vendor</span><input name="vendor" defaultValue={item.vendor || ""} /></label>
        <label className="field wide"><span>Note</span><input name="note" defaultValue={item.note || ""} /></label>
        <label className="field wide"><span>Add or replace proof photos</span>{camera ? <CameraCapture shots={proofs} onChange={setProofs} max={12} /> : <input name="proof" type="file" accept="image/*" multiple />}</label>
      </div>
    </FormSheet>
  )
}
