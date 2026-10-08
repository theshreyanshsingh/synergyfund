"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { PageSpinner } from "../../../components/ui/Spinner"
import { PROPERTY_LABELS, can, STAGES, STRATEGIES } from "@synergifund/shared"
import { DrawImport } from "../../../components/draws/DrawImport"
import { FormSheet } from "../../../components/ui/FormSheet"
import { StatusPill } from "../../../components/ui/StatusPill"
import { RowMenu } from "../../../components/ui/RowMenu"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

function PropertiesScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const session = useSession()
  const list = useApi("/properties")
  const [open, setOpen] = useState(params.get("new") === "1")
  const [error, setError] = useState("")
  const [form, setForm] = useState({ address: "", city: "", stage: "Under contract", strategy: "Fix & flip", purchasePrice: "", arv: "", rehabBudget: "", nextAction: "" })
  const [labels, setLabels] = useState([])
  const [labelDraft, setLabelDraft] = useState("")
  const [assigned, setAssigned] = useState([])
  const [contractors, setContractors] = useState([])
  const importInput = useRef(null)
  const [workbook, setWorkbook] = useState(null)
  const writable = session?.user && can(session.user, "properties.write")
  const canImport = session?.user && can(session.user, "imports.run") && can(session.user, "draws.write")
  const contractor = session?.user?.role === "contractor"
  const canMembers = session?.user && can(session.user, "members.manage")

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
      setLabels([])
      setLabelDraft("")
      setAssigned([])
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
        secondary={canImport ? { label: "Import Excel", onClick: () => importInput.current?.click() } : null}
        action={writable ? { label: "New property", onClick: () => setOpen(true) } : null}
        lead={canImport ? (
          <DrawImport
            job={workbook}
            inputRef={importInput}
            onOpen={setWorkbook}
            onChange={setWorkbook}
            onReload={list.reload}
          />
        ) : null}
        selectable={false}
        compact
        filters={[
          { key: "stage", label: "Status", options: STAGES, value: (row) => row.stage },
          { key: "strategy", label: "Goal", options: STRATEGIES, value: (row) => row.strategy },
        ]}
        columns={[
          { key: "address", label: "Name", render: (row) => <span className="person-copy"><strong>{row.address}</strong><small>{row.city || "Location not entered"}</small></span> },
          ...(contractor ? [] : [
            { key: "rehabBudget", label: "Rehab budget", render: (row) => row.rehabBudget == null ? "—" : money(row.rehabBudget) },
          ]),
          { key: "stage", label: "Status", render: (row) => <StatusPill>{row.stage}</StatusPill> },
          ...(contractor ? [] : [
            { key: "nextAction", label: "Next step", render: (row) => row.nextAction || "Set the next action" },
            { key: "strategy", label: "Goal", render: (row) => row.strategy || "Not set" },
          ]),
          { key: "actions", label: "", pin: "right", className: "menu-col", render: (row) => (
            <RowMenu
              label={`Actions for ${row.address}`}
              items={[
                { label: "Open", onClick: () => router.push(`/properties/${row.id}`) },
                writable && { label: "Modify", onClick: () => router.push(`/properties/${row.id}?edit=1`) },
                writable && { label: "Delete", danger: true, onClick: async () => { if (!window.confirm(`Delete ${row.address}?`)) return; await api(`/properties/${row.id}`, { method: "DELETE" }); list.reload() } },
              ]}
            />
          ) },
        ]}
        rows={list.data?.items || []}
        important={contractor ? undefined : (row) => row.health === "Needs attention" || !row.purchasePrice}
        onRow={(row) => router.push(`/properties/${row.id}`)}
        empty={list.error || "No properties yet."}
      />
      {open && (
        <FormSheet eyebrow="Properties" title="New property" hint="Start with the address. Leave a number blank if you do not have it yet." onClose={() => setOpen(false)} onSubmit={save} submitLabel="Save property" error={error}>
          <div className="form-grid">
            <label className="field wide"><span>Address</span><input name="address" value={form.address} onChange={set("address")} required /></label>
            <label className="field"><span>City</span><input name="city" value={form.city} onChange={set("city")} /></label>
            <label className="field"><span>Status</span><select name="stage" value={form.stage} onChange={set("stage")}>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
            <label className="field"><span>Strategy</span><select name="strategy" value={form.strategy} onChange={set("strategy")}>{STRATEGIES.map((item) => <option key={item}>{item}</option>)}</select></label>
            <label className="field"><span>Purchase price</span><input name="purchasePrice" value={form.purchasePrice} onChange={set("purchasePrice")} /></label>
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

export default function PropertiesPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <PropertiesScreen />
    </Suspense>
  )
}
