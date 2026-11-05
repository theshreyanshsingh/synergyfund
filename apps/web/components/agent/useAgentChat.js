"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { chatTitleFromPrompt } from "@synergifund/shared"
import { api } from "../../lib/api"
import { streamAgent, streamPayloadToAssistantParts } from "../../lib/agentStream"
import { useApi } from "../../lib/useApi"

// One Agent conversation: the chats (rename, pin, delete), the open chat's messages, sending and streaming the reply,
// Retry and Edit, thumbs, saved prompts, and temporary chats. The Agent page and the phone's Agent sheet both run on it
// (the open chat is remembered for this tab).
const THREAD_KEY = "synergifund-agent-thread"

function rowId() {
  return `msg-${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function threadRows(messages) {
  return messages.flatMap((message) => {
    if (message.role === "user") return [{ id: message.id, role: "user", content: message.content, attachments: (message.attachments || []).map((file) => ({ ...file, url: `/api/documents/${file.id}/raw` })) }]
    const tools = (message.toolCalls || []).map((call, index) => ({
      id: `${message.id}-tool-${index}`,
      role: "assistant",
      content: "",
      toolResult: { UsedTool: call.tool, result: call.result },
    }))
    return [...tools, { id: message.id, role: "assistant", content: message.content, error: message.error, feedback: message.feedback || "", agentRun: { durationMs: message.agentRunDurationMs } }]
  })
}

function storeThread(id) {
  try {
    if (id) sessionStorage.setItem(THREAD_KEY, id)
    else sessionStorage.removeItem(THREAD_KEY)
  } catch {}
}

// Throws a temporary chat away. It also expires on its own a day after its last message.
function discardTemporaryThread(id) {
  if (!id) return
  fetch(`/api/agent/threads/${encodeURIComponent(id)}`, { method: "DELETE", credentials: "include", keepalive: true }).catch(() => {})
}

// When a chat was last used: a time today, a weekday this week, else a date.
export function chatWhen(value) {
  if (!value) return ""
  const date = new Date(value)
  const days = Math.floor((Date.now() - date.getTime()) / 86400000)
  if (days < 1) return date.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
  if (days < 7) return date.toLocaleDateString("en-US", { weekday: "short" })
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric" })
}

// A message the server has saved (its id is the server's), so Retry, Edit and thumbs can point at it.
export function savedMessage(id) {
  return /^[a-f0-9]{24}$/i.test(String(id || ""))
}

// Whether this tab has a chat open from before (the Agent reopens it).
export function hasStoredThread() {
  try {
    return Boolean(sessionStorage.getItem(THREAD_KEY))
  } catch {
    return false
  }
}

// `openId`: a chat to open (the Agent page's ?chat=, from a notification) instead of the one this tab had open.
export function useAgentChat({ openId = "" } = {}) {
  const settingsApi = useApi("/agent/settings")
  const threadsApi = useApi("/agent/threads")
  const promptsApi = useApi("/agent/prompts")
  const [threadId, setThreadId] = useState("")
  const [title, setTitle] = useState("")
  const [rows, setRows] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [opening, setOpening] = useState(false)
  const [error, setError] = useState("")
  const [temporary, setTemporary] = useState(false)
  const streamingRef = useRef(false)
  // The current temporary chat's id, so it can be thrown away when the person leaves it.
  const temporaryIdRef = useRef("")
  const threadRef = useRef("")
  threadRef.current = threadId

  function leaveTemporary() {
    discardTemporaryThread(temporaryIdRef.current)
    temporaryIdRef.current = ""
    setTemporary(false)
  }

  // Leaving the page (or closing the tab) ends a temporary chat.
  useEffect(() => {
    const onHide = () => discardTemporaryThread(temporaryIdRef.current)
    window.addEventListener("pagehide", onHide)
    return () => {
      window.removeEventListener("pagehide", onHide)
      discardTemporaryThread(temporaryIdRef.current)
    }
  }, [])

  const openThread = useCallback(async (id) => {
    if (streamingRef.current) return
    // Opening a saved chat ends any temporary one.
    discardTemporaryThread(temporaryIdRef.current)
    temporaryIdRef.current = ""
    setTemporary(false)
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

  const openedRef = useRef(null)
  useEffect(() => {
    const first = openedRef.current === null
    if (openId && openId !== openedRef.current) openThread(openId)
    else if (first) {
      let stored = ""
      try {
        stored = sessionStorage.getItem(THREAD_KEY) || ""
      } catch {}
      if (stored) openThread(stored)
    }
    openedRef.current = openId
  }, [openThread, openId])

  function newChat() {
    if (streamingRef.current) return
    if (temporary) leaveTemporary()
    setThreadId("")
    setTitle("")
    storeThread("")
    setRows([])
    setError("")
  }

  // A temporary chat is not saved to History. Pressing it again goes back to a normal new chat.
  function toggleTemporary() {
    if (streamingRef.current) return
    const starting = !temporary
    newChat()
    if (starting) setTemporary(true)
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

  // After an answer: the chat as the server saved it, so its messages carry their ids (Retry, Edit, thumbs). An answer
  // still appearing word by word carries on from where it was.
  async function sync(id) {
    try {
      const data = await api(`/agent/threads/${id}`)
      if (threadRef.current !== id || streamingRef.current) return
      setRows((current) => {
        const next = threadRows(data.thread.messages)
        const revealing = [...current].reverse().find((row) => row.role === "assistant" && !row.toolResult && row.revealFrom)
        const last = [...next].reverse().find((row) => row.role === "assistant" && !row.toolResult)
        if (revealing && last) last.revealFrom = revealing.revealFrom
        return next
      })
      setTitle(data.thread.title)
    } catch {}
  }

  // `replaceFrom`: the question this one replaces, with everything after it (Retry, Edit); its files come along.
  async function send(prompt, files = [], { replaceFrom = null } = {}) {
    if (streamingRef.current) return
    streamingRef.current = true
    setStreaming(true)
    setError("")
    const startedAt = Date.now()
    let chatId = threadId
    if (!threadId) setTitle(chatTitleFromPrompt(prompt || `About ${files.map((file) => file.name).join(", ")}`))
    const shownFiles = files.length ? files.map((file, index) => ({ id: `local-${index}`, name: file.name, mime: file.mime, url: file.url })) : replaceFrom?.attachments || []
    setRows((current) => {
      const at = replaceFrom ? current.findIndex((row) => row.id === replaceFrom.id) : -1
      return [...(at === -1 ? current : current.slice(0, at)), { id: rowId(), role: "user", content: prompt, attachments: shownFiles }]
    })
    const add = (row) => setRows((current) => [...current, row])
    try {
      await streamAgent(
        { prompt, threadId, temporary, files: files.map((file) => file.file), replaceFrom: replaceFrom?.id || "" },
        {
          onChatId: (id) => {
            chatId = id
            setThreadId(id)
            if (temporary) temporaryIdRef.current = id
            else storeThread(id)
          },
          onPacket: (parsed) => {
            const parts = streamPayloadToAssistantParts(parsed)
            if (parts.skipMessage) return
            add({ id: rowId(), role: "assistant", content: parts.userMessage, toolResult: parts.toolResult, error: parts.error, revealFrom: parts.toolResult || parts.error ? undefined : Date.now() })
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
      if (chatId) sync(chatId)
      threadsApi.reload()
      for (const delay of [3000, 8000, 15000]) setTimeout(() => threadsApi.reload(), delay)
    }
  }

  // Ask the same question again, or an edited one, in its place.
  function retry(userRow) {
    if (!savedMessage(userRow?.id)) return
    send(userRow.content, [], { replaceFrom: userRow })
  }

  function edit(userRow, text) {
    const prompt = String(text || "").trim()
    if (!savedMessage(userRow?.id) || (!prompt && !userRow.attachments?.length)) return
    send(prompt, [], { replaceFrom: userRow })
  }

  // Thumbs on an answer; the same thumb again takes it back.
  async function rate(row, value) {
    if (!threadId || !savedMessage(row.id)) return
    const before = row.feedback || ""
    const next = before === value ? "" : value
    const put = (feedback) => setRows((current) => current.map((item) => (item.id === row.id ? { ...item, feedback } : item)))
    put(next)
    try {
      await api(`/agent/threads/${threadId}/messages/${row.id}`, { method: "PATCH", body: { feedback: next } })
    } catch (err) {
      put(before)
      setError(err.message)
    }
  }

  async function renameThread(id, name) {
    const result = await api(`/agent/threads/${id}`, { method: "PATCH", body: { title: name } })
    if (id === threadId) setTitle(result.thread.title)
    threadsApi.reload()
    return result.thread
  }

  async function pinThread(id, pinned) {
    await api(`/agent/threads/${id}`, { method: "PATCH", body: { pinned } })
    threadsApi.reload()
  }

  // Saved prompts (Star under an answer saves its question). `repeat`: how often the Agent asks it on its own.
  async function savePrompt(text, repeat) {
    const result = await api("/agent/prompts", { method: "POST", body: repeat === undefined ? { text } : { text, repeat } })
    promptsApi.reload()
    return result.prompt
  }

  // `changes`: { text, repeat }, either or both.
  async function updatePrompt(id, changes) {
    await api(`/agent/prompts/${id}`, { method: "PATCH", body: changes })
    promptsApi.reload()
  }

  async function turnOnBrief() {
    await api("/agent/prompts", { method: "POST", body: { brief: true } })
    promptsApi.reload()
  }

  async function deletePrompt(id) {
    await api(`/agent/prompts/${id}`, { method: "DELETE" })
    promptsApi.reload()
  }

  const listed = (threadsApi.data?.items || []).find((thread) => thread.id === threadId)
  const chatTitle = temporary ? "Temporary chat" : listed?.title || title || "New chat"

  return {
    threads: threadsApi.data?.items || [],
    threadsLoaded: Boolean(threadsApi.data),
    reloadThreads: threadsApi.reload,
    prompts: promptsApi.data?.items || [],
    promptsLoaded: Boolean(promptsApi.data),
    promptZone: promptsApi.data?.zone || "",
    briefOffered: Boolean(promptsApi.data?.briefOffered),
    connected: settingsApi.data?.settings?.modelConnected,
    threadId,
    rows,
    streaming,
    opening,
    error,
    temporary,
    chatTitle,
    openThread,
    newChat,
    toggleTemporary,
    deleteThread,
    send,
    retry,
    edit,
    rate,
    renameThread,
    pinThread,
    savePrompt,
    updatePrompt,
    turnOnBrief,
    deletePrompt,
  }
}
