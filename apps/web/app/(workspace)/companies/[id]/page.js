"use client"

import { use, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { useRouter, useSearchParams } from "next/navigation"
import { can } from "@synergifund/shared"
import { CompanyFields, EinField, PropertyPicker, WireFields, companyForm } from "../../../../components/companies/CompanyParts"
import { ExposureBadge } from "../../../../components/companies/ExposureBadge"
import { DocStatus, FolderBrowser } from "../../../../components/documents/FolderBrowser"
import { DetailFrame } from "../../../../components/ui/DetailFrame"
import { FormSheet } from "../../../../components/ui/FormSheet"
import { Icon } from "../../../../components/ui/Icon"
import { StatusPill } from "../../../../components/ui/StatusPill"
import { PageSpinner } from "../../../../components/ui/Spinner"
import { useSession } from "../../../../components/shell/Providers"
import { api } from "../../../../lib/api"
import { money } from "../../../../lib/format"
import { useApi } from "../../../../lib/useApi"

const TABS = ["overview", "properties", "documents"]

function plural(count, one, many) {
  return `${count} ${count === 1 ? one : many}`
}

function dateLabel(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value || "")) return value || ""
  return new Date(`${value}T12:00:00`).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function total(value) {
  return value == null ? "—" : money(value)
}

// Copies text, also where the clipboard API is not available (older browsers, plain http).
async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    const area = document.createElement("textarea")
    area.value = text
    area.setAttribute("readonly", "")
    area.style.position = "fixed"
    area.style.opacity = "0"
    document.body.appendChild(area)
    area.select()
    const done = document.execCommand("copy")
    area.remove()
    return done
  }
}

function wireForm(company) {
  const wire = company.wire || {}
  return {
    wireBankName: wire.bankName || "",
    wireRoutingNumber: wire.routingNumber || "",
    wireAccountNumber: wire.accountNumber || "",
    wireEntityName: wire.entityName || "",
    wireAddress: wire.address || "",
  }
}

function fullAddress(company) {
  const place = [company.city, [company.state, company.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ")
  return [company.address, place].filter(Boolean).join(", ")
}

const WIRE_LINES = [
  ["bankName", "Bank Name"],
  ["routingNumber", "Routing Number"],
  ["accountNumber", "Account Number"],
  ["entityName", "Entity Name"],
  ["address", "Bank Address"],
]

export default function CompanyPage({ params }) {
  const { id } = use(params)
  const router = useRouter()
  const search = useSearchParams()
  const session = useSession()
  const user = session?.user
  const staff = Boolean(user) && user.role !== "contractor"
  const writable = staff && can(user, "properties.write")
  const detail = useApi(staff ? `/companies/${id}` : null)
  const files = useApi(staff ? `/documents?companyId=${id}&properties=1` : null)
  const [section, setSection] = useState(() => (TABS.includes(search.get("tab")) ? search.get("tab") : "overview"))
  // Where the Documents tab opens: a property's folders and a folder, from the link or the Properties tab.
  const [docsAt, setDocsAt] = useState(() => ({ propertyId: search.get("property") || "", folder: search.get("folder") || "" }))
  const [editing, setEditing] = useState(null)
  const [banking, setBanking] = useState(null)
  const [einEdit, setEinEdit] = useState(null)
  const [assigning, setAssigning] = useState(null)
  const allProperties = useApi(assigning && writable ? "/properties" : null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const [notice, setNotice] = useState("")

  if (user && !staff) return <div className="boot"><p className="banner">Companies are only available to the SynergiFund team.</p></div>
  const company = detail.data?.company
  if (!company) return detail.error ? <div className="boot"><p className="banner">{detail.error}</p></div> : <PageSpinner />

  const properties = detail.data.properties || []
  const totals = detail.data.totals || {}
  const canDocs = can(user, "documents.write")
  const canDeleteDocs = can(user, "documents.delete")
  const allFiles = files.data?.items || []
  const fileCount = (totals.documents || 0) + (totals.propertyDocuments || 0)

  function reload() {
    detail.reload()
    files.reload()
  }

  async function save(event, body, close) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      await api(`/companies/${id}`, { method: "PATCH", body })
      // Closed once the page shows the new values, so nothing old flashes up.
      await detail.reload()
      close()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function assign(event) {
    event.preventDefault()
    if (!assigning.length) {
      setError("Choose at least one property.")
      return
    }
    setPending(true)
    setError("")
    try {
      const result = await api(`/companies/${id}/properties`, { method: "POST", body: { propertyIds: assigning } })
      setAssigning(null)
      setNotice(result.assigned ? `${plural(result.assigned, "property", "properties")} assigned to ${company.name}.` : "Those properties were already in this company.")
      detail.reload()
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  async function unassign(property) {
    if (!window.confirm(`Remove ${property.address} from ${company.name}? The property itself is not changed.`)) return
    setNotice("")
    try {
      await api(`/companies/${id}/properties/${property.id}`, { method: "DELETE" })
      setNotice(`${property.address} is no longer in ${company.name}.`)
      detail.reload()
    } catch (err) {
      setNotice(err.message)
    }
  }

  async function remove() {
    const kept = [
      properties.length ? `its ${plural(properties.length, "property stays", "properties stay")} in Properties without a company` : "",
      totals.documents ? `its ${plural(totals.documents, "file stays", "files stay")} in Documents` : "",
    ].filter(Boolean).join(" and ")
    if (!window.confirm(`Delete ${company.name}?${kept ? ` ${kept.charAt(0).toUpperCase()}${kept.slice(1)}.` : ""} This cannot be undone.`)) return
    try {
      await api(`/companies/${id}`, { method: "DELETE" })
      router.push("/companies")
    } catch (err) {
      setNotice(err.message)
    }
  }

  function openTab(next) {
    setSection(next)
    setNotice("")
    if (next === "documents") setDocsAt({ propertyId: "", folder: "" })
  }

  function openFolder(folder) {
    setDocsAt({ propertyId: "", folder })
    setSection("documents")
    setNotice("")
  }

  function openPropertyDocs(propertyId) {
    setDocsAt({ propertyId, folder: "" })
    setSection("documents")
    setNotice("")
  }

  const tabs = [
    { id: "overview", label: "Overview" },
    { id: "properties", label: properties.length ? `Properties · ${properties.length}` : "Properties" },
    { id: "documents", label: fileCount ? `Documents · ${fileCount}` : "Documents" },
  ]
  const wire = company.wire || {}
  const hasWire = WIRE_LINES.some(([key]) => wire[key])
  const required = detail.data.required || []
  const missingCount = required.filter((item) => item.missing).length

  return (
    <DetailFrame
      backHref="/companies"
      backLabel="Companies"
      title={company.name}
      meta={[company.entityType, company.stateOfFormation, plural(properties.length, "property", "properties")].filter(Boolean).join(" · ")}
      status={properties.length ? <ExposureBadge count={properties.length} /> : null}
      metaAside={properties.length ? <ExposureBadge count={properties.length} /> : null}
      actions={writable ? [
        <button key="delete" type="button" className="danger" onClick={remove}>Delete</button>,
        <button key="modify" type="button" className="primary" onClick={() => { setError(""); setEditing(companyForm(company)) }}>Modify</button>,
      ] : null}
    >
      <div className="property-switch" role="tablist" aria-label="Company sections">
        {tabs.map((tab) => (
          <button key={tab.id} type="button" role="tab" aria-selected={section === tab.id} className={section === tab.id ? "is-on" : ""} onClick={() => openTab(tab.id)}>{tab.label}</button>
        ))}
      </div>

      {notice && <p className="settings-note company-notice">{notice}</p>}

      {section === "overview" && (
        <>
          <section className="property-figures">
            <Figure label="Properties" value={String(totals.properties ?? properties.length)} hint={totals.propertyDocuments ? `${plural(totals.propertyDocuments, "file", "files")} on them` : ""} />
            <Figure label="Purchase total" value={total(totals.purchase)} />
            <Figure label="ARV total" value={total(totals.arv)} />
            <Figure label="Loan balance" value={total(totals.loanBalance)} hint={totals.monthlyPayment != null ? `${money(totals.monthlyPayment)} a month` : ""} />
          </section>

          {/* Left: the company's details, then its required documents. Right: the EIN, then the wire instructions. */}
          <div className="company-overview">
            <div className="company-side">
              <section className="panel property-card">
                <h2>Details</h2>
                <dl className="property-facts">
                  <Fact label="Entity Type" value={company.entityType} />
                  <Fact label="State of Formation" value={company.stateOfFormation} />
                  <Fact label="Effective Date" value={dateLabel(company.formedOn)} />
                  <Fact label="Authorized Member" value={company.contactName} />
                  <Fact label="Address" value={fullAddress(company)} wide />
                  <Fact label="Notes" value={company.notes && <span className="company-notes">{company.notes}</span>} wide />
                </dl>
                {company.updatedBy && <p className="property-missing company-updated">Last updated by {company.updatedBy}.</p>}
              </section>
              <section className="panel property-card company-required">
                <div className="property-card-head">
                  <div>
                    <h2>Required Documents</h2>
                    <p className="property-missing">{missingCount ? `${missingCount} of ${required.length} missing. Open one to upload it.` : "All on file."}</p>
                  </div>
                </div>
                <ul className="required-docs">
                  {required.map((item) => (
                    <li key={item.id}>
                      <button type="button" onClick={() => openFolder(item.id)}>
                        <span>{item.name}</span>
                        <DocStatus missing={item.missing} label={item.missing ? "Missing" : item.files === 1 ? "On file" : `${item.files} files`} />
                        <Icon name="chevron" size={14} />
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            </div>
            <div className="company-side">
              <section className="panel property-card">
                <div className="property-card-head">
                  <div><h2>EIN Number</h2></div>
                  {writable && <button type="button" className="tool" onClick={() => { setError(""); setEinEdit(company.ein || "") }}>{company.ein ? "Edit" : "Add"}</button>}
                </div>
                {company.ein ? (
                  <dl className="copy-list"><CopyRow label="EIN Number" value={company.ein} /></dl>
                ) : (
                  <p className="property-missing">No EIN yet.</p>
                )}
              </section>
              <section className="panel property-card company-wire">
                <div className="property-card-head">
                  <div>
                    <h2>Wire Instructions</h2>
                    <p className="property-missing">Copy a line, or copy everything at once to paste into an email.</p>
                  </div>
                  {writable && <button type="button" className="tool" onClick={() => { setError(""); setBanking(wireForm(company)) }}>{hasWire ? "Edit" : "Add"}</button>}
                </div>
                {hasWire ? (
                  <>
                    <dl className="copy-list">
                      {WIRE_LINES.map(([key, label]) => <CopyRow key={key} label={label} value={wire[key]} secret={key === "accountNumber"} />)}
                    </dl>
                    <CopyAll text={WIRE_LINES.filter(([key]) => wire[key]).map(([key, label]) => `${label}: ${wire[key]}`).join("\n")} />
                  </>
                ) : (
                  <p className="property-missing">No wire instructions yet.{writable ? " Add the bank name, routing number, account number, entity name and bank address." : ""}</p>
                )}
              </section>
            </div>
          </div>
        </>
      )}

      {section === "properties" && (
        <section className="panel property-card">
          <div className="property-card-head">
            <div>
              <h2>Properties</h2>
              <p className="property-missing">The properties {company.name} owns. Each one shows this company on its Overview.</p>
            </div>
            {writable && <button type="button" className="primary" onClick={() => { setError(""); setAssigning([]) }}>Assign properties</button>}
          </div>
          {properties.length === 0 && <p className="property-missing">No properties assigned yet.</p>}
          <ul className="property-scope company-properties">
            {properties.map((item) => (
              <li key={item.id}>
                <div>
                  <strong><Link href={`/properties/${item.id}`}>{item.address}</Link></strong>
                  <em>
                    {[item.city, item.strategy, item.loanBalance != null ? `${money(item.loanBalance)} loan` : ""].filter(Boolean).join(" · ") || "No details yet"}
                    {" · "}
                    <button type="button" className="company-file-link" onClick={() => openPropertyDocs(item.id)}>{plural(item.documents, "file", "files")}</button>
                  </em>
                </div>
                <StatusPill>{item.stage || "No status"}</StatusPill>
                {writable ? <button type="button" className="tool" onClick={() => unassign(item)} aria-label={`Remove ${item.address} from ${company.name}`}>Remove</button> : <span />}
              </li>
            ))}
          </ul>
        </section>
      )}

      {section === "documents" && (
        <section className="panel property-card doc-panel">
          <div className="property-card-head">
            <div>
              <h2>Documents</h2>
              <p className="property-missing">{company.name}’s papers and the documents of every property it owns, in folders. Open a folder to view, download or upload. Tick files or folders, in as many folders as you like, then Download zip.</p>
            </div>
            <Link href={`/documents?company=${id}`} className="tool">Open in Documents</Link>
          </div>
          {files.error ? (
            <p className="banner">{files.error}</p>
          ) : !files.data ? (
            <p className="property-missing">Loading files…</p>
          ) : (
            <FolderBrowser
              key={`${docsAt.propertyId}:${docsAt.folder}`}
              companyId={id}
              companyName={company.name}
              properties={properties.map((item) => ({ id: item.id, address: item.address }))}
              files={allFiles}
              writable={Boolean(canDocs)}
              canDelete={Boolean(canDeleteDocs)}
              onChanged={reload}
              initialProperty={docsAt.propertyId}
              initialFolder={docsAt.folder}
            />
          )}
        </section>
      )}

      {editing && (
        <FormSheet eyebrow="Company" title="Modify company" hint="Changes show everywhere this company appears." onClose={() => setEditing(null)} onSubmit={(event) => save(event, editing, () => setEditing(null))} submitLabel="Save changes" pending={pending} error={error}>
          <div className="form-grid">
            <CompanyFields value={editing} onChange={setEditing} />
          </div>
        </FormSheet>
      )}

      {banking && (
        <FormSheet eyebrow={company.name} title="Wire Instructions" hint="Paste them in as the bank gives them. Numbers are checked so a typo is caught before anyone sends money." onClose={() => setBanking(null)} onSubmit={(event) => save(event, banking, () => setBanking(null))} submitLabel="Save" pending={pending} error={error}>
          <div className="form-grid">
            <WireFields value={banking} onChange={setBanking} entityPlaceholder={company.name} />
          </div>
        </FormSheet>
      )}

      {einEdit != null && (
        <FormSheet eyebrow={company.name} title="EIN Number" hint="9 digits, like 12-3456789. Leave it blank to remove it." onClose={() => setEinEdit(null)} onSubmit={(event) => save(event, { ein: einEdit }, () => setEinEdit(null))} submitLabel="Save" pending={pending} error={error}>
          <div className="form-grid">
            <EinField value={einEdit} onChange={setEinEdit} />
          </div>
        </FormSheet>
      )}

      {assigning && (
        <FormSheet eyebrow={company.name} title="Assign properties" hint="Tick the properties this company owns. A property can belong to one company." onClose={() => setAssigning(null)} onSubmit={assign} submitLabel={assigning.length ? `Assign ${plural(assigning.length, "property", "properties")}` : "Assign"} pending={pending} pendingLabel="Assigning…" error={error}>
          {allProperties.error ? <p className="banner">{allProperties.error}</p> : !allProperties.data ? <p className="property-missing">Loading properties…</p> : (
            <PropertyPicker properties={allProperties.data.items || []} selected={assigning} onChange={setAssigning} companyId={id} />
          )}
        </FormSheet>
      )}
    </DetailFrame>
  )
}

// "Copied" shows for a moment after a copy.
function useCopied() {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy(text) {
    if (!(await copyText(text))) return
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
  }
  return [copied, copy]
}

// One line you can copy. The account number stays hidden until Show, but Copy always copies the full number.
function CopyRow({ label, value, secret = false }) {
  const [shown, setShown] = useState(!secret)
  const [copied, copy] = useCopied()
  const masked = value && !shown ? `•••• ${value.slice(-4)}` : value
  return (
    <div className="copy-row">
      <dt>{label}</dt>
      <dd className={value ? "" : "is-empty"}>{value ? masked : "Not entered"}</dd>
      {value && (
        <span className="copy-actions">
          {secret && <button type="button" onClick={() => setShown(!shown)} aria-label={shown ? `Hide ${label}` : `Show ${label}`}><Icon name="eye" size={14} /> {shown ? "Hide" : "Show"}</button>}
          <button type="button" className={copied ? "is-done" : ""} onClick={() => copy(value)} aria-label={`Copy ${label}`}><Icon name={copied ? "tick" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}</button>
        </span>
      )}
    </div>
  )
}

function CopyAll({ text }) {
  const [copied, copy] = useCopied()
  return (
    <button type="button" className={copied ? "tool copy-all is-done" : "tool copy-all"} onClick={() => copy(text)}>
      <Icon name={copied ? "tick" : "copy"} size={14} /> {copied ? "Copied all" : "Copy all"}
    </button>
  )
}

function Figure({ label, value, hint }) {
  return (
    <article className="property-figure">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <em>{hint}</em>}
    </article>
  )
}

function Fact({ label, value, wide }) {
  return (
    <div className={wide ? "wide" : undefined}>
      <dt>{label}</dt>
      <dd>{value || "Not entered"}</dd>
    </div>
  )
}
