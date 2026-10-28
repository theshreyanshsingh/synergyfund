"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { PageSpinner } from "../../../components/ui/Spinner"
import { PROPERTY_LABELS, can, cityLine, refinancePlan, STAGES, STRATEGIES } from "@synergifund/shared"
import { DrawImport } from "../../../components/draws/DrawImport"
import { FormSheet } from "../../../components/ui/FormSheet"
import { StateSelect } from "../../../components/properties/StateSelect"
import { StatusPill } from "../../../components/ui/StatusPill"
import { Icon } from "../../../components/ui/Icon"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"
import { useChatEvents } from "../../../lib/chatSocket"

const BLANK_FORM = { address: "", city: "", state: "", zip: "", stage: "Under contract", strategy: "Fix & flip", purchasePrice: "", purchaseDate: "", arv: "", rehabBudget: "", nextAction: "" }

function PropertiesScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const session = useSession()
  const list = useApi("/properties")
  const [open, setOpen] = useState(params.get("new") === "1")
  const [error, setError] = useState("")
  const [form, setForm] = useState(BLANK_FORM)
  const [labels, setLabels] = useState([])
  const [labelDraft, setLabelDraft] = useState("")
  const [assigned, setAssigned] = useState([])
  const [contractors, setContractors] = useState([])
  const importInput = useRef(null)
  const [importBusy, setImportBusy] = useState("")
  const [workbook, setWorkbook] = useState(null)
  const writable = session?.user && can(session.user, "properties.write")
  const canImport = session?.user && can(session.user, "imports.run") && can(session.user, "draws.write")
  const contractor = session?.user?.role === "contractor"
  const canMembers = session?.user && can(session.user, "members.manage")
  const companies = useApi(open && session?.user && !contractor ? "/companies" : null)
  const [companyId, setCompanyId] = useState("")
  const [orderOverride, setOrderOverride] = useState(null)
  const [orderError, setOrderError] = useState("")
  const moving = useRef(false)
  const items = list.data?.items || []
  const rows = orderOverride ? orderOverride.map((id) => items.find((item) => item.id === id)).filter(Boolean) : items

  useChatEvents({
    "properties:reordered": () => {
      if (!moving.current) list.reload()
    },
  }, Boolean(session?.user && can(session.user, "chat.use")))

  async function moveProperties(ids) {
    moving.current = true
    setOrderOverride(ids)
    setOrderError("")
    try {
      await api("/properties/order", { method: "PUT", body: { ids } })
      await list.reload()
    } catch (err) {
      setOrderError(`The new order was not saved. ${err.message}`)
    } finally {
      setOrderOverride(null)
      moving.current = false
    }
  }

  useEffect(() => {
    if (!open || !canMembers) return
    api("/members").then((data) => setContractors((data.items || []).filter((person) => person.role === "contractor"))).catch(() => {})
  }, [open, canMembers])

  function set(key) {
    return (event) => setForm((current) => ({ ...current, [key]: event.target.value }))
  }

  async function save(event) {
    event.preventDefault()
    setError("")
    const body = new FormData(event.currentTarget)
    body.set("labels", JSON.stringify(labelDraft.trim() ? [...labels, labelDraft.trim()] : labels))
    body.set("assignedUserIds", JSON.stringify(assigned))
    try {
      await api("/properties", { method: "POST", body })
      setOpen(false)
      setForm(BLANK_FORM)
      setLabels([])
      setLabelDraft("")
      setAssigned([])
      setCompanyId("")
      list.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  return (
    <>
      <WorkspacePage
        views={false}
        loading={!list.data && !list.error}
        customize={false}
        title="Properties"
        secondary={canImport ? { label: importBusy === "reading" ? "Reading…" : importBusy === "saving" ? "Saving…" : "Import", busy: Boolean(importBusy), disabled: Boolean(importBusy), onClick: () => { if (!importBusy) importInput.current?.click() } } : null}
        action={writable ? { label: "New property", onClick: () => setOpen(true) } : null}
        lead={(
          <>
            {orderError && <p className="banner reorder-error">{orderError}</p>}
            {canImport && (
              <DrawImport
                job={workbook}
                inputRef={importInput}
                onBusy={setImportBusy}
                onOpen={setWorkbook}
                onChange={setWorkbook}
                onReload={list.reload}
              />
            )}
          </>
        )}
        selectable={false}
        compact
        filters={[
          { key: "stage", label: "Status", options: STAGES, value: (row) => row.stage },
          { key: "strategy", label: "Goal", options: STRATEGIES, value: (row) => row.strategy },
          ...(contractor ? [] : [{ key: "company", label: "Company", options: [], value: (row) => row.company }]),
        ]}
        columns={[
          { key: "address", label: "Name", render: (row) => <PropertyName row={row} refinance={!contractor} /> },
          ...(contractor ? [] : [
            { key: "company", label: "Company", render: (row) => row.companyId ? <Link href={`/companies/${row.companyId}`} className="table-link" onClick={(event) => event.stopPropagation()}>{row.company || "Company"}</Link> : <span className="muted-cell">—</span> },
            { key: "rehabBudget", label: "Rehab budget", render: (row) => row.rehabBudget == null ? "—" : money(row.rehabBudget) },
          ]),
          { key: "stage", label: "Status", peek: true, render: (row) => <StatusPill>{row.stage}</StatusPill> },
          ...(contractor ? [] : [
            { key: "nextAction", label: "Next step", render: (row) => row.nextAction || "Set the next action" },
            { key: "strategy", label: "Goal", render: (row) => row.strategy || "Not set" },
            { key: "loanStatus", label: "Loan status", render: (row) => <StatusPill>{row.loanStatus || "No loan"}</StatusPill> },
            { key: "loanBalance", label: "Loan balance", className: "num", render: (row) => row.loanBalance == null ? "—" : money(row.loanBalance) },
          ]),
        ]}
        rows={rows}
        reorder={writable && !contractor ? { onMove: moveProperties } : undefined}
        important={contractor ? undefined : (row) => row.health === "Needs attention" || !row.purchasePrice}
        onRow={(row) => router.push(`/properties/${row.id}`)}
        // Phones: one line per property; a tap shows or folds its details, and Open property opens it.
        collapsible={!contractor}
        openLabel="Open property"
        empty={list.error || "No properties yet."}
      />
      {open && (
        <FormSheet eyebrow="Properties" title="New property" hint="Start with the address. Leave a number blank if you do not have it yet." onClose={() => setOpen(false)} onSubmit={save} submitLabel="Save property" error={error}>
          <div className="form-grid">
            <label className="field wide"><span>Address</span><input name="address" value={form.address} onChange={set("address")} required /></label>
            <label className="field"><span>City</span><input name="city" value={form.city} onChange={set("city")} autoComplete="address-level2" /></label>
            <div className="field place-fields">
              <label className="field"><span>State</span><StateSelect name="state" value={form.state} onChange={(state) => setForm((current) => ({ ...current, state }))} /></label>
              <label className="field"><span>ZIP</span><input name="zip" value={form.zip} onChange={set("zip")} inputMode="numeric" maxLength={10} autoComplete="postal-code" placeholder="Filled in from the address" /></label>
            </div>
            <label className="field"><span>Status</span><select name="stage" value={form.stage} onChange={set("stage")}>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
            <label className="field"><span>Strategy</span><select name="strategy" value={form.strategy} onChange={set("strategy")}>{STRATEGIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            {!contractor && (
              <label className="field"><span>Company</span>
                <select name="companyId" value={companyId} onChange={(event) => setCompanyId(event.target.value)}>
                  <option value="">Not in a company</option>
                  {(companies.data?.items || []).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                </select>
              </label>
            )}
            <label className="field"><span>Purchase price</span><input name="purchasePrice" value={form.purchasePrice} onChange={set("purchasePrice")} /></label>
            <label className="field"><span>Purchase date</span><input name="purchaseDate" type="date" value={form.purchaseDate} onChange={set("purchaseDate")} /></label>
            <label className="field"><span>ARV</span><input name="arv" value={form.arv} onChange={set("arv")} /></label>
            <label className="field"><span>Rehab budget</span><input name="rehabBudget" value={form.rehabBudget} onChange={set("rehabBudget")} /></label>
            <label className="field wide"><span>Next step</span><input name="nextAction" value={form.nextAction} onChange={set("nextAction")} /></label>
            <div className="field wide">
              <span>Labels</span>
              <div className="label-editor">
                {labels.map((label) => <button key={label} type="button" className="label-chip" onClick={() => setLabels((current) => current.filter((item) => item !== label))}>{label} ×</button>)}
                <input value={labelDraft} placeholder="Add a label" onChange={(event) => setLabelDraft(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); const label = labelDraft.trim(); if (label) setLabels((current) => current.some((item) => item.toLowerCase() === label.toLowerCase()) ? current : [...current, label].slice(0, 8)); setLabelDraft("") } }} />
              </div>
              <div className="label-suggestions">
                {PROPERTY_LABELS.filter((label) => !labels.some((item) => item.toLowerCase() === label.toLowerCase())).map((label) => (
                  <button key={label} type="button" onClick={() => setLabels((current) => current.some((item) => item.toLowerCase() === label.toLowerCase()) ? current : [...current, label].slice(0, 8))}>{label}</button>
                ))}
              </div>
            </div>
            {contractors.length > 0 && (
              <div className="field wide">
                <span>Contractors</span>
                <div className="assign-list">
                  {contractors.map((person) => (
                    <label key={person.id}>
                      <input type="checkbox" checked={assigned.includes(person.id)} onChange={() => setAssigned((current) => current.includes(person.id) ? current.filter((id) => id !== person.id) : [...current, person.id])} />
                      {person.name}
                    </label>
                  ))}
                </div>
              </div>
            )}
            <div className="field wide">
              <span>Photos</span>
              <label className="photo-pick">Choose photos<input name="photos" type="file" accept="image/*" multiple /></label>
            </div>
          </div>
        </FormSheet>
      )}
    </>
  )
}

// The name cell: address, and city, state and ZIP. While a refinance is to do (ready to start or in process), a small Refinance tag
// shows on the row, and an opened card on a phone shows a banner under the address that opens the Refinance section.
function PropertyName({ row, refinance }) {
  const plan = refinance ? refinancePlan(row) : null
  return (
    <span className="person-copy property-name">
      <strong>{row.address}{plan?.open && <span className="refi-tag" title={plan.label}>Refinance</span>}</strong>
      <small>{cityLine(row) || "Location not entered"}</small>
      {plan?.open && (
        <Link className="refi-banner" href={`/properties/${row.id}?tab=financing#refinance`} onClick={(event) => event.stopPropagation()}>
          <span>{plan.label}</span>
          <Icon name="chevron" size={14} />
        </Link>
      )}
    </span>
  )
}

export default function PropertiesPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PropertiesScreen />
    </Suspense>
  )
}
