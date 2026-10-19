"use client"

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import Link from "next/link"
import { PERMISSIONS, can } from "@synergifund/shared"
import { useSession } from "../shell/Providers"
import { Icon } from "../ui/Icon"
import { api } from "../../lib/api"

const AGENT_NAME = "SynergiFund"

const STATUS_LABELS = {
  todo_write: "Planning Next Moves",
  arv_analysis: "Working out the ARV",
  portfolio_summary: "Reading the portfolio",
  list_properties: "Reading properties",
  list_companies: "Reading companies",
  get_property: "Opening the property",
  list_loans: "Reading loans",
  list_lenders: "Reading lenders",
  list_draws: "Reading draws",
  upcoming_payments: "Checking upcoming payments",
  list_expenses: "Reading expenses",
  list_tasks: "Reading the task list",
  list_team: "Looking up the team",
  search_documents: "Searching documents",
  find_documents: "Finding documents",
  zip_documents: "Zipping documents",
  web_search: "Searching the web",
  read_webpage: "Visiting the website",
  search_records: "Searching records",
  compose_answer: "Writing the answer",
}

const HIDDEN_STEPS = new Set(["todo_write", "compose_answer", "status"])

function tag(Tag, className, extra = {}) {
  return function MarkdownElement({ node, ...props }) {
    return <Tag className={className} {...extra} {...props} />
  }
}

const markdown = {
  h1: tag("h1", "agent-md-h1"),
  h2: tag("h2", "agent-md-h2"),
  h3: tag("h3", "agent-md-h3"),
  h4: tag("h4", "agent-md-h4"),
  p: tag("p", "agent-md-p"),
  ul: tag("ul", "agent-md-ul"),
  ol: tag("ol", "agent-md-ol"),
  li: tag("li", "agent-md-li"),
  // A zip or file the agent gathered downloads in place, as a button; other links open in a new tab.
  a: function MarkdownLink({ node, href = "", children, ...props }) {
    if (/^\/api\/documents\//.test(href)) return <a className="agent-md-a agent-download" href={href} {...props}><Icon name="download" size={14} />{children}</a>
    return <a className="agent-md-a" href={href} target="_blank" rel="noreferrer" {...props}>{children}</a>
  },
  code: tag("code", "agent-md-code"),
  // An email the agent wrote becomes an editable draft card; other writing gets a card with Copy.
  pre: function MarkdownPre({ node, ...props }) {
    const code = node?.children?.find((child) => child.tagName === "code")
    const language = [].concat(code?.properties?.className || []).find((name) => String(name).startsWith("language-"))
    if (language === "language-email") return <EmailDraft text={hastText(code)} />
    if (language === "language-draft") return <TextDraft text={hastText(code)} />
    return <pre className="agent-md-pre" {...props} />
  },
  blockquote: tag("blockquote", "agent-md-quote"),
  table: function MarkdownTable({ node, ...props }) {
    return <div className="agent-md-table-wrap"><table className="agent-md-table" {...props} /></div>
  },
  thead: tag("thead", "agent-md-thead"),
  tr: tag("tr", "agent-md-tr"),
  th: tag("th", "agent-md-th"),
  td: tag("td", "agent-md-td"),
  strong: tag("strong", "agent-md-strong"),
  em: tag("em", "agent-md-em"),
  hr: tag("hr", "agent-md-hr"),
}

const DOWNLOAD_LINK = /\[([^\]\n]+)\]\((\/api\/documents\/(?:[^()\s]|\([^()\s]*\))+)\)/g

// Downloads the agent made (a zip or a file) are shown as buttons at the end of its answer, wherever it wrote them.
// A line that is only the link goes; in a sentence the link's words stay.
export function splitDownloads(content) {
  const downloads = []
  const kept = []
  for (const line of String(content || "").split("\n")) {
    const found = [...line.matchAll(DOWNLOAD_LINK)]
    if (!found.length) {
      kept.push(line)
      continue
    }
    for (const match of found) if (!downloads.some((item) => item.href === match[2])) downloads.push({ text: match[1], href: match[2] })
    if (line.replace(DOWNLOAD_LINK, "").replace(/[\s*_`>•:.\-]/g, "")) kept.push(line.replace(DOWNLOAD_LINK, (_, text) => text.replace(/^download\s+/i, "")))
  }
  return { text: kept.join("\n").replace(/\n{3,}/g, "\n\n").trim(), downloads }
}

function hastText(node) {
  if (!node) return ""
  if (node.type === "text") return node.value || ""
  return (node.children || []).map(hastText).join("")
}

// "To: a@b.com / Subject: … / (blank line) / body" → its parts. Headers end at the first blank line; a From or
// Reply-To line is skipped (the person sends from their own mail).
export function parseEmailDraft(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/^\s*\n/, "").replace(/\n+$/, "").split("\n")
  const draft = { to: "", cc: "", bcc: "", subject: "", body: "" }
  let index = 0
  while (index < lines.length) {
    const match = /^(to|cc|bcc|subject|from|reply-to)\s*:\s*(.*)$/i.exec(lines[index])
    if (!match) break
    const key = match[1].toLowerCase()
    if (key in draft) draft[key] = match[2].trim()
    index += 1
  }
  while (index < lines.length && !lines[index].trim()) index += 1
  draft.body = lines.slice(index).join("\n").trim()
  return draft
}

function useCopy() {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)
  useEffect(() => () => clearTimeout(timer.current), [])
  async function copy(text) {
    let ok = true
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement("textarea")
      area.value = text
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      try {
        ok = document.execCommand("copy")
      } catch {
        ok = false
      }
      area.remove()
    }
    setCopied(ok ? "yes" : "no")
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
    return ok
  }
  return [copied, copy]
}

// Grows with its text, so the whole draft is readable without a second scrollbar.
function GrowingText({ value, onChange, label }) {
  const ref = useRef(null)
  useLayoutEffect(() => {
    const area = ref.current
    if (!area) return
    area.style.height = "auto"
    area.style.height = `${area.scrollHeight + 2}px`
  }, [value])
  return <textarea ref={ref} className="agent-draft-text" value={value} onChange={(event) => onChange(event.target.value)} aria-label={label} rows={4} spellCheck />
}

// "a@x.com; b@y.com" → "a@x.com,b@y.com", the form every mail service takes.
function addresses(value) {
  return String(value || "").split(/[,;]/).map((item) => item.trim()).filter(Boolean).join(",")
}

function mailtoLink({ to, cc, bcc, subject, body }) {
  const query = new URLSearchParams()
  if (cc) query.set("cc", cc)
  if (bcc) query.set("bcc", bcc)
  if (subject) query.set("subject", subject)
  if (body) query.set("body", body)
  // URLSearchParams writes spaces as "+", which mail apps show literally; mailto wants %20.
  return `mailto:${to.split(",").filter(Boolean).map(encodeURIComponent).join(",")}?${query.toString().replace(/\+/g, "%20")}`
}

const MAIL_KEY = "synergifund-mail-app"

// Where a draft can be opened, filled in. Nothing is sent from here: the person presses Send in their mail.
// Zoho Mail (the company's own mail) and Yahoo Mail may leave the message empty, so the message is copied too.
const MAIL_APPS = [
  {
    id: "zoho",
    label: "Zoho Mail",
    copies: true,
    href: (draft) => `https://mail.zoho.com/mail/compose.do?extsrc=mailto&mode=compose&tp=zb&ct=${encodeURIComponent(mailtoLink(draft))}`,
  },
  {
    id: "gmail",
    label: "Gmail",
    href: ({ to, cc, bcc, subject, body }) => `https://mail.google.com/mail/?view=cm&fs=1&to=${encodeURIComponent(to)}${cc ? `&cc=${encodeURIComponent(cc)}` : ""}${bcc ? `&bcc=${encodeURIComponent(bcc)}` : ""}&su=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  },
  {
    id: "outlook",
    label: "Outlook",
    href: ({ to, cc, bcc, subject, body }) => `https://outlook.office.com/mail/deeplink/compose?to=${encodeURIComponent(to)}${cc ? `&cc=${encodeURIComponent(cc)}` : ""}${bcc ? `&bcc=${encodeURIComponent(bcc)}` : ""}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  },
  {
    id: "yahoo",
    label: "Yahoo Mail",
    copies: true,
    href: ({ to, cc, bcc, subject, body }) => `https://compose.mail.yahoo.com/?to=${encodeURIComponent(to)}${cc ? `&cc=${encodeURIComponent(cc)}` : ""}${bcc ? `&bcc=${encodeURIComponent(bcc)}` : ""}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`,
  },
  { id: "app", label: "Email App", sameTab: true, href: mailtoLink },
]

function sendLabel(app) {
  return app.id === "app" ? "Open In Email App" : `Send Via ${app.label}`
}

function MailMark({ id }) {
  if (id === "gmail") {
    return (
      <svg className="mail-mark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <path d="M3 7.2V18a1.5 1.5 0 0 0 1.5 1.5H7V10.4z" fill="#4285F4" />
        <path d="M17 19.5h2.5A1.5 1.5 0 0 0 21 18V7.2l-4 3.2z" fill="#34A853" />
        <path d="M17 6.2v4.2l4-3.2V6.4c0-1.5-1.7-2.3-2.9-1.4z" fill="#FBBC04" />
        <path d="M7 10.4V6.2l5 3.8 5-3.8v4.2l-5 3.8z" fill="#EA4335" />
        <path d="M3 6.4v.8l4 3.2V6.2L5.9 5C4.7 4.1 3 4.9 3 6.4z" fill="#C5221F" />
      </svg>
    )
  }
  if (id === "outlook") {
    return (
      <svg className="mail-mark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="3" width="20" height="18" rx="3" fill="#0A64C8" />
        <ellipse cx="12" cy="12" rx="4.6" ry="5.4" fill="none" stroke="#fff" strokeWidth="2.4" />
      </svg>
    )
  }
  if (id === "zoho") {
    return (
      <svg className="mail-mark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="1" y="7" width="5.2" height="10" rx="1.2" fill="#E42527" />
        <rect x="6.6" y="7" width="5.2" height="10" rx="1.2" fill="#089949" />
        <rect x="12.2" y="7" width="5.2" height="10" rx="1.2" fill="#226DB4" />
        <rect x="17.8" y="7" width="5.2" height="10" rx="1.2" fill="#F9B21D" />
      </svg>
    )
  }
  if (id === "yahoo") {
    return (
      <svg className="mail-mark" width="16" height="16" viewBox="0 0 24 24" aria-hidden="true">
        <rect x="2" y="3" width="20" height="18" rx="3" fill="#6001D2" />
        <path d="M7 8l3.4 5.2V17h2.2v-3.8L16 8h-2.4l-2.1 3.4L9.4 8z" fill="#fff" />
      </svg>
    )
  }
  return <Icon name="mail" size={16} />
}

function withHeaders({ to, cc, bcc, subject, body }) {
  const head = [to && `To: ${to}`, cc && `Cc: ${cc}`, bcc && `Bcc: ${bcc}`, subject && `Subject: ${subject}`].filter(Boolean).join("\n")
  return head ? `${head}\n\n${body}` : body
}

function EmailDraft({ text }) {
  const parsed = parseEmailDraft(text)
  const [to, setTo] = useState(parsed.to)
  const [cc, setCc] = useState(parsed.cc)
  const [bcc, setBcc] = useState(parsed.bcc)
  // Cc and Bcc stay on the card once there, even while being emptied to retype them.
  const [extra] = useState(() => ({ cc: Boolean(parsed.cc), bcc: Boolean(parsed.bcc) }))
  const [subject, setSubject] = useState(parsed.subject)
  const [body, setBody] = useState(parsed.body)
  const [menu, setMenu] = useState(false)
  const [choice, setChoice] = useState("zoho")
  const [notice, setNotice] = useState("")
  const [copied, copy] = useCopy()
  const box = useRef(null)
  // The main button is the mail this person used last; Zoho Mail (the company's mail) to start with.
  useEffect(() => {
    try {
      const saved = localStorage.getItem(MAIL_KEY)
      if (MAIL_APPS.some((app) => app.id === saved)) setChoice(saved)
    } catch {}
  }, [])
  useEffect(() => {
    if (!menu) return undefined
    function away(event) {
      if (!box.current?.contains(event.target)) setMenu(false)
    }
    function onKey(event) {
      if (event.key === "Escape") setMenu(false)
    }
    document.addEventListener("mousedown", away)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", away)
      document.removeEventListener("keydown", onKey)
    }
  }, [menu])
  const draft = { to: addresses(to), cc: addresses(cc), bcc: addresses(bcc), subject, body }
  const main = MAIL_APPS.find((app) => app.id === choice) || MAIL_APPS[0]
  function opened(app) {
    setMenu(false)
    setChoice(app.id)
    try {
      localStorage.setItem(MAIL_KEY, app.id)
    } catch {}
    if (app.copies) {
      copy(body).then((ok) => setNotice(ok ? `The message is copied too. If ${app.label} opens without it, paste it in.` : `If ${app.label} opens without the message, come back and press Copy, then paste it in.`))
    } else setNotice("")
  }
  const link = (app, props) => (
    <a {...props} href={app.href(draft)} {...(app.sameTab ? {} : { target: "_blank", rel: "noreferrer" })} onClick={() => opened(app)}>
      <MailMark id={app.id} /> {sendLabel(app)}
    </a>
  )
  return (
    <section className="agent-draft agent-email" aria-label="Email Draft">
      <header className="agent-draft-head">
        <span><Icon name="mail" size={15} /> Email Draft</span>
        <small>Edit anything before you send it.</small>
      </header>
      <label className="agent-email-field">
        <span>To</span>
        <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="Add an email address" inputMode="email" autoComplete="off" />
      </label>
      {extra.cc && (
        <label className="agent-email-field">
          <span>Cc</span>
          <input value={cc} onChange={(event) => setCc(event.target.value)} inputMode="email" autoComplete="off" />
        </label>
      )}
      {extra.bcc && (
        <label className="agent-email-field">
          <span>Bcc</span>
          <input value={bcc} onChange={(event) => setBcc(event.target.value)} inputMode="email" autoComplete="off" />
        </label>
      )}
      <label className="agent-email-field">
        <span>Subject</span>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" />
      </label>
      <GrowingText value={body} onChange={setBody} label="Email body" />
      {notice && <p className="agent-draft-notice">{notice}</p>}
      <footer className="agent-draft-foot">
        <button type="button" className="agent-draft-copy" onClick={() => copy(body)}>
          <Icon name={copied === "yes" ? "tick" : "copy"} size={14} /> {copied === "yes" ? "Copied" : copied === "no" ? "Couldn't Copy" : "Copy"}
        </button>
        <div className="agent-send" ref={box}>
          {link(main, { className: "agent-send-main", title: `Opens a new message in ${main.label} with this filled in. Nothing is sent until you press Send there.` })}
          <button type="button" className="agent-send-more" aria-label="Other ways to send" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
            <Icon name="chevron" size={12} />
          </button>
          {menu && (
            <div className="agent-send-menu" role="menu">
              {MAIL_APPS.filter((app) => app.id !== main.id).map((app) => <span key={app.id} role="none">{link(app, { role: "menuitem" })}</span>)}
              <button type="button" role="menuitem" onClick={() => { copy(withHeaders(draft)); setMenu(false); setNotice("") }}>
                <Icon name="copy" size={16} /> Copy With To And Subject
              </button>
            </div>
          )}
        </div>
      </footer>
    </section>
  )
}

function TextDraft({ text }) {
  const [value, setValue] = useState(String(text || "").replace(/\n+$/, ""))
  const [copied, copy] = useCopy()
  return (
    <section className="agent-draft" aria-label="Draft">
      <header className="agent-draft-head">
        <span><Icon name="edit" size={15} /> Draft</span>
        <small>Edit it here, then copy it.</small>
      </header>
      <GrowingText value={value} onChange={setValue} label="Draft" />
      <footer className="agent-draft-foot">
        <button type="button" className="agent-draft-copy" onClick={() => copy(value)}>
          <Icon name={copied === "yes" ? "tick" : "copy"} size={14} /> {copied === "yes" ? "Copied" : copied === "no" ? "Couldn't Copy" : "Copy"}
        </button>
      </footer>
    </section>
  )
}

function AgentAnswer({ content }) {
  const { text, downloads } = useMemo(() => splitDownloads(content), [content])
  return (
    <div className="agent-md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdown}>{text}</ReactMarkdown>
      {downloads.length > 0 && (
        <div className="agent-downloads">
          {downloads.map((item) => (
            <a key={item.href} className="agent-md-a agent-download" href={item.href}><Icon name="download" size={15} />{item.text}</a>
          ))}
        </div>
      )}
    </div>
  )
}

// The last ARV the agent worked out in this answer (the full analysis rides along with the tool step).
function arvOf(rows) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const step = rows[index].toolResult
    if (step?.UsedTool === "arv_analysis" && step.result?.analysis?.success) return step.result.analysis
  }
  return null
}

const cash = (value) => (value == null ? "—" : `${value < 0 ? "-" : ""}$${Math.round(Math.abs(value)).toLocaleString("en-US")}`)

function shortDay(value) {
  if (!value) return "—"
  const date = new Date(`${value}T12:00:00`)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

function adjustmentText(comp) {
  return comp.adjustments?.length ? comp.adjustments.map((item) => `${item.amount < 0 ? "-" : "+"}${cash(Math.abs(item.amount))} (${item.label})`).join(", ") : "None"
}

// Maximum offer = ARV x 0.70 - renovation estimate (the team's offer formula).
function offerFrom(arv, rehab) {
  return arv != null && rehab != null ? Math.round(arv * 0.7 - rehab) : null
}

// Tab-separated, so it pastes into a spreadsheet as rows and columns.
function compLog(analysis, rehab) {
  const maxOffer = offerFrom(analysis.arv, rehab)
  const head = ["Address", "Sale price", "Adjustment", "Price used", "Sq ft", "Beds", "Baths", "Distance (mi)", "Sold", "Notes", "Listing"]
  const rows = analysis.used.map((comp) => [comp.address, comp.salePrice, adjustmentText(comp), comp.adjustedPrice, comp.sqft, comp.beds, comp.baths, comp.distanceMiles ?? "", comp.saleDate, (comp.flags || []).join("; "), comp.url || ""])
  const lines = [
    [`ARV analysis: ${analysis.subject.address}`],
    [`Subject: ${analysis.subject.beds} beds, ${analysis.subject.baths} baths, ${analysis.subject.sqft} sq ft`],
    [],
    head,
    ...rows,
    [],
    ["ARV", analysis.arv ?? ""],
    ["Math", analysis.math],
    ...(maxOffer != null ? [["Renovation estimate", rehab], ["Maximum offer", maxOffer], ["Formula", `${cash(analysis.arv)} x 0.70 - ${cash(rehab)} = ${cash(maxOffer)}`]] : []),
  ]
  return lines.map((line) => line.join("\t")).join("\n")
}

function priceCompare(label, price, maxOffer) {
  if (price == null || maxOffer == null) return null
  const gap = price - maxOffer
  return { label, price, gap, text: gap > 0 ? `${cash(gap)} above the maximum offer` : gap < 0 ? `${cash(-gap)} under the maximum offer` : "Exactly the maximum offer" }
}

function ArvCard({ analysis }) {
  const session = useSession()
  const [copied, copy] = useCopy()
  const [saving, setSaving] = useState("")
  const [error, setError] = useState("")
  const [rehabText, setRehabText] = useState(analysis.rehabEstimate != null ? String(Math.round(analysis.rehabEstimate)) : "")
  const canSave = Boolean(analysis.propertyId && analysis.used.length && session?.user && can(session.user, PERMISSIONS.propertiesWrite))
  const subject = analysis.subject
  const rehabValue = rehabText.trim() === "" ? null : Number(rehabText.replace(/[$,\s]/g, ""))
  const rehab = Number.isFinite(rehabValue) && rehabValue >= 0 ? rehabValue : null
  const maxOffer = offerFrom(analysis.arv, rehab)
  const beforeRepairs = analysis.arv != null ? Math.round(analysis.arv * 0.7) : null
  const edited = rehab !== (analysis.rehabEstimate ?? null)
  const compare = priceCompare("List price", analysis.listPrice, maxOffer) || priceCompare("Purchase price", analysis.purchasePrice, maxOffer)
  async function save() {
    setSaving("saving")
    setError("")
    try {
      const data = await api(`/properties/${analysis.propertyId}/arv-analysis`, { method: "POST", body: { comps: analysis.used, subject: { beds: subject.beds, baths: subject.baths, sqft: subject.sqft } } })
      setSaving(`Saved: ARV ${cash(data.arv)} on file${data.added ? `, ${data.added} ${data.added === 1 ? "comp" : "comps"} added` : ""}.`)
    } catch (err) {
      setError(err.message)
      setSaving("")
    }
  }
  return (
    <section className="agent-arv" aria-label="ARV analysis">
      <header className="agent-arv-head">
        <span><Icon name="chart" size={15} /> ARV Analysis</span>
        <small>{subject.address} · {subject.beds} bd · {subject.baths} ba · {subject.sqft?.toLocaleString("en-US")} sq ft</small>
      </header>
      <div className="agent-arv-figures">
        <div>
          <small>After repair value</small>
          <b>{cash(analysis.arv)}</b>
          <em>{analysis.ready ? `Average of ${analysis.used.length} adjusted comps` : analysis.arv != null ? `From only ${analysis.used.length} ${analysis.used.length === 1 ? "comp" : "comps"}: not reliable yet` : "No usable comps"}</em>
        </div>
        <div className="agent-arv-offer">
          <small>Maximum offer</small>
          <b>{maxOffer != null ? cash(maxOffer) : "—"}</b>
          <em>
            {maxOffer != null
              ? `${cash(analysis.arv)} × 0.70 − ${cash(rehab)} renovation`
              : beforeRepairs != null ? `${cash(beforeRepairs)} before repairs (ARV × 0.70). Add the renovation estimate.` : "Needs an ARV"}
          </em>
          {analysis.arv != null && (
            <label className="agent-arv-rehab">
              <span>Renovation estimate</span>
              <span className="agent-arv-rehab-input">
                <i>$</i>
                <input inputMode="numeric" value={rehabText} placeholder="e.g. 45,000" aria-label="Renovation estimate" onChange={(event) => setRehabText(event.target.value.replace(/[^\d,.]/g, ""))} />
              </span>
              <small>{edited ? "Your number" : analysis.rehabSource ? `From ${analysis.rehabSource}` : "Not on file: type it to get the maximum offer"}</small>
            </label>
          )}
        </div>
        {compare && (
          <div className={compare.gap > 0 ? "agent-arv-compare is-over" : "agent-arv-compare is-under"}>
            <small>{compare.label}</small>
            <b>{cash(compare.price)}</b>
            <em>{compare.text}</em>
          </div>
        )}
      </div>
      {analysis.search && (
        <p className="agent-arv-source">
          Comps from <a href={analysis.search.url} target="_blank" rel="noreferrer">{analysis.search.site} sold houses in {analysis.search.zip}</a>
          {analysis.search.neighbors?.length ? ` and ${analysis.search.neighbors.join(", ")}` : ""}, last {analysis.search.months} months · {analysis.search.found} found, {analysis.search.checked} checked
        </p>
      )}
      {!analysis.ready && <p className="agent-arv-warn">{analysis.summary}</p>}
      {analysis.used.length > 0 && (
        <div className="agent-arv-table-wrap">
          <table className="agent-arv-table">
            <thead>
              <tr><th>Comp</th><th>Sold for</th><th>Adjustment</th><th>Price used</th><th>Sq ft</th><th>Bd/Ba</th><th>Distance</th><th>Sold</th></tr>
            </thead>
            <tbody>
              {analysis.used.map((comp) => (
                <tr key={comp.address}>
                  <td>
                    {comp.url ? <a href={comp.url} target="_blank" rel="noreferrer">{comp.address}</a> : comp.address}
                    {comp.flags?.length > 0 && <span className="agent-arv-flags">{comp.flags.map((flag) => <i key={flag}>{flag}</i>)}</span>}
                  </td>
                  <td>{cash(comp.salePrice)}</td>
                  <td>{adjustmentText(comp)}</td>
                  <td><b>{cash(comp.adjustedPrice)}</b></td>
                  <td>{comp.sqft?.toLocaleString("en-US") ?? "—"}</td>
                  <td>{comp.beds}/{comp.baths}</td>
                  <td>{comp.distanceMiles == null ? "—" : comp.distanceMiles < 0.1 ? "Under 0.1 mi" : `${comp.distanceMiles} mi`}</td>
                  <td>{shortDay(comp.saleDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {analysis.math && <p className="agent-arv-math">{analysis.math}{maxOffer != null ? <><br />{cash(analysis.arv)} x 0.70 - {cash(rehab)} = {cash(maxOffer)}</> : null}</p>}
      {analysis.skipped.length > 0 && (
        <details className="agent-arv-skipped">
          <summary>{analysis.skipped.length} skipped</summary>
          <ul>
            {analysis.skipped.map((comp, index) => (
              <li key={`${comp.address}-${index}`}>
                <b>{comp.url ? <a href={comp.url} target="_blank" rel="noreferrer">{comp.address || "No address"}</a> : comp.address || "No address"}</b>
                {comp.salePrice ? ` · ${cash(comp.salePrice)}` : ""}{comp.sqft ? ` · ${comp.sqft.toLocaleString("en-US")} sq ft` : ""} — {comp.reasons.join("; ")}
              </li>
            ))}
          </ul>
        </details>
      )}
      {error && <p className="agent-arv-warn">{error}</p>}
      <footer className="agent-draft-foot">
        {saving && saving !== "saving" && <span className="agent-arv-saved">{saving} <Link href={`/properties/${analysis.propertyId}?tab=arv`}>Open the ARV tab</Link></span>}
        <button type="button" className="agent-draft-copy" onClick={() => copy(compLog(analysis, rehab))}>
          <Icon name={copied === "yes" ? "tick" : "copy"} size={14} /> {copied === "yes" ? "Copied" : copied === "no" ? "Couldn't Copy" : "Copy Comp Log"}
        </button>
        {canSave && (
          <button type="button" className="agent-arv-save" disabled={Boolean(saving)} onClick={save}>
            <Icon name="check" size={14} /> {saving === "saving" ? "Saving…" : saving ? "Saved" : "Save To ARV Tab"}
          </button>
        )}
      </footer>
    </section>
  )
}

export function formatAgentDuration(ms) {
  const seconds = Math.max(1, Math.round((Number(ms) || 0) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const rest = seconds % 60
  return rest ? `${minutes}m ${rest}s` : `${minutes}m`
}

function stepText(toolResult) {
  const name = toolResult.UsedTool
  const result = toolResult.result || {}
  if (result.success === false) return { verb: "Could not finish", detail: result.error || STATUS_LABELS[name] || name, failed: true }
  const title = result.title || ""
  if (name === "portfolio_summary") return { verb: "Read", detail: "portfolio totals" }
  if (name === "get_property") return { verb: "Opened", detail: title }
  if (name === "arv_analysis") return { verb: "Worked out", detail: title }
  if (name === "upcoming_payments") return { verb: "Checked", detail: title }
  if (name === "web_search") return { verb: "Searched the web for", detail: `“${result.query || ""}” · ${title}` }
  if (name === "read_webpage") return { verb: result.extracted ? "Pulled details from" : "Visited", detail: title || result.url || "a web page" }
  if (name === "search_records") return { verb: "Searched records for", detail: `“${result.query || ""}” · ${title}` }
  return { verb: "Read", detail: title || STATUS_LABELS[name] || name }
}

function AgentRunBanner({ durationMs }) {
  return (
    <div className="agent-run-banner">
      <i />
      <span>Worked for {formatAgentDuration(durationMs)}</span>
      <i />
    </div>
  )
}

function StepsChip({ steps }) {
  const [open, setOpen] = useState(false)
  if (!steps.length) return null
  if (steps.length === 1) {
    const step = stepText(steps[0])
    return (
      <div className="agent-chip">
        <div className={step.failed ? "agent-chip-line is-failed" : "agent-chip-line"}><span>{step.verb}</span> {step.detail}</div>
      </div>
    )
  }
  return (
    <div className="agent-chip">
      <button type="button" className="agent-chip-toggle" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <span>Checked {steps.length} sources</span>
        <Icon name="chevron" size={12} />
      </button>
      {open && (
        <div className="agent-chip-list">
          {steps.map((item, index) => {
            const step = stepText(item)
            return (
              <div key={index} className={step.failed ? "agent-chip-line is-failed" : "agent-chip-line"}>
                <span>{step.verb}</span> {step.detail}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

export function TasksCard({ todos }) {
  const active = todos.filter((todo) => todo.status !== "completed" && todo.status !== "cancelled").length
  return (
    <div className="agent-tasks">
      <p>Tasks · {active} active · {todos.length} total</p>
      <ul>
        {todos.map((todo) => (
          <li key={todo.id || todo.content}>
            <span className="agent-task-mark">{todo.status === "completed" ? "✓" : todo.status === "in_progress" ? "…" : todo.status === "cancelled" ? "–" : "○"}</span>
            <span className={todo.status === "completed" || todo.status === "cancelled" ? "is-done" : undefined}>{todo.content}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function UserPrompt({ text }) {
  const ref = useRef(null)
  const [collapsible, setCollapsible] = useState(false)
  const [expanded, setExpanded] = useState(false)

  useLayoutEffect(() => {
    if (ref.current) setCollapsible(ref.current.scrollHeight > 100)
  }, [text])

  const body = <p ref={ref} className={collapsible ? (expanded ? "agent-prompt-text is-open" : "agent-prompt-text is-clamped") : "agent-prompt-text"}>{text}</p>
  return (
    <div className="agent-prompt-card">
      <div className="agent-prompt-body">
        {collapsible ? (
          <div
            className="agent-prompt-collapse"
            role="button"
            tabIndex={0}
            aria-expanded={expanded}
            style={{ maxHeight: expanded ? 4000 : 100 }}
            onClick={() => setExpanded((current) => !current)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault()
                setExpanded((current) => !current)
              }
            }}
          >
            {body}
            <span className="agent-prompt-chevron"><Icon name="chevron" size={12} /></span>
          </div>
        ) : body}
      </div>
      <div className="agent-prompt-rule" aria-hidden="true" />
    </div>
  )
}

function lastTodos(rows) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const todos = rows[index].toolResult?.UsedTool === "todo_write" ? rows[index].toolResult.result?.metadata?.todos : null
    if (todos?.length) return todos
  }
  return []
}

function groupTurns(rows) {
  const turns = []
  for (const row of rows) {
    if (row.role === "user") turns.push({ user: row, replies: [] })
    else if (turns.length) turns[turns.length - 1].replies.push(row)
    else turns.push({ user: null, replies: [row] })
  }
  return turns
}

function Shimmer({ rows, showHeader }) {
  const last = rows[rows.length - 1]
  const tool = last?.toolResult?.UsedTool
  const result = last?.toolResult?.result || {}
  const text = tool === "status" ? result.title || "" : (tool && STATUS_LABELS[tool]) || ""
  const info = tool === "web_search" ? result.query : tool === "read_webpage" ? result.url : ""
  return (
    <div className="agent-shimmer">
      {showHeader && <p className="agent-label">{AGENT_NAME}</p>}
      <p className="agent-shimmer-text">
        {text && <span className="agent-pulse">{text}</span>}
        {!text && (
          <span className="agent-dots" aria-label="Working">
            <span>.</span><span>.</span><span>.</span>
          </span>
        )}
      </p>
      {info && (
        <p className="agent-shimmer-info">
          {tool === "web_search" ? "Searching: " : "Visiting: "}
          <span>{info}</span>
        </p>
      )}
    </div>
  )
}

export function AgentMessages({ rows, streaming, emptyHint }) {
  const endRef = useRef(null)

  useEffect(() => {
    const timer = setTimeout(() => endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" }), 100)
    return () => clearTimeout(timer)
  }, [rows, streaming])

  const turns = groupTurns(rows)
  if (!rows.length && !streaming) {
    return (
      <div className="agent-empty">
        <p>Say hi to the agent</p>
        <span>{emptyHint}</span>
      </div>
    )
  }

  return (
    <div className="agent-list">
      {turns.map((turn, turnIndex) => {
        const live = streaming && turnIndex === turns.length - 1
        const steps = turn.replies.filter((row) => row.toolResult && !HIDDEN_STEPS.has(row.toolResult.UsedTool))
        const texts = turn.replies.filter((row) => !row.toolResult && row.content)
        const todos = lastTodos(turn.replies)
        const finalRow = [...turn.replies].reverse().find((row) => !row.toolResult && row.content)
        const visible = steps.length > 0 || texts.length > 0 || todos.length > 0
        return (
          <div key={turn.user?.id || `lead-${turnIndex}`} className="agent-turn">
            {turn.user && (
              <div className="agent-prompt-sticky" style={{ zIndex: 10 + (turns.length - turnIndex) }}>
                <UserPrompt text={turn.user.content} />
              </div>
            )}
            <div className="agent-replies">
              {visible && <p className="agent-label">{AGENT_NAME}</p>}
              {steps.length > 0 && <StepsChip steps={steps.map((row) => row.toolResult)} />}
              {todos.length > 0 && <TasksCard todos={todos} />}
              {texts.map((row) => (
                <div key={row.id} className="agent-reply">
                  {row === finalRow && !live && row.agentRun?.durationMs != null && <AgentRunBanner durationMs={row.agentRun.durationMs} />}
                  {row.error ? (
                    <p className="agent-error">{row.content}</p>
                  ) : (
                    <AgentAnswer content={row.content} />
                  )}
                </div>
              ))}
              {!live && arvOf(turn.replies) && <ArvCard key={`arv-${turn.user?.id || turnIndex}`} analysis={arvOf(turn.replies)} />}
              {live && <Shimmer rows={turn.replies} showHeader={!visible} />}
            </div>
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
