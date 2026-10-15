"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Icon } from "../ui/Icon"

const AGENT_NAME = "SynergiFund"

const STATUS_LABELS = {
  todo_write: "Planning Next Moves",
  portfolio_summary: "Reading the portfolio",
  list_properties: "Reading properties",
  get_property: "Opening the property",
  list_loans: "Reading loans",
  list_lenders: "Reading lenders",
  list_draws: "Reading draws",
  upcoming_payments: "Checking upcoming payments",
  list_expenses: "Reading expenses",
  list_tasks: "Reading the to-do list",
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

function hastText(node) {
  if (!node) return ""
  if (node.type === "text") return node.value || ""
  return (node.children || []).map(hastText).join("")
}

// "To: a@b.com / Subject: … / (blank line) / body" → its parts. Headers end at the first blank line.
export function parseEmailDraft(text) {
  const lines = String(text || "").replace(/\r\n/g, "\n").replace(/\n+$/, "").split("\n")
  const draft = { to: "", cc: "", subject: "", body: "" }
  let index = 0
  while (index < lines.length) {
    const match = /^(to|cc|subject)\s*:\s*(.*)$/i.exec(lines[index])
    if (!match) break
    draft[match[1].toLowerCase()] = match[2].trim()
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
    try {
      await navigator.clipboard.writeText(text)
    } catch {
      const area = document.createElement("textarea")
      area.value = text
      area.style.position = "fixed"
      area.style.opacity = "0"
      document.body.appendChild(area)
      area.select()
      document.execCommand("copy")
      area.remove()
    }
    setCopied(true)
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setCopied(false), 1600)
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

function composeLinks({ to, cc, subject, body }) {
  const enc = encodeURIComponent
  const list = (value) => value.split(/[,;]/).map((item) => item.trim()).filter(Boolean)
  const mailto = new URLSearchParams()
  if (cc) mailto.set("cc", list(cc).join(","))
  if (subject) mailto.set("subject", subject)
  if (body) mailto.set("body", body)
  return {
    gmail: `https://mail.google.com/mail/?view=cm&fs=1&to=${enc(list(to).join(","))}${cc ? `&cc=${enc(list(cc).join(","))}` : ""}&su=${enc(subject)}&body=${enc(body)}`,
    outlook: `https://outlook.office.com/mail/deeplink/compose?to=${enc(list(to).join(","))}${cc ? `&cc=${enc(list(cc).join(","))}` : ""}&subject=${enc(subject)}&body=${enc(body)}`,
    // URLSearchParams writes spaces as "+", which mail apps show literally; mailto wants %20.
    app: `mailto:${list(to).map(enc).join(",")}?${mailto.toString().replace(/\+/g, "%20")}`,
  }
}

function withHeaders({ to, cc, subject, body }) {
  const head = [to && `To: ${to}`, cc && `Cc: ${cc}`, subject && `Subject: ${subject}`].filter(Boolean).join("\n")
  return head ? `${head}\n\n${body}` : body
}

function EmailDraft({ text }) {
  const parsed = parseEmailDraft(text)
  const [to, setTo] = useState(parsed.to)
  const [cc, setCc] = useState(parsed.cc)
  const [subject, setSubject] = useState(parsed.subject)
  const [body, setBody] = useState(parsed.body)
  const [menu, setMenu] = useState(false)
  const [copied, copy] = useCopy()
  const box = useRef(null)
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
  const links = composeLinks({ to, cc, subject, body })
  return (
    <section className="agent-draft agent-email" aria-label="Email draft">
      <header className="agent-draft-head">
        <span><Icon name="mail" size={15} /> Email draft</span>
        <small>Edit anything before you send it.</small>
      </header>
      <label className="agent-email-field">
        <span>To</span>
        <input value={to} onChange={(event) => setTo(event.target.value)} placeholder="Add an email address" inputMode="email" autoComplete="off" />
      </label>
      {cc && (
        <label className="agent-email-field">
          <span>Cc</span>
          <input value={cc} onChange={(event) => setCc(event.target.value)} autoComplete="off" />
        </label>
      )}
      <label className="agent-email-field">
        <span>Subject</span>
        <input value={subject} onChange={(event) => setSubject(event.target.value)} placeholder="Subject" />
      </label>
      <GrowingText value={body} onChange={setBody} label="Email body" />
      <footer className="agent-draft-foot">
        <button type="button" className="agent-draft-copy" onClick={() => copy(body)}>
          <Icon name={copied ? "tick" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
        </button>
        <div className="agent-send" ref={box}>
          <a className="agent-send-main" href={links.gmail} target="_blank" rel="noreferrer" title="Opens a Gmail draft with this filled in. Nothing is sent until you press Send there.">
            <Icon name="mail" size={14} /> Send via Gmail
          </a>
          <button type="button" className="agent-send-more" aria-label="Other ways to send" aria-expanded={menu} onClick={() => setMenu((open) => !open)}>
            <Icon name="chevron" size={12} />
          </button>
          {menu && (
            <div className="agent-send-menu" role="menu">
              <a role="menuitem" href={links.outlook} target="_blank" rel="noreferrer" onClick={() => setMenu(false)}>Send via Outlook</a>
              <a role="menuitem" href={links.app} onClick={() => setMenu(false)}>Open in my email app</a>
              <button type="button" role="menuitem" onClick={() => { copy(withHeaders({ to, cc, subject, body })); setMenu(false) }}>Copy with To and Subject</button>
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
          <Icon name={copied ? "tick" : "copy"} size={14} /> {copied ? "Copied" : "Copy"}
        </button>
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
                    <div className="agent-md">
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdown}>{row.content}</ReactMarkdown>
                    </div>
                  )}
                </div>
              ))}
              {live && <Shimmer rows={turn.replies} showHeader={!visible} />}
            </div>
          </div>
        )
      })}
      <div ref={endRef} />
    </div>
  )
}
