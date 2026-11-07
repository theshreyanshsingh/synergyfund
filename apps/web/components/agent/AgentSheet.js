"use client"

import { useEffect, useRef, useState } from "react"
import { AgentComposer } from "./AgentComposer"
import { AgentMessages } from "./AgentMessages"
import { AgentWelcome } from "./AgentWelcome"
import { MemoryPanel } from "./MemoryPanel"
import { chatWhen, hasStoredThread, useAgentChat } from "./useAgentChat"
import { Icon } from "../ui/Icon"
import { PageSpinner } from "../ui/Spinner"

const SLIDE_MS = 240
const DELETE_WIDTH = 88

// Phones: the Agent slides up over the page you are on, to full height. X, a swipe down on its top bar, or the phone's
// Back closes it and leaves you where you were. ⋮ has New chat, Chats, Prompts, Memory and Temporary chat.
export function AgentSheet({ onClose }) {
  const chat = useAgentChat()
  const [view, setView] = useState("chat")
  const [menu, setMenu] = useState(false)
  const [fill, setFill] = useState(null)
  const [shown, setShown] = useState(false)
  const [drag, setDrag] = useState(0)
  // A new chat opens the keyboard at once; a chat reopened from before is shown to read first.
  const [typeAway] = useState(() => !hasStoredThread())
  const sheetRef = useRef(null)
  const menuRef = useRef(null)
  const swipe = useRef(null)
  const closing = useRef(false)

  function finish() {
    if (closing.current) return
    closing.current = true
    setShown(false)
    setTimeout(onClose, SLIDE_MS)
  }

  // The phone's Back closes the sheet rather than leaving the page under it.
  function close() {
    if (window.history.state?.agentSheet) window.history.back()
    else finish()
  }

  useEffect(() => {
    const frame = requestAnimationFrame(() => setShown(true))
    if (!window.history.state?.agentSheet) window.history.pushState({ ...window.history.state, agentSheet: true }, "")
    window.addEventListener("popstate", finish)
    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener("popstate", finish)
    }
  }, [])

  // With the keyboard up the sheet fits the space above it (iPhones keep the page the full height behind it).
  useEffect(() => {
    const viewport = window.visualViewport
    if (!viewport) return undefined
    const fit = () => {
      if (!sheetRef.current) return
      sheetRef.current.style.height = `${viewport.height}px`
      sheetRef.current.style.top = `${viewport.offsetTop}px`
    }
    fit()
    viewport.addEventListener("resize", fit)
    viewport.addEventListener("scroll", fit)
    return () => {
      viewport.removeEventListener("resize", fit)
      viewport.removeEventListener("scroll", fit)
    }
  }, [])

  useEffect(() => {
    if (!menu) return undefined
    const away = (event) => { if (!menuRef.current?.contains(event.target)) setMenu(false) }
    document.addEventListener("pointerdown", away)
    return () => document.removeEventListener("pointerdown", away)
  }, [menu])

  useEffect(() => {
    const onKey = (event) => {
      if (event.key !== "Escape") return
      if (menu) setMenu(false)
      else if (view !== "chat") setView("chat")
      else close()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [menu, view])

  const bar = {
    onTouchStart: (event) => { swipe.current = { y: event.touches[0].clientY, at: Date.now() } },
    onTouchMove: (event) => {
      if (!swipe.current) return
      setDrag(Math.max(0, event.touches[0].clientY - swipe.current.y))
    },
    onTouchEnd: () => {
      if (!swipe.current) return
      const quick = drag > 40 && Date.now() - swipe.current.at < 250
      swipe.current = null
      if (drag > 120 || quick) close()
      else setDrag(0)
    },
  }

  function choose(action) {
    setMenu(false)
    if (action === "new") { chat.newChat(); setView("chat") }
    if (action === "chats") setView("chats")
    if (action === "prompts") setView("prompts")
    if (action === "memory") setView("memory")
    if (action === "temporary") { chat.toggleTemporary(); setView("chat") }
  }

  const pick = (prompt) => {
    setView("chat")
    setFill({ text: prompt.text, key: Date.now() })
  }
  const starred = (text) => chat.prompts.some((prompt) => prompt.text === String(text || "").trim())
  const star = (text) => {
    if (!starred(text)) chat.savePrompt(text).catch((err) => window.alert(err.message))
  }
  const savedTitle = !chat.temporary && chat.threadId ? chat.chatTitle : ""
  const style = { transform: shown ? `translateY(${drag}px)` : "translateY(100%)", transition: swipe.current ? "none" : undefined }

  return (
    <section ref={sheetRef} className="agent-sheet" style={style} role="dialog" aria-modal="true" aria-label="Agent">
      <header className="agent-sheet-bar" {...bar}>
        <span className="agent-sheet-grip" aria-hidden="true" />
        {view === "chat" ? (
          <button type="button" className="agent-sheet-icon" onClick={close} aria-label="Close Agent"><Icon name="close" size={20} /></button>
        ) : (
          <button type="button" className="agent-sheet-icon" onClick={() => setView("chat")} aria-label="Back to the chat"><Icon name="back" size={20} /></button>
        )}
        <h2 className="agent-sheet-title">{view === "chats" ? "Chats" : view === "prompts" ? "Prompts" : view === "memory" ? "Memory" : chat.temporary ? "Temporary chat" : savedTitle}</h2>
        {view === "chat" ? (
          <div className="agent-sheet-more" ref={menuRef}>
            <button type="button" className="agent-sheet-icon" onClick={() => setMenu((open) => !open)} aria-label="More" aria-haspopup="menu" aria-expanded={menu}><Icon name="kebab" size={20} /></button>
            {menu && (
              <div className="agent-sheet-menu" role="menu">
                <button type="button" role="menuitem" disabled={chat.streaming} onClick={() => choose("new")}><Icon name="plus" size={18} /> New chat</button>
                <button type="button" role="menuitem" onClick={() => choose("chats")}><Icon name="history" size={18} /> Chats</button>
                <button type="button" role="menuitem" onClick={() => choose("prompts")}><Icon name="forward" size={18} /> Prompts</button>
                <button type="button" role="menuitem" onClick={() => choose("memory")}><Icon name="person" size={18} /> Memory</button>
                <button type="button" role="menuitem" disabled={chat.streaming} onClick={() => choose("temporary")}><Icon name="tempChat" size={18} /> {chat.temporary ? "Leave temporary chat" : "Temporary chat"}</button>
              </div>
            )}
          </div>
        ) : <span />}
      </header>

      {view === "chat" && (
        <>
          <div className="agent-sheet-scroll">
            {chat.error && <div className="banner">{chat.error}</div>}
            {chat.opening ? <PageSpinner /> : (
              <AgentMessages
                rows={chat.rows}
                streaming={chat.streaming}
                threadId={chat.threadId}
                title={chat.chatTitle}
                empty={<AgentWelcome key={`${chat.threadId}-${chat.temporary}`} temporary={chat.temporary} />}
                onRetry={chat.retry}
                onEdit={chat.edit}
                onMemory={() => setView("memory")}
                onRate={chat.rate}
                onStar={star}
                starred={starred}
              />
            )}
          </div>
          <AgentComposer onSend={chat.send} streaming={chat.streaming} connected={chat.connected} temporary={chat.temporary} autoFocus={typeAway} fill={fill} placeholder="Ask Agent anything…" blocked={chat.budgetMessage} />
        </>
      )}
      {view === "memory" && <div className="agent-sheet-memory"><MemoryPanel onOpen={(id) => { chat.openThread(id); setView("chat") }} /></div>}
      {view === "chats" && <ChatList threads={chat.threads} activeId={chat.threadId} onOpen={(id) => { chat.openThread(id); setView("chat") }} onDelete={chat.deleteThread} />}
      {view === "prompts" && (
        // Saved prompts (the star under an answer, or New on the Agent page). Tap one to put it in the box.
        chat.prompts.length ? (
          <ul className="agent-sheet-list agent-prompts">
            {chat.prompts.map((prompt) => (
              <li key={prompt.id}>
                <button type="button" onClick={() => pick(prompt)}>
                  <Icon name="forward" size={16} />
                  <span>{prompt.text}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="agent-sheet-none">{chat.promptsLoaded ? "No saved prompts yet. Tap the star under an answer to save the question you asked." : "Loading…"}</p>
        )
      )}
    </section>
  )
}

// Past chats with a search box. Tap one to open it; swipe it left for Delete.
function ChatList({ threads, activeId, onOpen, onDelete }) {
  const [query, setQuery] = useState("")
  const [openId, setOpenId] = useState("")
  const needle = query.trim().toLowerCase()
  const listed = threads.filter((thread) => !needle || String(thread.title || "").toLowerCase().includes(needle))
  return (
    <div className="agent-sheet-chats">
      <label className="agent-sheet-search">
        <Icon name="search" size={16} />
        <span className="sr-only">Search chats</span>
        <input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search chats" />
      </label>
      {listed.length === 0 ? (
        <p className="agent-sheet-none">{threads.length ? "No chats match that." : "No chats yet. Ask the Agent something to start one."}</p>
      ) : (
        <ul className="agent-sheet-list">
          {listed.map((thread) => (
            <ChatRow key={thread.id} thread={thread} active={thread.id === activeId} open={openId === thread.id} onSwipe={(open) => setOpenId(open ? thread.id : "")} onOpen={() => onOpen(thread.id)} onDelete={() => { setOpenId(""); onDelete(thread) }} />
          ))}
        </ul>
      )}
    </div>
  )
}

function ChatRow({ thread, active, open, onSwipe, onOpen, onDelete }) {
  const [offset, setOffset] = useState(null)
  const start = useRef(null)
  const moved = useRef(false)
  const base = open ? -DELETE_WIDTH : 0
  return (
    <li className="agent-chat-row">
      <button type="button" className="agent-chat-delete" onClick={onDelete} tabIndex={open ? 0 : -1} aria-hidden={!open}>
        <Icon name="trash" size={18} />
        <span>Delete</span>
      </button>
      <button
        type="button"
        className={active ? "agent-chat-open is-on" : "agent-chat-open"}
        style={{ transform: `translateX(${offset ?? base}px)`, transition: offset == null ? undefined : "none" }}
        onTouchStart={(event) => { start.current = { x: event.touches[0].clientX, y: event.touches[0].clientY }; moved.current = false }}
        onTouchMove={(event) => {
          if (!start.current) return
          const dx = event.touches[0].clientX - start.current.x
          const dy = event.touches[0].clientY - start.current.y
          if (!moved.current && (Math.abs(dx) < 8 || Math.abs(dy) > Math.abs(dx))) return
          moved.current = true
          setOffset(Math.min(0, Math.max(-DELETE_WIDTH, base + dx)))
        }}
        onTouchEnd={() => {
          if (moved.current) onSwipe((offset ?? base) < -DELETE_WIDTH / 2)
          start.current = null
          setOffset(null)
        }}
        onClick={() => {
          if (moved.current) { moved.current = false; return }
          if (open) onSwipe(false)
          else onOpen()
        }}
      >
        <span className="agent-chat-title">{thread.title}</span>
        <small>{chatWhen(thread.updatedAt)}</small>
      </button>
    </li>
  )
}
