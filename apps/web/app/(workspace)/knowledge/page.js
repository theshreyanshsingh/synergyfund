"use client"

import { Suspense, useEffect, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { AgentComposer } from "../../../components/agent/AgentComposer"
import { AgentMessages } from "../../../components/agent/AgentMessages"
import { AgentWelcome } from "../../../components/agent/AgentWelcome"
import { MemoryPanel } from "../../../components/agent/MemoryPanel"
import { chatWhen, useAgentChat } from "../../../components/agent/useAgentChat"
import { Icon } from "../../../components/ui/Icon"
import { RowMenu } from "../../../components/ui/RowMenu"
import { PageSpinner } from "../../../components/ui/Spinner"
import { useApi } from "../../../lib/useApi"

const PANEL_KEY = "synergifund-agent-panel"
const NARROW = "(max-width: 900px)"
const RECENTS = 10

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]
const REPEATS = [["", "Never"], ["day", "Every day"], ["weekday", "Weekdays"], ["week", "Every week"], ["month", "Every month"]]

export default function AgentPage() {
  return (
    <Suspense fallback={<PageSpinner />}>
      <Agent />
    </Suspense>
  )
}

// The Agent: a panel of chats and prompts on the left (it folds away; on narrow screens it opens over the chat), and
// the chat in one centered column. A new chat is a big greeting with the box under it. ?chat= (a notification's link)
// opens that chat.
function Agent() {
  const router = useRouter()
  const linked = useSearchParams().get("chat") || ""
  const chat = useAgentChat({ openId: linked })
  const [view, setView] = useState("chat")
  const [query, setQuery] = useState("")
  const [panel, setPanel] = useState(true)
  const [drawer, setDrawer] = useState(false)
  const [fill, setFill] = useState(null)
  const [renaming, setRenaming] = useState(false)

  useEffect(() => {
    try {
      if (localStorage.getItem(PANEL_KEY) === "closed") setPanel(false)
    } catch {}
  }, [])

  // The linked chat is open (or opening): the address goes back to plain /knowledge, so a reload keeps what's open.
  useEffect(() => {
    if (!linked) return
    setView("chat")
    setDrawer(false)
    router.replace("/knowledge", { scroll: false })
  }, [linked, router])

  function togglePanel() {
    if (window.matchMedia(NARROW).matches) {
      setDrawer((open) => !open)
      return
    }
    const next = !panel
    setPanel(next)
    try {
      localStorage.setItem(PANEL_KEY, next ? "open" : "closed")
    } catch {}
  }

  const go = (next) => {
    setView(next)
    setDrawer(false)
  }
  const startNew = () => {
    chat.newChat()
    go("chat")
  }
  const open = (id) => {
    chat.openThread(id)
    go("chat")
  }
  const use = (text) => {
    go("chat")
    setFill({ text, key: Date.now() })
  }
  const starred = (text) => chat.prompts.some((prompt) => prompt.text === String(text || "").trim())
  const star = async (text) => {
    if (starred(text)) return
    try {
      await chat.savePrompt(text)
    } catch (err) {
      window.alert(err.message)
    }
  }
  const empty = !chat.rows.length && !chat.streaming && !chat.opening
  const canRename = view === "chat" && Boolean(chat.threadId) && !chat.temporary

  return (
    <div className={["agent-page", panel ? "" : "is-folded", drawer ? "is-drawer" : ""].filter(Boolean).join(" ")}>
      <AgentPanel chat={chat} view={view} query={query} onQuery={(value) => { setQuery(value); go("chats") }} onNew={startNew} onView={go} onOpen={open} onFold={togglePanel} />
      <button type="button" className="agent-panel-scrim" aria-label="Close the chat list" onClick={() => setDrawer(false)} />
      <section className="agent-main">
        <div className="workspace-top agent-top">
          <button type="button" className="agent-icon-button agent-panel-open" onClick={togglePanel} aria-label="Show chats and prompts" title="Show chats and prompts">
            <Icon name="panel" size={18} />
          </button>
          <div className="page-heading">
            {view !== "chat" ? (
              <h1 className="page-title agent-title">{view === "chats" ? "Chats" : view === "prompts" ? "Prompts" : "Memory"}</h1>
            ) : renaming && canRename ? (
              <TitleEditor title={chat.chatTitle} onDone={async (name) => {
                setRenaming(false)
                if (name && name !== chat.chatTitle) await chat.renameThread(chat.threadId, name).catch((err) => window.alert(err.message))
              }} />
            ) : canRename ? (
              <h1 className="page-title agent-title">
                <button type="button" className="agent-title-button" onClick={() => setRenaming(true)} title="Rename this chat">{chat.chatTitle}</button>
              </h1>
            ) : (
              <h1 className="page-title agent-title">{chat.chatTitle}</h1>
            )}
          </div>
          <div className="agent-head-actions">
            <button
              type="button"
              className={chat.temporary ? "import-button agent-temp-toggle is-on" : "import-button agent-temp-toggle"}
              aria-pressed={chat.temporary}
              disabled={chat.streaming}
              title={chat.temporary ? "Leave the temporary chat" : "Start a chat that is not saved to History"}
              onClick={() => { chat.toggleTemporary(); go("chat") }}
            >
              <Icon name="tempChat" size={14} />
              <span className="agent-history-label">Temporary</span>
            </button>
            <button type="button" className="primary" disabled={chat.streaming} onClick={startNew}>
              <Icon name="plus" size={14} />
              New chat
            </button>
          </div>
        </div>

        {view === "chat" && (
          <div className={empty ? "agent-chat is-empty" : "agent-chat"}>
            <div className="agent-scroll">
              <div className="agent-column">
                {chat.error && <div className="banner">{chat.error}</div>}
                {chat.opening ? (
                  <PageSpinner />
                ) : (
                  <AgentMessages
                    rows={chat.rows}
                    streaming={chat.streaming}
                    threadId={chat.threadId}
                    title={chat.chatTitle}
                    empty={<AgentWelcome key={`${chat.threadId}-${chat.temporary}`} temporary={chat.temporary} />}
                    onRetry={chat.retry}
                    onEdit={chat.edit}
                    onMemory={() => go("memory")}
                    onRate={chat.rate}
                    onStar={star}
                    starred={starred}
                  />
                )}
              </div>
            </div>
            <div className="agent-column agent-dock-box">
              <AgentComposer onSend={chat.send} streaming={chat.streaming} connected={chat.connected} temporary={chat.temporary} fill={fill} blocked={chat.budgetMessage} />
            </div>
          </div>
        )}
        {view === "chats" && <ChatsView chat={chat} query={query} onQuery={setQuery} onOpen={open} />}
        {view === "prompts" && <PromptsView chat={chat} onUse={use} onOpen={open} />}
        {view === "memory" && <MemoryPanel onOpen={open} />}
      </section>
    </div>
  )
}

// The chat's name, being renamed: Enter or leaving the box saves, Escape keeps the old one.
function TitleEditor({ title, onDone }) {
  const [value, setValue] = useState(title)
  const done = useRef(false)
  const finish = (name) => {
    if (done.current) return
    done.current = true
    onDone(name)
  }
  return (
    <input
      className="agent-title-input"
      value={value}
      autoFocus
      maxLength={80}
      aria-label="Chat name"
      onChange={(event) => setValue(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={() => finish(value.trim())}
      onKeyDown={(event) => {
        if (event.key === "Enter") finish(value.trim())
        if (event.key === "Escape") finish("")
      }}
    />
  )
}

// The left panel: search, New chat, Chats, Prompts, Memory, then pinned chats and the last few. Each chat's ⋯: Rename,
// Pin, Delete.
function AgentPanel({ chat, view, query, onQuery, onNew, onView, onOpen, onFold }) {
  const pinned = chat.threads.filter((thread) => thread.pinned)
  const recents = chat.threads.filter((thread) => !thread.pinned).slice(0, RECENTS)
  return (
    <aside className="agent-panel" aria-label="Chats and prompts">
      <div className="agent-panel-head">
        <span>Agent</span>
        <button type="button" className="agent-icon-button" onClick={onFold} aria-label="Hide chats and prompts" title="Hide chats and prompts">
          <Icon name="panel" size={18} />
        </button>
      </div>
      <label className="agent-panel-search">
        <Icon name="search" size={15} />
        <span className="sr-only">Search chats</span>
        <input type="search" value={query} placeholder="Search chats" onChange={(event) => onQuery(event.target.value)} />
      </label>
      <nav className="agent-panel-nav">
        <button type="button" onClick={onNew} disabled={chat.streaming}><Icon name="plus" size={16} /> New chat</button>
        <button type="button" className={view === "chats" ? "is-on" : ""} onClick={() => onView("chats")}><Icon name="history" size={16} /> Chats</button>
        <button type="button" className={view === "prompts" ? "is-on" : ""} onClick={() => onView("prompts")}><Icon name="starLine" size={16} /> Prompts</button>
        <button type="button" className={view === "memory" ? "is-on" : ""} onClick={() => onView("memory")}><Icon name="person" size={16} /> Memory</button>
      </nav>
      <div className="agent-panel-scroll">
        {pinned.length > 0 && (
          <>
            <p className="agent-panel-label">Pinned</p>
            <ul className="agent-panel-list">{pinned.map((thread) => <ChatItem key={thread.id} thread={thread} chat={chat} active={view === "chat" && thread.id === chat.threadId} onOpen={onOpen} />)}</ul>
          </>
        )}
        <p className="agent-panel-label">Recents</p>
        {recents.length ? (
          <ul className="agent-panel-list">{recents.map((thread) => <ChatItem key={thread.id} thread={thread} chat={chat} active={view === "chat" && thread.id === chat.threadId} onOpen={onOpen} />)}</ul>
        ) : (
          <p className="agent-panel-none">{chat.threadsLoaded ? (pinned.length ? "No other chats yet." : "No chats yet.") : "Loading…"}</p>
        )}
      </div>
    </aside>
  )
}

// One chat in a list: click to open; ⋯ on hover for Rename, Pin and Delete. `wide` is the full Chats list.
function ChatItem({ thread, chat, active, onOpen, wide = false }) {
  const [renaming, setRenaming] = useState(false)
  if (renaming) {
    return (
      <li className="agent-chat-item is-renaming">
        <TitleEditor title={thread.title} onDone={async (name) => {
          setRenaming(false)
          if (name && name !== thread.title) await chat.renameThread(thread.id, name).catch((err) => window.alert(err.message))
        }} />
      </li>
    )
  }
  return (
    <li className={active ? "agent-chat-item is-on" : "agent-chat-item"}>
      <button type="button" className="agent-chat-item-open" onClick={() => onOpen(thread.id)} title={thread.title}>
        {thread.pinned && <Icon name="star" size={12} />}
        <span>{thread.title}</span>
        {wide && <small>{chatWhen(thread.updatedAt)}</small>}
      </button>
      <RowMenu
        label={`More for ${thread.title}`}
        className="keep-case"
        items={[
          { label: "Rename", onClick: () => setRenaming(true) },
          { label: thread.pinned ? "Unpin" : "Pin", onClick: () => chat.pinThread(thread.id, !thread.pinned).catch((err) => window.alert(err.message)) },
          { label: "Delete", danger: true, divider: true, onClick: () => chat.deleteThread(thread) },
        ]}
      />
    </li>
  )
}

// Every past chat, searched by title and what was said.
function ChatsView({ chat, query, onQuery, onOpen }) {
  const [needle, setNeedle] = useState(query.trim())
  useEffect(() => {
    const timer = setTimeout(() => setNeedle(query.trim()), 250)
    return () => clearTimeout(timer)
  }, [query])
  const found = useApi(needle ? `/agent/threads?q=${encodeURIComponent(needle)}` : null)
  // The found chats as the list has them now, so renames, pins and deletes made here show at once.
  const all = needle ? (found.data?.items || []).flatMap((item) => chat.threads.filter((thread) => thread.id === item.id)) : chat.threads
  const loading = needle ? !found.data && !found.error : !chat.threadsLoaded
  return (
    <div className="agent-page-list">
      <div className="agent-column">
        <label className="agent-list-search">
          <Icon name="search" size={16} />
          <span className="sr-only">Search chats</span>
          <input type="search" value={query} placeholder="Search your chats" onChange={(event) => onQuery(event.target.value)} autoFocus />
        </label>
        <p className="agent-list-count">{loading ? "Loading…" : needle ? `${all.length} ${all.length === 1 ? "chat" : "chats"} with “${needle}”` : `${all.length} ${all.length === 1 ? "chat" : "chats"}`}</p>
        {found.error && <p className="banner">{found.error}</p>}
        {!loading && !all.length ? (
          <p className="agent-panel-none">{needle ? "No chats match that." : "No chats yet. Ask the Agent something to start one."}</p>
        ) : (
          <ul className="agent-panel-list is-wide">{all.map((thread) => <ChatItem key={thread.id} thread={thread} chat={chat} active={false} onOpen={onOpen} wide />)}</ul>
        )}
      </div>
    </div>
  )
}

function hourLabel(hour) {
  return `${hour % 12 || 12} ${hour < 12 ? "AM" : "PM"}`
}

function ordinal(day) {
  const tens = day % 100
  const suffix = tens >= 11 && tens <= 13 ? "th" : ["th", "st", "nd", "rd"][day % 10] || "th"
  return `${day}${suffix}`
}

// "Every Monday at 8 AM Eastern Time".
function repeatLabel(repeat, zone) {
  const at = `at ${hourLabel(repeat.hour)}${zone ? ` ${zone}` : ""}`
  if (repeat.every === "week") return `Every ${WEEKDAYS[repeat.day]} ${at}`
  if (repeat.every === "month") return `Every month on the ${ordinal(repeat.day)} ${at}`
  if (repeat.every === "weekday") return `Weekdays ${at}`
  return `Every day ${at}`
}

// The brief first, then the prompts that repeat, then the rest (newest first within each).
function promptOrder(prompts) {
  const rank = (prompt) => (prompt.brief ? 0 : prompt.repeat ? 1 : 2)
  return [...prompts].sort((left, right) => rank(left) - rank(right))
}

// Saved prompts: New, and for each Use (into the box), Edit, Delete. The star under an answer saves its question here.
// A prompt can repeat: the Agent asks it on its own and leaves the answer in a new chat (the weekly brief is one).
function PromptsView({ chat, onUse, onOpen }) {
  const [adding, setAdding] = useState(false)
  const [editing, setEditing] = useState("")
  const [error, setError] = useState("")
  const [turningOn, setTurningOn] = useState(false)
  const save = async (id, text, repeat) => {
    setError("")
    try {
      if (id) await chat.updatePrompt(id, { text, repeat })
      else await chat.savePrompt(text, repeat?.every ? repeat : undefined)
      setAdding(false)
      setEditing("")
    } catch (err) {
      setError(err.message)
    }
  }
  const turnOnBrief = async () => {
    setError("")
    setTurningOn(true)
    try {
      await chat.turnOnBrief()
    } catch (err) {
      setError(err.message)
    } finally {
      setTurningOn(false)
    }
  }
  const remove = async (prompt) => {
    if (!window.confirm("Delete this prompt?")) return
    setError("")
    try {
      await chat.deletePrompt(prompt.id)
    } catch (err) {
      setError(err.message)
    }
  }
  return (
    <div className="agent-page-list">
      <div className="agent-column">
        <div className="agent-prompts-head">
          <p>Questions you ask often, ready to use in any chat. The Agent can also ask one on its own, and leave the answer in a new chat.</p>
          <button type="button" className="primary" onClick={() => { setAdding(true); setEditing("") }} disabled={adding}><Icon name="plus" size={14} /> New</button>
        </div>
        {error && <p className="banner">{error}</p>}
        {chat.briefOffered && (
          <div className="agent-brief-offer">
            <span className="agent-brief-icon"><Icon name="spark" size={18} /></span>
            <div>
              <strong>Weekly brief</strong>
              <p>Every Monday at 8 AM the Agent looks over what's due in the next two weeks, draws waiting for funding, loans maturing soon, your tasks and records that look wrong, and leaves the brief in a new chat. You get a notification.</p>
            </div>
            <button type="button" className="primary" onClick={turnOnBrief} disabled={turningOn}>{turningOn ? "Turning on…" : "Turn on"}</button>
          </div>
        )}
        {adding && <PromptEditor zone={chat.promptZone} onCancel={() => setAdding(false)} onSave={(text, repeat) => save("", text, repeat)} />}
        {!chat.promptsLoaded ? <p className="agent-panel-none">Loading…</p> : !chat.prompts.length && !adding ? (
          <p className="agent-panel-none">No saved prompts yet. Press New, or the star under an answer to save the question you asked.</p>
        ) : (
          <ul className="agent-prompt-list">
            {promptOrder(chat.prompts).map((prompt) => (
              <li key={prompt.id} className="agent-prompt-item">
                {editing === prompt.id ? (
                  <PromptEditor text={prompt.text} repeat={prompt.repeat} zone={chat.promptZone} onCancel={() => setEditing("")} onSave={(text, repeat) => save(prompt.id, text, repeat)} />
                ) : (
                  <>
                    {prompt.brief && <strong className="agent-prompt-name">{prompt.name}</strong>}
                    <p>{prompt.text}</p>
                    {prompt.repeat && (
                      <div className="agent-prompt-repeat">
                        <Icon name="calendar" size={14} />
                        <span>{repeatLabel(prompt.repeat, chat.promptZone)}</span>
                        {prompt.lastRun?.chatId && (
                          <button type="button" className="agent-prompt-last" onClick={() => onOpen(prompt.lastRun.chatId)}>Last answer {chatWhen(prompt.lastRun.at)}</button>
                        )}
                      </div>
                    )}
                    {prompt.repeat && prompt.lastRun?.error && <p className="agent-prompt-problem">{prompt.lastRun.error}</p>}
                    <div className="agent-prompt-actions">
                      <button type="button" className="import-button" onClick={() => onUse(prompt.text)}>Use</button>
                      <button type="button" className="tool" onClick={() => { setEditing(prompt.id); setAdding(false) }}>Edit</button>
                      <button type="button" className="tool agent-prompt-delete" onClick={() => remove(prompt)}>Delete</button>
                    </div>
                  </>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

// The prompt's words, and Repeat: never, every day, weekdays, a day of the week or a date of the month, at an hour on
// the team's clock (`zone`).
function PromptEditor({ text = "", repeat = null, zone = "", onCancel, onSave }) {
  const [value, setValue] = useState(text)
  const [every, setEvery] = useState(repeat?.every || "")
  const [weekday, setWeekday] = useState(repeat?.every === "week" ? repeat.day : 1)
  const [date, setDate] = useState(repeat?.every === "month" ? repeat.day : 1)
  const [hour, setHour] = useState(repeat?.hour ?? 8)
  const chosen = () => {
    if (!every) return { every: "" }
    if (every === "week") return { every, day: weekday, hour }
    if (every === "month") return { every, day: date, hour }
    return { every, hour }
  }
  return (
    <form className="agent-prompt-editor" onSubmit={(event) => { event.preventDefault(); if (value.trim()) onSave(value.trim(), chosen()) }}>
      <textarea value={value} onChange={(event) => setValue(event.target.value)} rows={3} maxLength={10000} placeholder="Write the prompt, e.g. Which loans mature in the next 90 days?" aria-label="Prompt" autoFocus />
      <div className="agent-prompt-when">
        <label>
          <span>Repeat</span>
          <select value={every} onChange={(event) => setEvery(event.target.value)}>
            {REPEATS.map(([id, label]) => <option key={id} value={id}>{label}</option>)}
          </select>
        </label>
        {every === "week" && (
          <label>
            <span>On</span>
            <select value={weekday} onChange={(event) => setWeekday(Number(event.target.value))}>
              {WEEKDAYS.map((name, index) => <option key={name} value={index}>{name}</option>)}
            </select>
          </label>
        )}
        {every === "month" && (
          <label>
            <span>On the</span>
            <select value={date} onChange={(event) => setDate(Number(event.target.value))}>
              {Array.from({ length: 28 }, (_, index) => <option key={index} value={index + 1}>{ordinal(index + 1)}</option>)}
            </select>
          </label>
        )}
        {every && (
          <label>
            <span>At</span>
            <select value={hour} onChange={(event) => setHour(Number(event.target.value))}>
              {Array.from({ length: 24 }, (_, index) => <option key={index} value={index}>{hourLabel(index)}</option>)}
            </select>
            {zone && <small>{zone}</small>}
          </label>
        )}
      </div>
      {every && <p className="agent-prompt-hint">The Agent asks it on its own and leaves the answer in a new chat. You get a notification when it's ready.</p>}
      <div className="agent-prompt-actions">
        <button type="button" className="tool" onClick={onCancel}>Cancel</button>
        <button type="submit" className="primary" disabled={!value.trim()}>Save</button>
      </div>
    </form>
  )
}
