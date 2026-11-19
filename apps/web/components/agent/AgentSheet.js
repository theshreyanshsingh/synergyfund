"use client"

import { useEffect, useRef, useState } from "react"
import { AgentComposer } from "./AgentComposer"
import { AgentMessages } from "./AgentMessages"
import { AgentBottomSheet, AgentToasts } from "./AgentSheets"
import { AgentWelcome } from "./AgentWelcome"
import { KnowledgePanel } from "./KnowledgePanel"
import { chatWhen, hasStoredThread, useAgentChat } from "./useAgentChat"
import { useAgentVoice } from "./useAgentVoice"
import { Icon } from "../ui/Icon"
import { PageSpinner } from "../ui/Spinner"

const SLIDE_MS = 240
const DELETE_WIDTH = 88

// Phones: the Agent slides up over the page you are on, to full height. X, a swipe down on its top bar, or the phone's
// Back closes it and leaves you where you were. A new chat is the greeting with Suggested questions, and Temporary
// chat (the dashed bubble, dark while on) beside ⋮. In a chat its name is beside X, with New chat (the pencil), Chats and
// ⋮ on the right; ⋮ has Chats, Prompts and Knowledge, each of which slides up as a sheet over the chat (and Temporary
// chat, in a chat that is kept). Under an answer: thumbs, Share, Copy and Retry. Talk (the round wave in the box) takes
// the whole sheet; closing the sheet ends it.
export function AgentSheet({ onClose }) {
  const chat = useAgentChat()
  const voice = useAgentVoice({ threadId: chat.threadId, temporary: chat.temporary, streaming: chat.streaming, onThread: chat.adoptThread, onRefresh: chat.refreshThread, onSpoken: chat.showSpoken })
  // The sheet over the chat: "chats", "prompts", "knowledge" or "".
  const [view, setView] = useState("")
  // Knowledge's tab: "team", or "you" (what the Agent remembers about this person).
  const [knowing, setKnowing] = useState("team")
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
      else if (!view) close()
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
    if (action === "new") { chat.newChat(); setView("") }
    if (action === "chats") setView("chats")
    if (action === "prompts") setView("prompts")
    if (action === "knowledge") { setKnowing("team"); setView("knowledge") }
    if (action === "temporary") { chat.toggleTemporary(); setView("") }
  }

  const pick = (prompt) => {
    setView("")
    setFill({ text: prompt.text, key: Date.now() })
  }
  // A suggested question is asked at once, or put in the box to finish.
  const suggest = (item) => {
    if (item.send) chat.send(item.text)
    else setFill({ text: item.fill || item.text, key: Date.now() })
  }
  const savedTitle = !chat.temporary && chat.threadId ? chat.chatTitle : ""
  const inChat = chat.rows.length > 0 || chat.streaming
  const style = { transform: shown ? `translateY(${drag}px)` : "translateY(100%)", transition: swipe.current ? "none" : undefined }
  const closeView = () => setView("")

  return (
    <section ref={sheetRef} className="agent-sheet" style={style} role="dialog" aria-modal="true" aria-label="Agent">
      <header className="agent-sheet-bar" {...bar}>
        <span className="agent-sheet-grip" aria-hidden="true" />
        <button type="button" className="agent-round is-soft" onClick={close} aria-label="Close Agent"><Icon name="close" size={19} /></button>
        <h2 className="agent-sheet-title">{chat.temporary ? "Temporary chat" : inChat ? savedTitle : ""}</h2>
        <div className="agent-sheet-tools" ref={menuRef}>
          {(!inChat || chat.temporary) && (
            <button type="button" className={chat.temporary ? "agent-round is-on" : "agent-round"} aria-pressed={chat.temporary} disabled={chat.streaming} onClick={() => choose("temporary")} aria-label={chat.temporary ? "Leave temporary chat" : "Temporary chat"} title={chat.temporary ? "Leave temporary chat" : "Temporary chat: not kept in Chats"}>
              <Icon name="tempChat" size={19} />
            </button>
          )}
          {inChat && !chat.temporary && (
            <>
              <button type="button" className="agent-round" disabled={chat.streaming} onClick={() => choose("new")} aria-label="New chat" title="New chat"><Icon name="edit" size={18} /></button>
              <button type="button" className="agent-round" onClick={() => choose("chats")} aria-label="Chats" title="Chats"><Icon name="chat" size={18} /></button>
            </>
          )}
          <button type="button" className="agent-round" onClick={() => setMenu((open) => !open)} aria-label="More" aria-haspopup="menu" aria-expanded={menu}><Icon name="kebab" size={19} /></button>
          {menu && (
            <div className="agent-sheet-menu" role="menu">
              {inChat && chat.temporary && <button type="button" role="menuitem" disabled={chat.streaming} onClick={() => choose("new")}><Icon name="edit" size={18} /> New chat</button>}
              <button type="button" role="menuitem" onClick={() => choose("chats")}><Icon name="chat" size={18} /> Chats</button>
              <button type="button" role="menuitem" onClick={() => choose("prompts")}><Icon name="starLine" size={18} /> Prompts</button>
              <button type="button" role="menuitem" onClick={() => choose("knowledge")}><Icon name="book" size={18} /> Knowledge</button>
              {inChat && !chat.temporary && <button type="button" role="menuitem" disabled={chat.streaming} onClick={() => choose("temporary")}><Icon name="tempChat" size={18} /> Temporary chat</button>}
            </div>
          )}
        </div>
      </header>

      <div className="agent-sheet-scroll">
        {chat.error && <div className="banner">{chat.error}</div>}
        {chat.opening ? <PageSpinner /> : (
          <AgentMessages
            rows={chat.rows}
            streaming={chat.streaming || voice.working}
            threadId={chat.threadId}
            title={chat.chatTitle}
            empty={<AgentWelcome key={`${chat.threadId}-${chat.temporary}`} temporary={chat.temporary} onSuggest={voice.on ? null : suggest} />}
            onRetry={voice.on ? null : chat.retry}
            onEdit={voice.on ? null : chat.edit}
            onMemory={() => { setKnowing("you"); setView("knowledge") }}
            onRate={chat.rate}
            onExplain={chat.explain}
            memos={false}
          />
        )}
      </div>
      <div className="agent-sheet-foot">
        <AgentToasts />
        <AgentComposer onSend={chat.send} streaming={chat.streaming} connected={chat.connected} temporary={chat.temporary} autoFocus={typeAway} fill={fill} placeholder="Ask Agent anything…" blocked={chat.budgetMessage} voice={voice} onPrompts={() => setView("prompts")} />
      </div>

      {view === "chats" && (
        <AgentBottomSheet title="Chats" onClose={closeView} className="agent-chats-sheet" action={<button type="button" className="agent-round" disabled={chat.streaming} onClick={() => choose("new")} aria-label="New chat" title="New chat"><Icon name="edit" size={18} /></button>}>
          <ChatList threads={chat.threads} activeId={chat.threadId} onOpen={(id) => { chat.openThread(id); setView("") }} onDelete={chat.deleteThread} />
        </AgentBottomSheet>
      )}
      {view === "prompts" && (
        <AgentBottomSheet title="Prompts" onClose={closeView}>
          {/* Saved prompts (made under Prompts on the Agent page). Tap one to put it in the box. */}
          {chat.prompts.length ? (
            <ul className="agent-sheet-list agent-prompts">
              {chat.prompts.map((prompt) => (
                <li key={prompt.id}>
                  <button type="button" onClick={() => pick(prompt)}>
                    <Icon name="suggest" size={16} />
                    <span>{prompt.text}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : (
            <p className="agent-sheet-none">{chat.promptsLoaded ? "No saved prompts yet. Save the questions you ask often under Prompts on the Agent page." : "Loading…"}</p>
          )}
        </AgentBottomSheet>
      )}
      {view === "knowledge" && (
        <AgentBottomSheet title="Knowledge" onClose={closeView} className="agent-knowledge-sheet">
          <div className="agent-sheet-memory"><KnowledgePanel tab={knowing} onOpen={(id) => { chat.openThread(id); setView("") }} /></div>
        </AgentBottomSheet>
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
        <span className="agent-chat-icon" aria-hidden="true"><Icon name="chat" size={17} /></span>
        <span className="agent-chat-text">
          <span className="agent-chat-title">{thread.title}</span>
          <small>{chatWhen(thread.updatedAt)}</small>
        </span>
      </button>
    </li>
  )
}
