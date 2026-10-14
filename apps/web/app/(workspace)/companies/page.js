"use client"

import { Suspense, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { can } from "@synergifund/shared"
import { CompanyFields, PropertyPicker, companyForm } from "../../../components/companies/CompanyParts"
import { ImportCompanies } from "../../../components/companies/ImportCompanies"
import { DocStatus } from "../../../components/documents/FolderBrowser"
import { FormSheet } from "../../../components/ui/FormSheet"
import { PageSpinner } from "../../../components/ui/Spinner"
import { WorkspacePage } from "../../../components/ui/WorkspacePage"
import { useSession } from "../../../components/shell/Providers"
import { api } from "../../../lib/api"
import { money } from "../../../lib/format"
import { useApi } from "../../../lib/useApi"

export default function CompaniesPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <CompaniesScreen />
    </Suspense>
  )
}

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

function CompaniesScreen() {
  const router = useRouter()
  const params = useSearchParams()
  const session = useSession()
  const user = session?.user
  const staff = Boolean(user) && user.role !== "contractor"
  const writable = staff && can(user, "properties.write")
  const list = useApi(staff ? "/companies" : null)
  const [creating, setCreating] = useState(() => (params.get("new") === "1" ? { form: companyForm(), propertyIds: [] } : null))
  const properties = useApi(creating && writable ? "/properties" : null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [ownersOpen, setOwnersOpen] = useState(false)
  const [importing, setImporting] = useState(false)
  const [imported, setImported] = useState(null)
  const [ownerError, setOwnerError] = useState("")
  const items = list.data?.items || []
  const owners = list.data?.owners || []

  if (user && !staff) return <div className="boot"><p className="banner">Companies are only available to the SynergiFund team.</p></div>

  function startCreate(form = companyForm(), propertyIds = []) {
    setError("")
    setCreating({ form, propertyIds })
  }

  async function create(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const result = await api("/companies", { method: "POST", body: { ...creating.form, propertyIds: creating.propertyIds } })
      setCreating(null)
      router.push(`/companies/${result.company.id}`)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function assignOwner(owner) {
    const company = items.find((item) => item.id === owner.companyId)
    if (!company) return
    if (!window.confirm(`Add ${plural(owner.propertyIds.length, "property", "properties")} to ${company.name}?`)) return
    setOwnerError("")
    try {
      await api(`/companies/${company.id}/properties`, { method: "POST", body: { propertyIds: owner.propertyIds } })
      list.reload()
    } catch (err) {
      setOwnerError(err.message)
    }
  }

  const assigned = items.reduce((total, item) => total + item.properties, 0)
  const balances = items.filter((item) => item.loanBalance != null)
  const payments = items.filter((item) => item.monthlyPayment != null)

  return (
    <>
      <WorkspacePage
        views={false}
        customize={false}
        selectable={false}
        loading={!list.data && !list.error}
        title="Companies"
        action={writable ? { label: "New company", onClick: () => startCreate() } : null}
        secondary={writable ? { label: "Import", onClick: () => { setImported(null); setImporting(true) } } : null}
        lead={writable && (imported || owners.length > 0) && (
          <>
          {imported && (
            <div className={imported.errors.length ? "banner import-result" : "settings-note import-result"} role="status">
              <span>
                {[imported.created && `${plural(imported.created, "company", "companies")} added`, imported.updated && `${plural(imported.updated, "company", "companies")} filled in`, imported.linked && `${plural(imported.linked, "property", "properties")} linked`, imported.skipped && `${imported.skipped} already up to date`].filter(Boolean).join(" · ") || "Nothing was imported."}
                {imported.errors.length > 0 && ` ${plural(imported.errors.length, "row was", "rows were")} not imported: ${imported.errors.map((item) => `row ${item.row}${item.name ? ` (${item.name})` : ""}: ${item.message}`).join(" ")}`}
              </span>
              <button type="button" className="tool" onClick={() => setImported(null)}>Dismiss</button>
            </div>
          )}
          {owners.length > 0 && (
          <section className="panel company-owners">
            <button type="button" className="company-owners-head" aria-expanded={ownersOpen} onClick={() => setOwnersOpen((open) => !open)}>
              <span>
                <strong>{owners.length === 1 ? "1 owner on your properties is not a company yet" : `${owners.length} owners on your properties are not companies yet`}</strong>
                <em>Found in the Owner field of each property. Turn one into a company and its properties are assigned in the same step.</em>
              </span>
              <span className="tool">{ownersOpen ? "Hide" : "Review"}</span>
            </button>
            {ownersOpen && (
              <ul className="company-owner-list">
                {ownerError && <li><p className="banner">{ownerError}</p></li>}
                {owners.map((owner) => (
                  <li key={owner.name}>
                    <div>
                      <strong>{owner.name}</strong>
                      <em>{plural(owner.propertyIds.length, "property", "properties")} · {owner.addresses.slice(0, 3).join(" · ")}{owner.addresses.length > 3 ? ` and ${owner.addresses.length - 3} more` : ""}</em>
                    </div>
                    {owner.companyId
                      ? <button type="button" className="tool" onClick={() => assignOwner(owner)}>Add to {owner.name}</button>
                      : <button type="button" className="tool" onClick={() => startCreate(companyForm({ name: owner.name }), owner.propertyIds)}>Create company</button>}
                  </li>
                ))}
              </ul>
            )}
          </section>
          )}
          </>
        )}
        stats={list.data ? [
          { key: "companies", label: "Companies", value: String(items.length), hint: "LLCs, corporations and trusts" },
          { key: "properties", label: "Properties in a company", value: String(assigned), hint: list.data.unassigned ? `${plural(list.data.unassigned, "property", "properties")} not in a company` : "Every property has a company" },
          { key: "balance", label: "Loan balances", value: balances.length ? money(balances.reduce((total, item) => total + item.loanBalance, 0)) : "—", hint: "Open loans on their properties" },
          { key: "payment", label: "Monthly payments", value: payments.length ? money(payments.reduce((total, item) => total + item.monthlyPayment, 0)) : "—", hint: "Mortgage payments on their properties" },
        ] : []}
        columns={[
          { key: "name", label: "Company", avatar: (row) => row.name, render: (row) => <span className="person-copy"><strong>{row.name}</strong><small>{[row.entityType, row.stateOfFormation].filter(Boolean).join(" · ") || "Type not set"}</small></span> },
          { key: "properties", label: "Properties", render: (row) => row.properties },
          { key: "loanBalance", label: "Loan balance", className: "num", render: (row) => row.loanBalance == null ? "—" : money(row.loanBalance) },
          { key: "monthlyPayment", label: "Monthly", className: "num", render: (row) => row.monthlyPayment == null ? "—" : money(row.monthlyPayment) },
          {
            key: "missingDocuments",
            label: "Required docs",
            render: (row) => (
              <span className="required-cell" title={row.missingDocuments?.length ? `Missing: ${row.missingDocuments.join(", ")}` : "All four on file"}>
                <DocStatus missing={row.missingDocuments?.length > 0} label={row.missingDocuments?.length ? `${row.missingDocuments.length} missing` : "Complete"} />
              </span>
            ),
          },
          { key: "documents", label: "Files", render: (row) => row.documents },
        ]}
        rows={items}
        onRow={(row) => router.push(`/companies/${row.id}`)}
        empty={list.error || "No companies yet. Add one, then assign the properties it owns."}
      />
      {importing && writable && (
        <ImportCompanies
          onClose={() => setImporting(false)}
          onImported={(result) => {
            setImporting(false)
            setImported(result)
            list.reload()
          }}
        />
      )}
      {creating && writable && (
        <FormSheet eyebrow="Companies" title="New company" hint="Details marked * are required. The EIN and wire instructions are optional and can be added later." onClose={() => setCreating(null)} onSubmit={create} submitLabel="Save company" pending={pending} error={error}>
          <div className="form-grid">
            <CompanyFields value={creating.form} onChange={(form) => setCreating((current) => ({ ...current, form }))} />
            <div className="field wide">
              <span>Properties it owns <em>· optional</em></span>
              {properties.error ? <p className="banner">{properties.error}</p> : !properties.data ? <p className="property-missing">Loading properties…</p> : (
                <PropertyPicker
                  properties={properties.data.items || []}
                  selected={creating.propertyIds}
                  onChange={(propertyIds) => setCreating((current) => ({ ...current, propertyIds }))}
                  emptyText="No properties yet. You can assign them later."
                />
              )}
            </div>
          </div>
        </FormSheet>
      )}
    </>
  )
}
