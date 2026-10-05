"use client"

import { Suspense, useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { Loader } from "../../../components/ui/Loader"
import { PROPERTY_LABELS, can, STAGES, STRATEGIES } from "@synergifund/shared"
import { FormSheet } from "../../../components/ui/FormSheet"
import { StatusPill } from "../../../components/ui/StatusPill"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { useApi } from "../../../lib/useApi"

function PropertiesScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const session = useSession()
  const list = useApi("/properties")
  const [open, setOpen] = useState(params.get("new") === "1")
  const [error, setError] = useState("")
  const [form, setForm] = useState({ address: "", city: "", stage: "Under contract", strategy: "Fix & flip", purchasePrice: "", arv: "", rehabBudget: "", nextAction: "" })
  const [scopeLines, setScopeLines] = useState([{ title: "", description: "", budget: "", status: "Not started" }])
  const [labels, setLabels] = useState([])
  const [labelDraft, setLabelDraft] = useState("")
  const [assigned, setAssigned] = useState([])
  const [contractors, setContractors] = useState([])
  const writable = session?.user && can(session.user, "properties.write")
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
    body.set("scopeLines", JSON.stringify(scopeLines.filter((line) => line.title.trim())))
    body.set("assignedUserIds", JSON.stringify(assigned))
    try {
      await api("/properties", { method: "POST", body })
      setOpen(false)
      setLabels([])
      setLabelDraft("")
      setScopeLines([{ title: "", description: "", budget: "", status: "Not started" }])
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
        title="Properties"
        action={writable ? { label: "New property", onClick: () => setOpen(true) } : null}
        columns={[
          { key: "address", label: "Name", avatar: (row) => row.address, render: (row) => <span className="person-copy"><strong>{row.address}</strong><small>{row.city || "Location not entered"}</small></span> },
          { key: "nextAction", label: "Next step", render: (row) => row.nextAction || "Set the next action" },
          { key: "stage", label: "Status", render: (row) => <StatusPill>{row.stage}</StatusPill> },
          { key: "open", label: "", pin: "right", render: (row) => <span className="row-actions"><button type="button" onClick={(event) => { event.stopPropagation(); router.push(`/properties/${row.id}`) }}>Open</button></span> },
        ]}
        rows={list.data?.items || []}
        important={(row) => row.health === "Needs attention" || !row.purchasePrice}
        onRow={(row) => router.push(`/properties/${row.id}`)}
        empty={list.error || "No properties yet."}
      />
      {open && (
        <FormSheet eyebrow="Properties" title="New property" hint="Start with the address. Leave a number blank if you do not have it yet." onClose={() => setOpen(false)} onSubmit={save} submitLabel="Save property" error={error}>
          <div className="form-grid">
            <label className="field wide"><span>Address</span><input name="address" value={form.address} onChange={set("address")} required /></label>
            <label className="field"><span>City</span><input name="city" value={form.city} onChange={set("city")} /></label>
            <label className="field"><span>Stage</span><select name="stage" value={form.stage} onChange={set("stage")}>{STAGES.map((stage) => <option key={stage}>{stage}</option>)}</select></label>
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
            <div className="field wide">
              <span>Scope lines</span>
              {scopeLines.map((line, index) => (
                <div key={index} className="scope-edit">
                  <input placeholder="Part of the house" value={line.title} onChange={(event) => setScopeLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} />
                  <input placeholder="Budget" value={line.budget} onChange={(event) => setScopeLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, budget: event.target.value } : item))} />
                  <input className="wide" placeholder="Description" value={line.description} onChange={(event) => setScopeLines((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, description: event.target.value } : item))} />
                </div>
              ))}
              <button type="button" className="tool" onClick={() => setScopeLines((current) => [...current, { title: "", description: "", budget: "", status: "Not started" }])}>Add a line</button>
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
    <Suspense fallback={<Loader label="Opening properties" />}>
      <PropertiesScreen />
    </Suspense>
  )
}
