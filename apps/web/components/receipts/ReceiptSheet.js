"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { PAYING_ENTITIES, RECEIPT_CATEGORIES, SALES_TAX, receiptPlan, shareOut, toCents } from "@synergifund/shared"
import { api, uploadForm } from "../../lib/api"
import { dollars } from "../../lib/format"
import { CameraCapture, prepareFile } from "../photos/CameraCapture"

// A receipt from photo to filed costs: take (or upload) the photo, the AI reads it, the buyer checks the items, picks
// the property (one tap) or splits it between several, and submits. The draft is saved as they go, so closing the app
// loses nothing; it waits under "Receipts you started" on the Expenses page.

const MAX_FILES = 6
const SEARCH_AT = 9
const SPLIT = "__split"

let counter = 0
function key() {
  counter += 1
  return `item-${Date.now()}-${counter}`
}

function today() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function amountText(value) {
  return value == null || value === "" ? "" : Number(value).toFixed(2)
}

function blankItem() {
  return { key: key(), description: "", category: "Other", amount: "", propertyId: "", split: null }
}

// known: the properties this person can file on now (a saved draft may name one they no longer have).
function formFrom(receipt, preset, known) {
  const saved = (receipt.propertyIds || []).filter((id) => known[id])
  const propertyIds = saved.length ? saved : preset
  return {
    vendor: receipt.vendor || "",
    date: receipt.date || today(),
    tax: amountText(receipt.tax),
    entity: receipt.entity || "Construction company",
    note: receipt.note || "",
    boughtBy: receipt.boughtBy && receipt.boughtBy !== receipt.createdBy ? receipt.boughtBy : "",
    propertyIds,
    splitting: propertyIds.length > 1,
    items: (receipt.items || []).length
      ? receipt.items.map((item) => ({ key: key(), description: item.description || "", category: item.category || "Other", amount: amountText(item.amount), propertyId: item.propertyId || "", split: item.split ? { mode: item.split.mode, parts: item.split.parts.map((part) => ({ propertyId: part.propertyId, value: part.value })) } : null }))
      : [blankItem()],
  }
}

// What is sent to the server (and checked here the same way): with one property, every item goes to it.
function bodyOf(form) {
  const several = form.propertyIds.length > 1
  return {
    vendor: form.vendor,
    date: form.date,
    tax: form.tax,
    entity: form.entity,
    note: form.note,
    boughtBy: form.boughtBy,
    propertyIds: form.propertyIds,
    items: form.items.map((item) => ({
      description: item.description,
      category: item.category,
      amount: item.amount,
      propertyId: several && form.propertyIds.includes(item.propertyId) ? item.propertyId : "",
      split: several && item.split ? { mode: item.split.mode, parts: form.propertyIds.map((id) => ({ propertyId: id, value: item.split.parts.find((part) => part.propertyId === id)?.value ?? "" })) } : null,
    })),
  }
}

function evenParts(ids) {
  const shares = shareOut(10000, ids.map(() => 1))
  return ids.map((id, index) => ({ propertyId: id, value: (shares[index] / 100).toFixed(2).replace(/\.00$/, "") }))
}

export function ReceiptSheet({ draft = null, properties = [], buyers = [], posts = false, readingAvailable = true, defaultPropertyId = "", onClose, onFiled, onChanged }) {
  const names = useMemo(() => Object.fromEntries(properties.map((property) => [property.id, property.address])), [properties])
  const preset = useMemo(() => {
    if (defaultPropertyId && names[defaultPropertyId]) return [defaultPropertyId]
    return properties.length === 1 ? [properties[0].id] : []
  }, [defaultPropertyId, names, properties])
  const [receipt, setReceipt] = useState(draft)
  const [stage, setStage] = useState(draft ? (draft.read?.status === "reading" ? "reading" : "review") : "capture")
  const [shots, setShots] = useState([])
  const [form, setForm] = useState(() => (draft && draft.read?.status !== "reading" ? formFrom(draft, preset, names) : null))
  const [error, setError] = useState("")
  const [progress, setProgress] = useState(null)
  const [pending, setPending] = useState(false)
  const [tried, setTried] = useState(false)
  const [search, setSearch] = useState("")
  const [slow, setSlow] = useState(false)
  const saved = useRef("")
  const timer = useRef(null)
  const saving = useRef(null)
  const pickRef = useRef(null)

  const plan = useMemo(() => (form ? receiptPlan({ ...bodyOf(form), names }) : null), [form, names])

  // While the AI reads: check every second or so until it is done.
  useEffect(() => {
    if (stage !== "reading" || !receipt?.id) return
    let stopped = false
    const started = Date.now()
    const tick = async () => {
      if (stopped) return
      try {
        const data = await api(`/receipts/${receipt.id}`)
        if (stopped) return
        if (data.receipt.read.status !== "reading") {
          setReceipt(data.receipt)
          const next = formFrom(data.receipt, preset, names)
          saved.current = JSON.stringify(bodyOf(next))
          setForm(next)
          setStage("review")
          onChanged?.()
          return
        }
      } catch {}
      if (Date.now() - started > 45000) setSlow(true)
      setTimeout(tick, 1200)
    }
    const first = setTimeout(tick, 900)
    return () => {
      stopped = true
      clearTimeout(first)
    }
  }, [stage, receipt?.id])

  // The draft is saved a moment after each change.
  useEffect(() => {
    if (stage !== "review" || !form || !receipt?.id) return
    const body = JSON.stringify(bodyOf(form))
    if (body === saved.current) return
    clearTimeout(timer.current)
    timer.current = setTimeout(() => save(body), 1200)
    return () => clearTimeout(timer.current)
  }, [form, stage, receipt?.id])

  async function save(body = JSON.stringify(bodyOf(form))) {
    if (!receipt?.id || body === saved.current) return
    const run = api(`/receipts/${receipt.id}`, { method: "PUT", body }).then(() => {
      saved.current = body
    }).catch(() => {})
    saving.current = run
    await run
  }

  async function flush() {
    clearTimeout(timer.current)
    await saving.current
    if (form && stage === "review") await save()
  }

  async function close() {
    if (stage === "review") await flush()
    for (const shot of shots) if (shot.url) URL.revokeObjectURL(shot.url)
    onClose()
  }

  async function addFiles(event) {
    const files = [...(event.target.files || [])]
    event.target.value = ""
    const room = Math.max(0, MAX_FILES - shots.length)
    const ready = []
    for (const file of files.slice(0, room)) ready.push(await prepareFile(file))
    setShots((current) => [...current, ...ready])
  }

  async function upload() {
    if (!shots.length) {
      setError("Take a photo of the receipt, or choose a photo or PDF.")
      return
    }
    setError("")
    setPending(true)
    setProgress(0)
    try {
      const body = new FormData()
      for (const shot of shots) body.append("files", shot.file, shot.file.name)
      const data = await uploadForm("/receipts", body, setProgress)
      for (const shot of shots) if (shot.url) URL.revokeObjectURL(shot.url)
      setShots([])
      setReceipt(data.receipt)
      onChanged?.()
      if (data.receipt.read.status === "reading") setStage("reading")
      else {
        const next = formFrom(data.receipt, preset, names)
        saved.current = JSON.stringify(bodyOf(next))
        setForm(next)
        setStage("review")
      }
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
      setProgress(null)
    }
  }

  async function typeItIn() {
    try {
      const data = await api(`/receipts/${receipt.id}`, { method: "PUT", body: { stopReading: true } })
      setReceipt(data.receipt)
      const next = formFrom(data.receipt, preset, names)
      saved.current = JSON.stringify(bodyOf(next))
      setForm(next)
      setStage("review")
    } catch (err) {
      setError(err.message)
    }
  }

  async function readAgain() {
    const typed = form?.items.some((item) => item.description || item.amount)
    if (typed && !window.confirm("Read the receipt again? The items below are replaced by what the AI reads.")) return
    setError("")
    try {
      await flush()
      const data = await api(`/receipts/${receipt.id}/read`, { method: "POST", body: {} })
      setReceipt(data.receipt)
      setSlow(false)
      setStage("reading")
    } catch (err) {
      setError(err.message)
    }
  }

  async function discard() {
    if (!window.confirm("Throw this receipt away? Its photo is deleted too.")) return
    clearTimeout(timer.current)
    try {
      await api(`/receipts/${receipt.id}`, { method: "DELETE" })
      onChanged?.()
      onClose()
    } catch (err) {
      setError(err.message)
    }
  }

  async function submit(event, confirmDuplicate = false) {
    event?.preventDefault?.()
    if (pending) return
    setTried(true)
    setError("")
    if (!form.vendor.trim()) return setError("Enter the store or vendor.")
    if (!form.date) return setError("Enter the date on the receipt.")
    if (plan.errors.length) return setError(plan.errors[0])
    const printed = toCents(receipt?.printedTotal)
    if (!confirmDuplicate && printed && Math.abs(printed - plan.totalCents) > 1 && !window.confirm(`The items and tax add up to ${dollars(plan.totalCents / 100)}, but the receipt's total is ${dollars(printed / 100)}.\n\nSubmit anyway?`)) return
    setPending(true)
    try {
      clearTimeout(timer.current)
      await saving.current
      const data = await api(`/receipts/${receipt.id}/submit`, { method: "POST", body: { ...bodyOf(form), confirmDuplicate } })
      saved.current = ""
      onChanged?.()
      onFiled?.(data)
    } catch (err) {
      if (err.status === 409 && /already filed/.test(err.message) && window.confirm(`${err.message}\n\nSubmit it anyway?`)) {
        setPending(false)
        await submit(null, true)
        return
      }
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  const update = (patch) => {
    setError("")
    setForm((current) => ({ ...current, ...patch }))
  }
  const updateItem = (index, patch) => {
    setError("")
    setForm((current) => ({ ...current, items: current.items.map((item, at) => (at === index ? { ...item, ...patch } : item)) }))
  }

  function choose(id) {
    setError("")
    setForm((current) => {
      if (!current.splitting) return { ...current, propertyIds: [id] }
      const has = current.propertyIds.includes(id)
      return { ...current, propertyIds: has ? current.propertyIds.filter((item) => item !== id) : [...current.propertyIds, id] }
    })
  }

  function setSplitting(on) {
    setForm((current) => ({ ...current, splitting: on, propertyIds: on ? current.propertyIds : current.propertyIds.slice(0, 1) }))
  }

  const fileIds = receipt?.fileIds || []
  const photos = (
    <div className="receipt-photos">
      {fileIds.map((id, index) => {
        const url = receipt.fileUrls?.[id] || `/api/documents/${id}/raw`
        return (
          <a key={id} href={url} target="_blank" rel="noreferrer" aria-label={`Open receipt photo ${index + 1}`}>
            <img src={url} alt={`Receipt photo ${index + 1}`} onError={(event) => { event.currentTarget.style.visibility = "hidden" }} />
          </a>
        )
      })}
    </div>
  )

  const filtered = properties.filter((property) => !search.trim() || property.address.toLowerCase().includes(search.trim().toLowerCase()))
  const chips = form ? [...form.propertyIds.map((id) => properties.find((property) => property.id === id)).filter(Boolean), ...filtered.filter((property) => !form.propertyIds.includes(property.id))] : []
  const visibleChips = properties.length >= SEARCH_AT ? chips.slice(0, Math.max(SEARCH_AT, form?.propertyIds.length || 0)) : chips
  const several = Boolean(form && form.propertyIds.length > 1)
  const itemsCents = plan?.itemsCents || 0
  const printed = toCents(receipt?.printedTotal)

  return (
    <div className="sheet-backdrop" onMouseDown={close}>
      <form className="member-sheet receipt-sheet" onSubmit={stage === "review" ? submit : (event) => { event.preventDefault(); upload() }} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>{posts ? "Expenses" : "Expense request"}</p>
            <h2>{stage === "capture" ? "Add a receipt" : stage === "reading" ? "Reading the receipt…" : "Check the receipt"}</h2>
            <span>
              {stage === "capture" && "Take a photo of the whole receipt. A long one? Take a few photos, top to bottom."}
              {stage === "reading" && "The AI is reading the store, the items and the tax. This takes a few seconds."}
              {stage === "review" && (posts ? "Check the items, choose the property, and post it to the books." : "Check the items and choose the property. An admin approves it before it goes on the books.")}
            </span>
          </div>
          <button type="button" className="icon-btn" onClick={close} aria-label="Close">×</button>
        </header>

        <div className="member-sheet-body">
          {error && <div className="banner receipt-error">{error}</div>}

          {stage === "capture" && (
            <div className="receipt-capture">
              <CameraCapture shots={shots.filter((shot) => shot.url)} onChange={(next) => setShots((current) => [...next, ...current.filter((shot) => !shot.url)])} max={MAX_FILES} />
              <div className="receipt-or">
                <button type="button" className="photo-pick" onClick={() => pickRef.current?.click()} disabled={shots.length >= MAX_FILES}>Upload a photo or PDF</button>
                <input ref={pickRef} type="file" accept="image/*,.heic,.heif,application/pdf,.pdf" multiple hidden onChange={addFiles} />
              </div>
              {shots.some((shot) => !shot.url) && (
                <ul className="receipt-files">
                  {shots.filter((shot) => !shot.url).map((shot) => (
                    <li key={shot.id}><span>{shot.file.name}</span><button type="button" onClick={() => setShots((current) => current.filter((item) => item.id !== shot.id))}>Remove</button></li>
                  ))}
                </ul>
              )}
              {!readingAvailable && <p className="receipt-hint">Receipt reading is not set up, so you'll type the items in after the photo is saved.</p>}
            </div>
          )}

          {stage === "reading" && (
            <div className="receipt-reading">
              {photos}
              <div className="receipt-reading-status">
                <span className="spinner tw:animate-spin" aria-hidden="true" />
                <span>{slow ? "Still reading. You can wait, or type the items in yourself." : "Reading the receipt…"}</span>
              </div>
              <button type="button" className="tool" onClick={typeItIn}>Type it in myself</button>
            </div>
          )}

          {stage === "review" && form && (
            <div className="receipt-review">
              <div className="receipt-top">
                {photos}
                <div className="receipt-read-note">
                  {receipt.read.status === "done" && <p className="receipt-ok">Read by AI. Check every line before you submit.</p>}
                  {receipt.read.status === "failed" && <p className="receipt-warn">{receipt.read.error}</p>}
                  {receipt.read.status === "unavailable" && <p className="receipt-hint">{receipt.read.error}</p>}
                  {(receipt.read.warnings || []).map((text) => <p key={text} className="receipt-warn">{text}</p>)}
                  {readingAvailable && <button type="button" className="tool" onClick={readAgain}>{receipt.read.status === "done" ? "Read again" : "Read with AI"}</button>}
                </div>
              </div>

              <div className="form-grid">
                <label className="field"><span>Store or vendor</span><input value={form.vendor} onChange={(event) => update({ vendor: event.target.value })} placeholder="The Home Depot" required /></label>
                <label className="field"><span>Date</span><input type="date" value={form.date} onChange={(event) => update({ date: event.target.value })} required /></label>
                {posts && buyers.length > 0 && (
                  <label className="field wide"><span>Bought by</span>
                    <select value={form.boughtBy} onChange={(event) => update({ boughtBy: event.target.value })}>
                      <option value="">Me</option>
                      {buyers.map((person) => <option key={person.id} value={person.id}>{person.name}{person.role === "contractor" ? " · Contractor" : ""}</option>)}
                    </select>
                  </label>
                )}
              </div>

              <section className="receipt-section">
                <div className="receipt-section-head">
                  <h3>{form.splitting ? "Properties" : "Property"}</h3>
                  {properties.length > 1 && (
                    <label className="receipt-switch">
                      <input type="checkbox" checked={form.splitting} onChange={(event) => setSplitting(event.target.checked)} />
                      <span>Split between properties</span>
                    </label>
                  )}
                </div>
                {properties.length === 0 && <p className="receipt-warn">No properties are assigned to you yet. Ask an admin to add you to the houses you work on.</p>}
                {properties.length >= SEARCH_AT && <input className="receipt-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Find a property" aria-label="Find a property" />}
                <div className="receipt-chips" role="group" aria-label="Choose the property">
                  {visibleChips.map((property) => {
                    const on = form.propertyIds.includes(property.id)
                    return (
                      <button key={property.id} type="button" className={on ? "is-on" : ""} aria-pressed={on} onClick={() => choose(property.id)}>
                        {property.address}
                      </button>
                    )
                  })}
                  {chips.length > visibleChips.length && <span className="receipt-more">{chips.length - visibleChips.length} more · type to find one</span>}
                </div>
                {form.splitting && <p className="receipt-hint">Tap every property on this receipt. Items go to the first one unless you choose another, or split an item by amount or percentage.</p>}
              </section>

              <section className="receipt-section">
                <div className="receipt-section-head">
                  <h3>Items</h3>
                  <span className="receipt-count">{form.items.length} {form.items.length === 1 ? "item" : "items"}</span>
                </div>
                <div className={several ? "receipt-items is-split" : "receipt-items"}>
                  <div className="receipt-item receipt-item-head" aria-hidden="true">
                    <span>Item</span><span>Category</span><span>Amount</span>{several && <span>Property</span>}<span />
                  </div>
                  {form.items.map((item, index) => (
                    <ItemRow
                      key={item.key}
                      item={item}
                      index={index}
                      several={several}
                      propertyIds={form.propertyIds}
                      names={names}
                      onChange={(patch) => updateItem(index, patch)}
                      onRemove={() => setForm((current) => ({ ...current, items: current.items.length > 1 ? current.items.filter((_, at) => at !== index) : [blankItem()] }))}
                    />
                  ))}
                </div>
                <button type="button" className="tool receipt-add" onClick={() => setForm((current) => ({ ...current, items: [...current.items, blankItem()] }))}>+ Add item</button>
              </section>

              <section className="receipt-totals">
                <div><span>Items</span><b>{dollars(itemsCents / 100)}</b></div>
                <label><span>Sales tax</span><input inputMode="decimal" value={form.tax} onChange={(event) => update({ tax: event.target.value })} placeholder="0.00" aria-label="Sales tax" /></label>
                <div className="receipt-grand"><span>Total</span><b>{dollars((plan?.totalCents || 0) / 100)}</b></div>
                {printed > 0 && Math.abs(printed - (plan?.totalCents || 0)) > 1 && <p className="receipt-warn">The receipt says {dollars(printed / 100)}. Check the items and the tax.</p>}
              </section>

              {several && plan && plan.properties.length > 0 && (
                <section className="receipt-section">
                  <h3>On each property</h3>
                  <ul className="receipt-split-summary">
                    {plan.properties.map((entry) => (
                      <li key={entry.propertyId}>
                        <span>{names[entry.propertyId]}<small>{entry.count} {entry.count === 1 ? "item" : "items"}{entry.taxCents ? ` + ${dollars(entry.taxCents / 100)} tax` : ""}</small></span>
                        <b>{dollars(entry.totalCents / 100)}</b>
                      </li>
                    ))}
                  </ul>
                </section>
              )}

              {tried && plan?.errors.length > 0 && (
                <ul className="receipt-problems">
                  {plan.errors.map((text) => <li key={text}>{text}</li>)}
                </ul>
              )}

              <details className="receipt-more-details">
                <summary>More details</summary>
                <div className="form-grid">
                  <label className="field"><span>Paid by</span><select value={form.entity} onChange={(event) => update({ entity: event.target.value })}>{PAYING_ENTITIES.map((entity) => <option key={entity}>{entity}</option>)}</select></label>
                  <label className="field wide"><span>Note</span><input value={form.note} onChange={(event) => update({ note: event.target.value })} placeholder="Anything the office should know" /></label>
                </div>
              </details>
            </div>
          )}
        </div>

        <footer>
          {stage === "review" ? (
            <>
              <button type="button" className="danger" onClick={discard}>Discard</button>
              <span className="receipt-footer-actions">
                <button type="button" className="tool" onClick={close}>Save for later</button>
                <button className="primary" type="submit" disabled={pending || !properties.length}>{pending ? "Filing…" : `${posts ? "Post" : "Submit"} ${dollars((plan?.totalCents || 0) / 100)}`}</button>
              </span>
            </>
          ) : stage === "capture" ? (
            <>
              <button type="button" className="tool" onClick={close}>Cancel</button>
              <button className="primary" type="submit" disabled={pending || !shots.length}>{pending ? (progress != null && progress < 1 ? `Uploading ${Math.round(progress * 100)}%` : "Saving…") : readingAvailable ? "Read receipt" : "Continue"}</button>
            </>
          ) : (
            <>
              <button type="button" className="tool" onClick={close}>Close</button>
              <span className="receipt-footer-note">Saved. You can close this and come back.</span>
            </>
          )}
        </footer>
      </form>
    </div>
  )
}

function ItemRow({ item, index, several, propertyIds, names, onChange, onRemove }) {
  const number = index + 1
  const cents = toCents(item.amount)
  const splitting = several && item.split
  const target = splitting ? SPLIT : propertyIds.includes(item.propertyId) ? item.propertyId : propertyIds[0]
  const valueOf = (id) => item.split?.parts.find((part) => part.propertyId === id)?.value ?? ""
  const setValue = (id, value) => {
    const parts = propertyIds.map((propertyId) => ({ propertyId, value: propertyId === id ? value : valueOf(propertyId) }))
    onChange({ split: { ...item.split, parts } })
  }
  let left = null
  let shares = []
  if (splitting && cents && !Number.isNaN(cents)) {
    if (item.split.mode === "percent") {
      const percents = propertyIds.map((id) => Number(String(valueOf(id)).replace(/[%\s]/g, "")) || 0)
      const sum = percents.reduce((total, value) => total + value, 0)
      left = Math.round((100 - sum) * 100) / 100
      shares = Math.abs(sum - 100) <= 0.01 ? shareOut(cents, percents) : percents.map((value) => Math.round((cents * value) / 100))
    } else {
      const amounts = propertyIds.map((id) => toCents(valueOf(id)) || 0)
      left = cents - amounts.reduce((total, value) => total + value, 0)
      shares = amounts
    }
  }
  return (
    <div className={splitting ? "receipt-item has-split" : "receipt-item"}>
      <input className="receipt-desc" value={item.description} onChange={(event) => onChange({ description: event.target.value })} placeholder={`Item ${number}`} aria-label={`Item ${number}`} />
      <select className="receipt-cat" value={item.category === SALES_TAX ? "Other" : item.category} onChange={(event) => onChange({ category: event.target.value })} aria-label={`Category of item ${number}`}>
        {RECEIPT_CATEGORIES.map((category) => <option key={category}>{category}</option>)}
      </select>
      <input className="receipt-amount" inputMode="decimal" value={item.amount} onChange={(event) => onChange({ amount: event.target.value })} placeholder="0.00" aria-label={`Amount of item ${number}`} />
      {several && (
        <select className="receipt-target" value={target} onChange={(event) => {
          const value = event.target.value
          if (value === SPLIT) onChange({ split: { mode: "percent", parts: evenParts(propertyIds) } })
          else onChange({ propertyId: value, split: null })
        }} aria-label={`Property for item ${number}`}>
          {propertyIds.map((id) => <option key={id} value={id}>{names[id]}</option>)}
          <option value={SPLIT}>Split between properties…</option>
        </select>
      )}
      <button type="button" className="receipt-remove" onClick={onRemove} aria-label={`Remove item ${number}`}>×</button>
      {splitting && (
        <div className="receipt-split">
          <div className="receipt-split-head">
            <div className="receipt-mode" role="group" aria-label={`Split item ${number} by`}>
              <button type="button" className={item.split.mode === "percent" ? "is-on" : ""} onClick={() => onChange({ split: { mode: "percent", parts: evenParts(propertyIds) } })}>%</button>
              <button type="button" className={item.split.mode === "amount" ? "is-on" : ""} onClick={() => {
                const each = cents && !Number.isNaN(cents) ? shareOut(cents, propertyIds.map(() => 1)) : propertyIds.map(() => 0)
                onChange({ split: { mode: "amount", parts: propertyIds.map((id, at) => ({ propertyId: id, value: each[at] ? (each[at] / 100).toFixed(2) : "" })) } })
              }}>$</button>
            </div>
            <button type="button" className="tool" onClick={() => onChange({ split: item.split.mode === "percent" ? { mode: "percent", parts: evenParts(propertyIds) } : { mode: "amount", parts: propertyIds.map((id, at) => ({ propertyId: id, value: cents && !Number.isNaN(cents) ? (shareOut(cents, propertyIds.map(() => 1))[at] / 100).toFixed(2) : "" })) } })}>Split evenly</button>
            <button type="button" className="tool" onClick={() => onChange({ split: null })}>Don't split</button>
          </div>
          {propertyIds.map((id, at) => (
            <label key={id} className="receipt-split-row">
              <span>{names[id]}</span>
              <input inputMode="decimal" value={valueOf(id)} onChange={(event) => setValue(id, event.target.value)} aria-label={`${names[id]} ${item.split.mode === "percent" ? "percent" : "amount"} of item ${number}`} placeholder={item.split.mode === "percent" ? "0" : "0.00"} />
              <em>{item.split.mode === "percent" ? "%" : ""}</em>
              <small>{shares[at] != null ? dollars(shares[at] / 100) : ""}</small>
            </label>
          ))}
          {left != null && Math.abs(left) > (item.split.mode === "percent" ? 0.01 : 0) && (
            <p className="receipt-warn">{item.split.mode === "percent" ? `${left > 0 ? `${left}% still to place` : `${-left}% too much`}` : `${left > 0 ? `${dollars(left / 100)} still to place` : `${dollars(-left / 100)} too much`}`}</p>
          )}
        </div>
      )}
    </div>
  )
}
