"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { chatTitleFromPrompt } from "@synergifund/shared"
import { AgentComposer } from "../../../components/agent/AgentComposer"
import { AgentMessages } from "../../../components/agent/AgentMessages"
import { Icon } from "../../../components/ui/Icon"
import { PageSpinner } from "../../../components/ui/Spinner"
import { api } from "../../../lib/api"
import { streamAgent, streamPayloadToAssistantParts } from "../../../lib/agentStream"
import { useApi } from "../../../lib/useApi"

const THREAD_KEY = "synergifund-agent-thread"

function rowId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function threadRows(messages) {
  return messages.flatMap((message) => {
    if (message.role === "user") return [{ id: message.id, role: "user", content: message.content }]
    const tools = (message.toolCalls || []).map((call, index) => ({
      id: `${message.id}-tool-${index}`,
      role: "assistant",
      content: "",
      toolResult: { UsedTool: call.tool, result: call.result },
    }))
    return [...tools, { id: message.id, role: "assistant", content: message.content, error: message.error, agentRun: { durationMs: message.agentRunDurationMs } }]
  })
}

function when(value) {
  if (!value) return ""
  const date = new Date(value)
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days < 1) return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (days < 7) return date.toLocaleDateString("en-US", { weekday: "short" })
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

function storeThread(id) {
  try {
    if (id) sessionStorage.setItem(THREAD_KEY, id)
    else sessionStorage.removeItem(THREAD_KEY)
  } catch {}
}

function History({ threads, activeId, onOpen, onDelete }) {
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    if (!open) return
    function onDown(event) {
      if (!ref.current?.contains(event.target)) setOpen(false)
    }
    function onKey(event) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("mousedown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("mousedown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [open])

  return (
    <div className="agent-history" ref={ref}>
      <button type="button" className="import-button" aria-expanded={open} onClick={() => setOpen((current) => !current)}>
        <Icon name="history" size={14} />
        <span className="agent-history-label">History</span>
      </button>
      {open && (
        <div className="agent-history-menu">
          {threads.length === 0 && <p className="agent-history-empty">No conversations yet.</p>}
          {threads.map((thread) => (
            <div key={thread.id} className={thread.id === activeId ? "agent-history-row is-on" : "agent-history-row"}>
              <button type="button" onClick={() => { setOpen(false); onOpen(thread.id) }}>
                <span>{thread.title}</span>
                <small>{when(thread.updatedAt)}</small>
              </button>
              <button type="button" className="agent-history-delete" aria-label={`Delete ${thread.title}`} onClick={() => onDelete(thread)}>
                <Icon name="trash" size={14} />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

export default function AgentPage() {
  const settingsApi = useApi("/agent/settings")
  const threadsApi = useApi("/agent/threads")
  const [threadId, setThreadId] = useState("")
  const [title, setTitle] = useState("")
  const [rows, setRows] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState("")
  const streamingRef = useRef(false)

  const openThread = useCallback(async (id) => {
    if (streamingRef.current) return
    setOpening(true)
    setError("")
    try {
      const data = await api(`/agent/threads/${id}`)
      setThreadId(id)
      setTitle(data.thread.title)
      storeThread(id)
      setRows(threadRows(data.thread.messages))
    } catch (err) {
      storeThread("")
      if (err.status !== 404) setError(err.message)
    } finally {
      setOpening(false)
    }
  }, [])

  useEffect(() => {
    let stored = ""
    try {
      stored = sessionStorage.getItem(THREAD_KEY) || ""
    } catch {}
    if (stored) openThread(stored)
  }, [openThread])

  function newChat() {
    if (streamingRef.current) return
    setThreadId("")
    setTitle("")
    storeThread("")
    setRows([])
    setError("")
  }

  async function deleteThread(thread) {
    if (!window.confirm(`Delete "${thread.title}"?`)) return
    try {
      await api(`/agent/threads/${thread.id}`, { method: "DELETE" })
      if (thread.id === threadId) newChat()
      threadsApi.reload()
    } catch (err) {
      setError(err.message)
    }
  }

  async function send(prompt) {
    if (streamingRef.current) return
    streamingRef.current = true
    setStreaming(true)
    setError("")
    const startedAt = Date.now()
    if (!threadId) setTitle(chatTitleFromPrompt(prompt))
    setRows((current) => [...current, { id: rowId(), role: "user", content: prompt }])
    const add = (row) => setRows((current) => [...current, row])
    try {
      await streamAgent(
        { prompt, threadId },
        {
          onChatId: (id) => {
            setThreadId(id)
            storeThread(id)
          },
          onPacket: (parsed) => {
            const parts = streamPayloadToAssistantParts(parsed)
            if (parts.skipMessage) return
            add({ id: rowId(), role: "assistant", content: parts.userMessage, toolResult: parts.toolResult, error: parts.error })
          },
        },
      )
    } catch (err) {
      add({ id: rowId(), role: "assistant", content: err.message, error: true })
    } finally {
      const durationMs = Date.now() - startedAt
      setRows((current) => {
        const next = [...current]
        for (let index = next.length - 1; index >= 0; index -= 1) {
          if (next[index].role === "user") break
          if (!next[index].toolResult && next[index].content) {
            next[index] = { ...next[index], agentRun: { durationMs } }
            break
          }
        }
        return next
      })
      streamingRef.current = false
      setStreaming(false)
      threadsApi.reload()
      for (const delay of [3000, 8000, 15000]) setTimeout(() => threadsApi.reload(), delay)
    }
  }

  const listed = (threadsApi.data?.items || []).find((thread) => thread.id === threadId)
  const chatTitle = listed?.title || title || "New chat"

  return (
    <div className="workspace agent-page">
      <div className="workspace-top">
        <div className="page-heading">
          <h1 className="page-title agent-title" title={chatTitle}>{chatTitle}</h1>
        </div>
        <div className="agent-head-actions">
          <History threads={threadsApi.data?.items || []} activeId={threadId} onOpen={openThread} onDelete={deleteThread} />
          <button type="button" className="primary" disabled={streaming} onClick={newChat}>
            <Icon name="plus" size={14} />
            New chat
          </button>
        </div>
      </div>
      <div className="agent-scroll">
        {error && <div className="banner">{error}</div>}
        {opening ? (
          <PageSpinner />
        ) : (
          <AgentMessages rows={rows} streaming={streaming} emptyHint="Ask about properties, lenders, draws, loans or upcoming payments" />
        )}
      </div>
      <AgentComposer onSend={send} streaming={streaming} connected={settingsApi.data?.settings?.modelConnected} />
    </div>
  )
}
