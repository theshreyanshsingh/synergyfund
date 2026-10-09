"use client"

import Link from "next/link"
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import { useSession } from "../shell/Providers"
import { FormSheet } from "../ui/FormSheet"
import { Icon } from "../ui/Icon"
import { PageSpinner, Spinner } from "../ui/Spinner"
import { api } from "../../lib/api"
import { emitChat, useChatEvents, useChatStatus } from "../../lib/chatSocket"
import { Avatar, ChatComposer } from "./ChatComposer"
import { ChatMessages } from "./ChatMessages"
import { channelTitle, clock, dayLabel, nameOf, plain, sameDay } from "./chatFormat"

const NARROW = "(max-width: 900px)"
const TYPING_TTL = 5000

function addUnique(list, message) {
  if (list.some((item) => item.id === message.id)) return list.map((item) => (item.id === message.id ? message : item))
  const next = [...list, message]
  next.sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt))
  return next
}

function replaceMessage(list, message) {
  return list.map((item) => (item.id === message.id ? message : item))
}

function useVisible() {
  const [visible, setVisible] = useState(true)
  useEffect(() => {
    const update = () => setVisible(document.visibilityState === "visible" && document.hasFocus())
    update()
    document.addEventListener("visibilitychange", update)
    window.addEventListener("focus", update)
    window.addEventListener("blur", update)
    return () => {
      document.removeEventListener("visibilitychange", update)
      window.removeEventListener("focus", update)
      window.removeEventListener("blur", update)
    }
  }, [])
  return visible
}

function useNarrow() {
  const [narrow, setNarrow] = useState(false)
  useEffect(() => {
    const query = window.matchMedia(NARROW)
    const update = () => setNarrow(query.matches)
    update()
    query.addEventListener("change", update)
    return () => query.removeEventListener("change", update)
  }, [])
  return narrow
}

function sortChannels(list) {
  return [...list].sort((a, b) => {
    if (a.kind === "general") return -1
    if (b.kind === "general") return 1
    return a.name.localeCompare(b.name, undefined, { numeric: true })
  })
}

export function ChatApp() {
  const session = useSession()
  const router = useRouter()
  const params = useSearchParams()
  const activeId = params.get("c") || ""
  const threadId = params.get("t") || ""
  const status = useChatStatus()
  const visible = useVisible()
  const narrow = useNarrow()
  const [boot, setBoot] = useState(null)
  const [error, setError] = useState("")
  const [channels, setChannels] = useState([])
  const [peopleList, setPeopleList] = useState([])
  const [online, setOnline] = useState(() => new Set())
  const [feeds, setFeeds] = useState({})
  const [thread, setThread] = useState(null)
  const [members, setMembers] = useState({})
  const [typing, setTyping] = useState({})
  const [details, setDetails] = useState(false)
  const [dialog, setDialog] = useState("")
  const [filter, setFilter] = useState("")
  const [search, setSearch] = useState(null)
  const [marks, setMarks] = useState({})
  const [threadVersion, setThreadVersion] = useState(0)
  const markedFor = useRef("")
  const drafts = useRef(new Map())
  const readTimers = useRef(new Map())
  const activeRef = useRef(activeId)
  const visibleRef = useRef(visible)
  const threadRef = useRef(threadId)
  const me = boot?.me || session?.user?.id || ""
  const isAdmin = session?.user?.role === "admin"
  activeRef.current = activeId
  visibleRef.current = visible
  threadRef.current = threadId

  const people = useMemo(() => new Map(peopleList.map((person) => [person.id, person])), [peopleList])
  const active = channels.find((channel) => channel.id === activeId) || null

  const loadBoot = useCallback(async () => {
    try {
      const data = await api("/chat/bootstrap")
      setBoot({ me: data.me, canCreateChannels: data.canCreateChannels })
      setChannels(data.channels)
      setPeopleList(data.people)
      setOnline(new Set(data.online))
      setError("")
      return data
    } catch (err) {
      setError(err.message)
      return null
    }
  }, [])

  const loadFeed = useCallback(async (id) => {
    setFeeds((current) => ({ ...current, [id]: { items: current[id]?.items || [], more: false, loaded: current[id]?.loaded || false, loading: true } }))
    try {
      const data = await api(`/chat/channels/${id}/messages`)
      setFeeds((current) => {
        const oldest = data.items[0] ? new Date(data.items[0].createdAt).getTime() : 0
        let items = data.items
        for (const item of current[id]?.items || []) {
          if (new Date(item.createdAt).getTime() >= oldest && !items.some((loaded) => loaded.id === item.id)) items = addUnique(items, item)
        }
        return { ...current, [id]: { items, more: data.more, loaded: true, loading: false } }
      })
    } catch (err) {
      setFeeds((current) => ({ ...current, [id]: { items: current[id]?.items || [], more: false, loaded: true, loading: false, error: err.message } }))
    }
  }, [])

  const loadMembers = useCallback(async (id) => {
    try {
      const data = await api(`/chat/channels/${id}/members`)
      setMembers((current) => ({ ...current, [id]: data.items }))
    } catch {}
  }, [])

  const markRead = useCallback((id) => {
    const now = new Date().toISOString()
    setChannels((current) => current.map((channel) => (channel.id === id ? { ...channel, unread: 0, mentions: 0, lastReadAt: now } : channel)))
    clearTimeout(readTimers.current.get(id))
    readTimers.current.set(id, setTimeout(() => {
      api(`/chat/channels/${id}/read`, { method: "POST", body: {} }).catch(() => {})
    }, 400))
  }, [])

  const open = useCallback((id, { thread: nextThread = "", replace = false } = {}) => {
    const url = id ? `/chat?c=${id}${nextThread ? `&t=${nextThread}` : ""}` : "/chat"
    setSearch(null)
    if (replace) router.replace(url, { scroll: false })
    else router.push(url, { scroll: false })
  }, [router])

  useEffect(() => {
    loadBoot()
  }, [loadBoot])

  useEffect(() => {
    if (status === "live") emitChat("presence:get")
  }, [status])

  useEffect(() => {
    if (!boot || activeId || narrow) return
    const general = channels.find((channel) => channel.kind === "general") || channels[0]
    if (general) open(general.id, { replace: true })
  }, [boot, activeId, channels, narrow, open])

  useEffect(() => {
    if (!activeId || !boot) return
    const channel = channels.find((item) => item.id === activeId)
    if (!channel) return
    if (markedFor.current !== activeId) {
      markedFor.current = activeId
      setMarks((current) => ({ ...current, [activeId]: channel.unread ? channel.lastReadAt : null }))
    }
    if (!feeds[activeId]?.loaded && !feeds[activeId]?.loading) loadFeed(activeId)
    if (!members[activeId]) loadMembers(activeId)
    // Only react to switching conversations; the feed and member caches are filled once per channel.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId, boot, Boolean(active)])

  useEffect(() => {
    if (activeId && visible && (active?.unread || active?.mentions)) markRead(activeId)
  }, [activeId, visible, active?.unread, active?.mentions, markRead])

  useEffect(() => {
    if (!threadId) {
      setThread(null)
      return
    }
    let stale = false
    setThread((current) => (current?.parent?.id === threadId ? current : { parent: null, replies: [], loading: true }))
    api(`/chat/messages/${threadId}/thread`)
      .then((data) => !stale && setThread({ parent: data.parent, replies: data.replies, loading: false }))
      .catch((err) => !stale && setThread({ parent: null, replies: [], loading: false, error: err.message }))
    return () => {
      stale = true
    }
  }, [threadId, threadVersion])

  useEffect(() => {
    const unread = channels.reduce((total, channel) => total + (channel.mentions || 0), 0)
    const title = unread ? `(${unread}) Chat · SynergiFund` : "Chat · SynergiFund"
    document.title = title
    const timer = setTimeout(() => {
      document.title = title
    }, 120)
    return () => clearTimeout(timer)
  }, [channels, activeId, threadId])

  useEffect(() => () => {
    document.title = "SynergiFund"
  }, [])

  useEffect(() => {
    if (!Object.keys(typing).length) return
    const timer = setInterval(() => {
      const now = Date.now()
      setTyping((current) => {
        const next = {}
        for (const [key, users] of Object.entries(current)) {
          const kept = Object.fromEntries(Object.entries(users).filter(([, value]) => value.until > now))
          if (Object.keys(kept).length) next[key] = kept
        }
        return next
      })
    }, 1500)
    return () => clearInterval(timer)
  }, [typing])

  function upsertChannel(channel) {
    if (!channel) return
    setChannels((current) => {
      const found = current.find((item) => item.id === channel.id)
      if (found) return current.map((item) => (item.id === channel.id ? { ...item, ...channel } : item))
      return [...current, { unread: 0, mentions: 0, lastReadAt: null, ...channel }]
    })
  }

  function stopTyping(key, userId) {
    setTyping((current) => {
      if (!current[key]?.[userId]) return current
      const users = { ...current[key] }
      delete users[userId]
      return { ...current, [key]: users }
    })
  }

  function alertDesktop(message, channel) {
    if (typeof Notification === "undefined" || Notification.permission !== "granted" || visibleRef.current) return
    const author = message.userName || "Someone"
    const where = channel?.kind === "direct" ? "Direct message" : channel?.kind === "property" ? channel.name : `#${channel?.name || "chat"}`
    try {
      const note = new Notification(`${author} · ${where}`, { body: plain(message.text, people).slice(0, 180) || "Shared a file", tag: message.id })
      note.onclick = () => {
        window.focus()
        open(message.channelId, { thread: message.parentId })
      }
    } catch {}
  }

  useChatEvents({
    "message:new": ({ message, channel }) => {
      upsertChannel(channel)
      if (message.parentId) {
        setThread((current) => (current?.parent?.id === message.parentId ? { ...current, replies: addUnique(current.replies, message) } : current))
      } else {
        setFeeds((current) => (current[message.channelId]?.loaded ? { ...current, [message.channelId]: { ...current[message.channelId], items: addUnique(current[message.channelId].items, message) } } : current))
      }
      stopTyping(message.parentId || message.channelId, message.userId)
      if (message.userId === me) return
      const here = message.channelId === activeRef.current && visibleRef.current
      if (here) {
        markRead(message.channelId)
        return
      }
      const direct = channel?.kind === "direct"
      const mentioned = direct || message.mentionIds.includes(me) || message.mentionsChannel
      setChannels((current) => current.map((item) => (item.id === message.channelId ? { ...item, unread: (item.unread || 0) + (message.parentId ? 0 : 1), mentions: (item.mentions || 0) + (mentioned ? 1 : 0) } : item)))
      if (mentioned) alertDesktop(message, channel)
    },
    "message:update": ({ message }) => {
      setFeeds((current) => (current[message.channelId]?.loaded ? { ...current, [message.channelId]: { ...current[message.channelId], items: replaceMessage(current[message.channelId].items, message) } } : current))
      setThread((current) => {
        if (!current?.parent) return current
        if (current.parent.id === message.id) return { ...current, parent: message }
        return { ...current, replies: replaceMessage(current.replies, message) }
      })
    },
    "channel:new": ({ channel }) => upsertChannel(channel),
    "channel:update": ({ channel }) => upsertChannel(channel),
    "channel:remove": ({ id }) => {
      setChannels((current) => current.filter((channel) => channel.id !== id))
      if (activeRef.current === id) open("", { replace: true })
    },
    read: ({ channelId, lastReadAt }) => setChannels((current) => current.map((channel) => (channel.id === channelId ? { ...channel, unread: 0, mentions: 0, lastReadAt: lastReadAt || channel.lastReadAt } : channel))),
    typing: ({ channelId, parentId, userId, name }) => {
      const key = parentId || channelId
      setTyping((current) => ({ ...current, [key]: { ...(current[key] || {}), [userId]: { name, until: Date.now() + TYPING_TTL } } }))
    },
    presence: ({ online: ids }) => setOnline(new Set(ids)),
    "presence:change": ({ userId, online: isOnline }) => setOnline((current) => {
      const next = new Set(current)
      if (isOnline) next.add(userId)
      else next.delete(userId)
      return next
    }),
    "chat:refresh": async () => {
      const data = await loadBoot()
      if (data && activeRef.current && !data.channels.some((channel) => channel.id === activeRef.current)) open("", { replace: true })
    },
    reconnect: () => {
      if (!boot) return
      loadBoot()
      setFeeds((current) => Object.fromEntries(Object.entries(current).map(([id, feed]) => [id, id === activeRef.current ? feed : { ...feed, loaded: false }])))
      if (activeRef.current) loadFeed(activeRef.current)
      if (threadRef.current) setThreadVersion((value) => value + 1)
    },
  })

  async function send(channelId, parentId, { text, fileIds }) {
    const data = await api(`/chat/channels/${channelId}/messages`, { method: "POST", body: { text, fileIds, parentId: parentId || undefined } })
    if (parentId) setThread((current) => (current?.parent?.id === parentId ? { ...current, replies: addUnique(current.replies, data.message) } : current))
    else setFeeds((current) => ({ ...current, [channelId]: { ...(current[channelId] || { more: false, loaded: true }), items: addUnique(current[channelId]?.items || [], data.message) } }))
    setChannels((current) => current.map((channel) => (channel.id === channelId ? { ...channel, lastMessageAt: data.message.createdAt } : channel)))
  }

  async function uploadFile(channelId, file) {
    const body = new FormData()
    body.set("file", file)
    const data = await api(`/chat/channels/${channelId}/files`, { method: "POST", body })
    return data.file
  }

  function applyMessage(message) {
    setFeeds((current) => (current[message.channelId] ? { ...current, [message.channelId]: { ...current[message.channelId], items: replaceMessage(current[message.channelId].items, message) } } : current))
    setThread((current) => (current?.parent ? { ...current, parent: current.parent.id === message.id ? message : current.parent, replies: replaceMessage(current.replies, message) } : current))
  }

  async function react(message, emoji) {
    try {
      const data = await api(`/chat/messages/${message.id}/reactions`, { method: "POST", body: { emoji } })
      applyMessage(data.message)
    } catch (err) {
      setError(err.message)
    }
  }

  async function edit(message, text) {
    const data = await api(`/chat/messages/${message.id}`, { method: "PATCH", body: { text } })
    applyMessage(data.message)
  }

  async function remove(message) {
    if (!window.confirm("Delete this message? Everyone in the conversation will see that it was deleted.")) return
    try {
      await api(`/chat/messages/${message.id}`, { method: "DELETE" })
      applyMessage({ ...message, deleted: true, text: "", reactions: [], attachments: [] })
    } catch (err) {
      setError(err.message)
    }
  }

  async function loadOlder(id) {
    const feed = feeds[id]
    if (!feed?.items.length || feed.loadingOlder) return
    setFeeds((current) => ({ ...current, [id]: { ...current[id], loadingOlder: true } }))
    try {
      const data = await api(`/chat/channels/${id}/messages?before=${encodeURIComponent(feed.items[0].createdAt)}`)
      setFeeds((current) => ({ ...current, [id]: { ...current[id], items: [...data.items, ...current[id].items.filter((item) => !data.items.some((older) => older.id === item.id))], more: data.more, loadingOlder: false } }))
    } catch {
      setFeeds((current) => ({ ...current, [id]: { ...current[id], loadingOlder: false } }))
    }
  }

  async function runSearch(query) {
    const text = query.trim()
    if (text.length < 2) {
      setSearch(null)
      return
    }
    setSearch({ query: text, items: [], loading: true })
    try {
      const data = await api(`/chat/search?q=${encodeURIComponent(text)}`)
      setSearch({ query: text, items: data.items, loading: false })
    } catch (err) {
      setSearch({ query: text, items: [], loading: false, error: err.message })
    }
  }

  async function startDirect(userIds) {
    const data = await api("/chat/direct", { method: "POST", body: { userIds } })
    upsertChannel(data.channel)
    setDialog("")
    open(data.channel.id)
  }

  const draftFor = useCallback((key) => drafts.current.get(key), [])
  const saveDraft = useCallback((key, value) => {
    if (value.text) drafts.current.set(key, value)
    else drafts.current.delete(key)
  }, [])

  if (!boot && !error) return <div className="chat-page"><PageSpinner label="Loading chat" /></div>
  if (!boot) return <div className="chat-page chat-failed"><div className="banner">{error}</div><button type="button" className="import-button" onClick={loadBoot}>Try again</button></div>

  const memberList = members[activeId] || []
  const feed = feeds[activeId]
  const typingHere = Object.entries(typing[activeId] || {}).filter(([id]) => id !== me).map(([, value]) => value.name)
  const typingThread = Object.entries(typing[threadId] || {}).filter(([id]) => id !== me).map(([, value]) => value.name)
  const panel = threadId ? "thread" : details && active ? "details" : ""

  return (
    <div className={`chat-page${activeId ? " has-active" : ""}${panel ? " has-panel" : ""}`}>
      <ChatNav
        channels={channels}
        people={people}
        peopleList={peopleList}
        me={me}
        online={online}
        activeId={activeId}
        status={status}
        filter={filter}
        canCreate={boot.canCreateChannels}
        onFilter={setFilter}
        onSearch={runSearch}
        onOpen={(id) => open(id)}
        onCreate={() => setDialog("channel")}
        onDirect={() => setDialog("direct")}
        onPerson={(id) => startDirect([id]).catch((err) => setError(err.message))}
      />
      <section className="chat-main">
        {search ? (
          <SearchResults search={search} channels={channels} people={people} me={me} onClose={() => setSearch(null)} onOpen={(message) => open(message.channelId, { thread: message.parentId })} />
        ) : active ? (
          <Conversation
            key={active.id}
            channel={active}
            feed={feed}
            people={people}
            me={me}
            isAdmin={isAdmin}
            online={online}
            members={memberList}
            unreadAfter={marks[active.id]}
            typingNames={typingHere}
            error={error}
            onDismissError={() => setError("")}
            onBack={() => open("")}
            onDetails={() => { setDetails((current) => !current); if (threadId) open(active.id, { replace: true }) }}
            onLoadOlder={() => loadOlder(active.id)}
            onSend={(body) => send(active.id, "", body)}
            onUpload={(file) => uploadFile(active.id, file)}
            onReact={react}
            onReply={(message) => { setDetails(false); open(active.id, { thread: message.id }) }}
            onEdit={edit}
            onDelete={remove}
            draft={draftFor(active.id)}
            onDraft={(value) => saveDraft(active.id, value)}
          />
        ) : (
          <div className="chat-empty-main">
            <Icon name="chat" size={28} />
            <p>{channels.length ? "Pick a conversation" : "No conversations yet"}</p>
            <span>Channels, property rooms and direct messages appear on the left.</span>
          </div>
        )}
      </section>
      {panel === "thread" && (
        <ThreadPanel
          key={threadId}
          thread={thread}
          channel={channels.find((channel) => channel.id === (thread?.parent?.channelId || activeId)) || active}
          people={people}
          me={me}
          isAdmin={isAdmin}
          online={online}
          members={memberList}
          typingNames={typingThread}
          onClose={() => open(activeId, { replace: true })}
          onSend={(body) => send(thread.parent.channelId, thread.parent.id, body)}
          onUpload={(file) => uploadFile(thread.parent.channelId, file)}
          onReact={react}
          onEdit={edit}
          onDelete={remove}
          draft={draftFor(`thread:${threadId}`)}
          onDraft={(value) => saveDraft(`thread:${threadId}`, value)}
        />
      )}
      {panel === "details" && (
        <DetailsPanel
          key={active.id}
          channel={active}
          people={people}
          peopleList={peopleList}
          me={me}
          isAdmin={isAdmin}
          online={online}
          members={memberList}
          onClose={() => setDetails(false)}
          onChanged={(channel) => { upsertChannel(channel); loadMembers(channel.id) }}
          onLeft={(id) => { setDetails(false); setChannels((current) => current.filter((channel) => channel.id !== id)); open("", { replace: true }) }}
          onMessage={(id) => startDirect([id]).catch((err) => setError(err.message))}
        />
      )}
      {dialog === "channel" && (
        <CreateChannel
          peopleList={peopleList.filter((person) => person.id !== me)}
          onClose={() => setDialog("")}
          onCreated={(channel) => { upsertChannel(channel); setDialog(""); open(channel.id) }}
        />
      )}
      {dialog === "direct" && (
        <StartDirect peopleList={peopleList.filter((person) => person.id !== me)} online={online} onClose={() => setDialog("")} onStart={startDirect} />
      )}
    </div>
  )
}

function ChatNav({ channels, people, peopleList, me, online, activeId, status, filter, canCreate, onFilter, onSearch, onOpen, onCreate, onDirect, onPerson }) {
  const [collapsed, setCollapsed] = useState({})
  const [permission, setPermission] = useState("granted")
  const query = filter.trim().toLowerCase()
  const matches = (channel) => !query || channelTitle(channel, people, me).toLowerCase().includes(query) || (channel.city || "").toLowerCase().includes(query)

  useEffect(() => {
    if (typeof Notification !== "undefined") setPermission(Notification.permission)
  }, [])

  const rooms = sortChannels(channels.filter((channel) => channel.kind === "general" || channel.kind === "channel")).filter(matches)
  const properties = channels.filter((channel) => channel.kind === "property").filter(matches).sort((a, b) => (b.mentions || 0) - (a.mentions || 0) || (b.unread ? 1 : 0) - (a.unread ? 1 : 0) || a.name.localeCompare(b.name, undefined, { numeric: true }))
  const directs = channels.filter((channel) => channel.kind === "direct").filter(matches).sort((a, b) => new Date(b.lastMessageAt || b.createdAt || 0) - new Date(a.lastMessageAt || a.createdAt || 0))
  const talkedTo = new Set(directs.flatMap((channel) => channel.memberIds))
  const suggestions = query ? peopleList.filter((person) => person.id !== me && !talkedTo.has(person.id) && person.name.toLowerCase().includes(query)).slice(0, 5) : []

  function section(key, label, items, render, action) {
    const closed = collapsed[key] && !query
    return (
      <div className="chat-nav-section">
        <div className="chat-nav-heading">
          <button type="button" aria-expanded={!closed} onClick={() => setCollapsed((current) => ({ ...current, [key]: !current[key] }))}>
            <Icon name="chevron" size={12} />
            <span>{label}</span>
            {closed && items.some((item) => item.unread || item.mentions) && <i className="chat-nav-dot" />}
          </button>
          {action}
        </div>
        {!closed && items.map(render)}
        {!closed && !items.length && <p className="chat-nav-empty">{query ? "No matches" : "Nothing here yet"}</p>}
      </div>
    )
  }

  function row(channel, icon) {
    const title = channelTitle(channel, people, me)
    const unread = channel.unread > 0 || channel.mentions > 0
    return (
      <button key={channel.id} type="button" className={`chat-nav-row${channel.id === activeId ? " is-active" : ""}${unread ? " is-unread" : ""}`} onClick={() => onOpen(channel.id)} title={title}>
        {icon}
        <span>{title}</span>
        {channel.mentions > 0 && <em>{channel.mentions}</em>}
      </button>
    )
  }

  return (
    <aside className="chat-nav">
      <div className="chat-nav-top">
        <h1>Chat</h1>
        <span className={`chat-status is-${status}`} title={status === "live" ? "Connected live" : status === "connecting" ? "Reconnecting" : "Offline"}>
          <i />
          {status === "live" ? "Live" : status === "connecting" ? "Connecting" : "Offline"}
        </span>
      </div>
      <form className="chat-nav-search" onSubmit={(event) => { event.preventDefault(); onSearch(filter) }}>
        <Icon name="search" size={14} />
        <input value={filter} placeholder="Find or search messages" aria-label="Find conversations or search messages" onChange={(event) => onFilter(event.target.value)} />
        {filter && <button type="submit" className="chat-nav-search-go">Search</button>}
      </form>
      <div className="chat-nav-list">
        {section("channels", "Channels", rooms, (channel) => row(channel, <Icon name={channel.private ? "lock" : "hash"} size={15} />), canCreate && (
          <button type="button" className="chat-nav-add" aria-label="Create a channel" title="Create a channel" onClick={onCreate}><Icon name="plus" size={14} /></button>
        ))}
        {section("properties", "Properties", properties, (channel) => row(channel, <Icon name="building" size={15} />))}
        {section("direct", "Direct messages", directs, (channel) => {
          const others = channel.memberIds.filter((id) => id !== me)
          const first = others[0] || me
          return row(channel, others.length > 1 ? <span className="chat-avatar xs is-group">{others.length}</span> : <Avatar name={nameOf(people, first)} online={online.has(first)} size="xs" />)
        }, (
          <button type="button" className="chat-nav-add" aria-label="New message" title="New message" onClick={onDirect}><Icon name="plus" size={14} /></button>
        ))}
        {suggestions.length > 0 && (
          <div className="chat-nav-section">
            <div className="chat-nav-heading"><span className="chat-nav-sub">People</span></div>
            {suggestions.map((person) => (
              <button key={person.id} type="button" className="chat-nav-row" onClick={() => onPerson(person.id)}>
                <Avatar name={person.name} online={online.has(person.id)} size="xs" />
                <span>{person.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
      {permission === "default" && (
        <button type="button" className="chat-notify-ask" onClick={() => Notification.requestPermission().then(setPermission)}>
          <Icon name="bell" size={14} />
          Turn on desktop alerts
        </button>
      )}
    </aside>
  )
}

function ConversationIcon({ channel, people, me, online }) {
  if (channel.kind === "direct") {
    const others = channel.memberIds.filter((id) => id !== me)
    if (others.length > 1) return <span className="chat-avatar sm is-group">{others.length}</span>
    const id = others[0] || me
    return <Avatar name={nameOf(people, id)} online={online.has(id)} size="sm" />
  }
  if (channel.kind === "property") return <span className="chat-head-icon"><Icon name="building" size={16} /></span>
  return <span className="chat-head-icon"><Icon name={channel.private ? "lock" : "hash"} size={16} /></span>
}

function subtitle(channel, members, people, me, online) {
  if (channel.kind === "direct") {
    const others = channel.memberIds.filter((id) => id !== me)
    if (others.length === 1) return online.has(others[0]) ? "Online" : people.get(others[0])?.email || "Away"
    return `${others.length + 1} people`
  }
  const parts = []
  if (channel.kind === "property" && channel.city) parts.push(channel.city)
  if (members.length) parts.push(`${members.length} ${members.length === 1 ? "member" : "members"}`)
  if (channel.topic) parts.push(channel.topic)
  return parts.join(" · ")
}

function placeholderFor(channel, people, me) {
  if (channel.kind === "direct") return `Message ${channelTitle(channel, people, me)}`
  if (channel.kind === "property") return `Message the ${channel.name} team`
  return `Message #${channel.name}`
}

function useStickyScroll(items, channelKey) {
  const ref = useRef(null)
  const atBottom = useRef(true)
  const previous = useRef({ first: "", height: 0, top: 0 })

  const onScroll = useCallback(() => {
    const element = ref.current
    if (!element) return
    atBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120
    previous.current = { ...previous.current, height: element.scrollHeight, top: element.scrollTop }
  }, [])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    element.scrollTop = element.scrollHeight
    atBottom.current = true
  }, [channelKey])

  useLayoutEffect(() => {
    const element = ref.current
    if (!element) return
    const first = items[0]?.id || ""
    const prepended = previous.current.first && first !== previous.current.first && items.some((item) => item.id === previous.current.first)
    if (prepended) element.scrollTop = element.scrollHeight - previous.current.height + previous.current.top
    else if (atBottom.current) element.scrollTop = element.scrollHeight
    previous.current = { first, height: element.scrollHeight, top: element.scrollTop }
  }, [items])

  const stick = useCallback(() => {
    const element = ref.current
    if (element && atBottom.current) element.scrollTop = element.scrollHeight
  }, [])

  const toBottom = useCallback(() => {
    const element = ref.current
    if (!element) return
    atBottom.current = true
    element.scrollTop = element.scrollHeight
  }, [])

  return { ref, onScroll, stick, toBottom, atBottom }
}

function Typing({ names }) {
  if (!names.length) return <div className="chat-typing" />
  const label = names.length === 1 ? `${names[0]} is typing` : names.length === 2 ? `${names[0]} and ${names[1]} are typing` : "Several people are typing"
  return (
    <div className="chat-typing is-on" role="status">
      <span className="agent-dots"><span>•</span><span>•</span><span>•</span></span>
      {label}
    </div>
  )
}

function Conversation({ channel, feed, people, me, isAdmin, online, members, unreadAfter, typingNames, error, onDismissError, onBack, onDetails, onLoadOlder, onSend, onUpload, onReact, onReply, onEdit, onDelete, draft, onDraft }) {
  const items = feed?.items || []
  const scroll = useStickyScroll(items, channel.id)
  const composer = useRef(null)
  const [dragging, setDragging] = useState(false)
  const title = channelTitle(channel, people, me)
  const memberPeople = members.length ? members : channel.memberIds.map((id) => people.get(id)).filter(Boolean)
  const mentionable = memberPeople.filter((person) => person.id !== me).map((person) => ({ ...person, online: online.has(person.id) }))

  useEffect(() => {
    composer.current?.focus()
  }, [])

  function scrolled(event) {
    scroll.onScroll()
    if (event.currentTarget.scrollTop < 80 && feed?.more && !feed.loadingOlder) onLoadOlder()
  }

  return (
    <div
      className={dragging ? "chat-conversation is-dragging" : "chat-conversation"}
      onDragOver={(event) => {
        if ([...event.dataTransfer.types].includes("Files")) {
          event.preventDefault()
          setDragging(true)
        }
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setDragging(false)
      }}
      onDrop={(event) => {
        if (!event.dataTransfer.files?.length) return
        event.preventDefault()
        setDragging(false)
        composer.current?.addFiles(event.dataTransfer.files)
      }}
    >
      <header className="chat-head">
        <button type="button" className="chat-back" aria-label="Back to conversations" onClick={onBack}><Icon name="back" size={18} /></button>
        <ConversationIcon channel={channel} people={people} me={me} online={online} />
        <div className="chat-head-copy">
          <h2 title={title}>{title}</h2>
          <p>{subtitle(channel, members, people, me, online)}</p>
        </div>
        <div className="chat-head-actions">
          {channel.kind === "property" && channel.propertyId && (
            <Link href={`/properties/${channel.propertyId}`} className="import-button chat-head-link">Open property</Link>
          )}
          {channel.kind !== "direct" && (
            <button type="button" className="chat-members-button" onClick={onDetails} title="Members and details">
              <Icon name="users" size={15} />
              <span>{members.length || ""}</span>
            </button>
          )}
          {channel.kind === "direct" && (
            <button type="button" className="chat-members-button" onClick={onDetails} title="Details"><Icon name="more" size={15} /></button>
          )}
        </div>
      </header>
      {error && (
        <div className="chat-inline-error">
          <span>{error}</span>
          <button type="button" onClick={onDismissError} aria-label="Dismiss"><Icon name="close" size={14} /></button>
        </div>
      )}
      <div className="chat-scroll" ref={scroll.ref} onScroll={scrolled} onLoadCapture={scroll.stick}>
        {feed?.loadingOlder && <div className="chat-older"><Spinner size="md" label="Loading older messages" /></div>}
        {feed && !feed.more && feed.loaded && <Intro channel={channel} title={title} people={people} me={me} />}
        {!feed?.loaded ? (
          <PageSpinner label="Loading messages" />
        ) : feed.error ? (
          <p className="chat-feed-error">{feed.error}</p>
        ) : (
          <ChatMessages
            messages={items}
            people={people}
            me={me}
            isAdmin={isAdmin}
            online={online}
            unreadAfter={unreadAfter}
            onReact={onReact}
            onReply={onReply}
            onEdit={onEdit}
            onDelete={onDelete}
          />
        )}
      </div>
      <Typing names={typingNames} />
      <ChatComposer
        ref={composer}
        placeholder={placeholderFor(channel, people, me)}
        members={mentionable}
        allowChannel={channel.kind !== "direct"}
        draft={draft}
        onDraft={onDraft}
        onTyping={() => emitChat("typing", { channelId: channel.id })}
        onUpload={onUpload}
        onSend={async (body) => {
          await onSend(body)
          scroll.toBottom()
        }}
      />
      {dragging && <div className="chat-drop">Drop files to share them in {channel.kind === "direct" ? "this conversation" : title}</div>}
    </div>
  )
}

function Intro({ channel, title, people, me }) {
  let text
  if (channel.kind === "general") text = "This is the start of #general, the conversation for the whole team."
  else if (channel.kind === "property") text = `This is the room for ${title}. Only people who can open this property can read it.`
  else if (channel.kind === "direct") text = channel.memberIds.length === 1 ? "This is your space. Draft messages, keep notes and links here." : `This is the start of your conversation with ${channelTitle(channel, people, me)}.`
  else text = `This is the start of #${channel.name}.${channel.private ? " It is private: only invited people can see it." : ""}`
  return (
    <div className="chat-intro">
      <strong>{channel.kind === "direct" ? title : channel.kind === "property" ? title : `#${channel.name}`}</strong>
      <p>{text}</p>
    </div>
  )
}

function ThreadPanel({ thread, channel, people, me, isAdmin, online, members, typingNames, onClose, onSend, onUpload, onReact, onEdit, onDelete, draft, onDraft }) {
  const replies = thread?.replies || []
  const scroll = useStickyScroll(replies, thread?.parent?.id || "loading")
  const mentionable = members.filter((person) => person.id !== me).map((person) => ({ ...person, online: online.has(person.id) }))
  return (
    <aside className="chat-panel">
      <header className="chat-panel-head">
        <div>
          <h3>Thread</h3>
          {channel && <p>{channel.kind === "direct" ? channelTitle(channel, people, me) : channel.kind === "property" ? channel.name : `#${channel.name}`}</p>}
        </div>
        <button type="button" className="chat-panel-close" aria-label="Close thread" onClick={onClose}><Icon name="close" size={16} /></button>
      </header>
      <div className="chat-scroll" ref={scroll.ref} onScroll={scroll.onScroll} onLoadCapture={scroll.stick}>
        {!thread || thread.loading ? (
          <PageSpinner label="Loading thread" />
        ) : thread.error || !thread.parent ? (
          <p className="chat-feed-error">{thread?.error || "That thread was not found."}</p>
        ) : (
          <>
            <ChatMessages messages={[thread.parent]} people={people} me={me} isAdmin={isAdmin} online={online} inThread onReact={onReact} onReply={() => {}} onEdit={onEdit} onDelete={onDelete} />
            <div className="chat-thread-count"><span>{replies.length} {replies.length === 1 ? "reply" : "replies"}</span></div>
            <ChatMessages messages={replies} people={people} me={me} isAdmin={isAdmin} online={online} inThread onReact={onReact} onReply={() => {}} onEdit={onEdit} onDelete={onDelete} />
          </>
        )}
      </div>
      <Typing names={typingNames} />
      {thread?.parent && !thread.parent.deleted && (
        <ChatComposer
          autoFocus
          placeholder="Reply…"
          members={mentionable}
          allowChannel={false}
          draft={draft}
          onDraft={onDraft}
          onTyping={() => emitChat("typing", { channelId: thread.parent.channelId, parentId: thread.parent.id })}
          onUpload={onUpload}
          onSend={async (body) => {
            await onSend(body)
            scroll.toBottom()
          }}
        />
      )}
    </aside>
  )
}

function DetailsPanel({ channel, people, peopleList, me, isAdmin, online, members, onClose, onChanged, onLeft, onMessage }) {
  const [topic, setTopic] = useState(channel.topic)
  const [name, setName] = useState(channel.name)
  const [adding, setAdding] = useState(false)
  const [picked, setPicked] = useState([])
  const [error, setError] = useState("")
  const [busy, setBusy] = useState(false)
  const manage = channel.kind === "channel" && (isAdmin || channel.createdBy === me)
  const canTopic = channel.kind !== "direct" && (channel.kind !== "channel" || manage)
  const memberIds = new Set(members.map((person) => person.id))

  useEffect(() => {
    setTopic(channel.topic)
    setName(channel.name)
  }, [channel.topic, channel.name])

  async function patch(body) {
    setBusy(true)
    setError("")
    try {
      const data = await api(`/chat/channels/${channel.id}`, { method: "PATCH", body })
      onChanged(data.channel)
      return true
    } catch (err) {
      setError(err.message)
      return false
    } finally {
      setBusy(false)
    }
  }

  async function leave() {
    if (!window.confirm(`Leave #${channel.name}? You will need to be added again to see it.`)) return
    try {
      await api(`/chat/channels/${channel.id}/leave`, { method: "POST", body: {} })
      onLeft(channel.id)
    } catch (err) {
      setError(err.message)
    }
  }

  async function archive() {
    if (!window.confirm(`Archive #${channel.name}? It will disappear for everyone.`)) return
    try {
      await api(`/chat/channels/${channel.id}`, { method: "DELETE" })
      onLeft(channel.id)
    } catch (err) {
      setError(err.message)
    }
  }

  const sorted = [...members].sort((a, b) => Number(online.has(b.id)) - Number(online.has(a.id)) || a.name.localeCompare(b.name))

  return (
    <aside className="chat-panel">
      <header className="chat-panel-head">
        <div>
          <h3>Details</h3>
          <p>{channel.kind === "direct" ? channelTitle(channel, people, me) : channel.kind === "property" ? channel.name : `#${channel.name}`}</p>
        </div>
        <button type="button" className="chat-panel-close" aria-label="Close details" onClick={onClose}><Icon name="close" size={16} /></button>
      </header>
      <div className="chat-details">
        {error && <div className="banner">{error}</div>}
        {manage && (
          <form className="chat-details-field" onSubmit={(event) => { event.preventDefault(); if (name !== channel.name) patch({ name }) }}>
            <label htmlFor="chat-name">Name</label>
            <div><input id="chat-name" value={name} onChange={(event) => setName(event.target.value)} /><button type="submit" className="import-button" disabled={busy || name === channel.name}>Save</button></div>
          </form>
        )}
        {channel.kind !== "direct" && (
          <form className="chat-details-field" onSubmit={(event) => { event.preventDefault(); patch({ topic }) }}>
            <label htmlFor="chat-topic">Topic</label>
            {canTopic ? (
              <div><input id="chat-topic" value={topic} placeholder="What is this conversation about?" onChange={(event) => setTopic(event.target.value)} /><button type="submit" className="import-button" disabled={busy || topic === channel.topic}>Save</button></div>
            ) : <p>{channel.topic || "No topic"}</p>}
          </form>
        )}
        {channel.kind === "property" && (
          <p className="chat-details-note">Everyone who can open this property is in this room. Give or remove property access on the Members page to change who is here.</p>
        )}
        {channel.kind === "general" && <p className="chat-details-note">Everyone on the team is in #general. Contractors only see their property rooms and direct messages.</p>}
        <div className="chat-details-members">
          <div className="chat-details-label">
            <span>{members.length} {members.length === 1 ? "member" : "members"}</span>
            {channel.kind === "channel" && channel.private && <button type="button" className="import-button" onClick={() => setAdding((current) => !current)}>{adding ? "Cancel" : "Add people"}</button>}
          </div>
          {adding && (
            <div className="chat-add-people">
              <PeoplePicker people={peopleList.filter((person) => !memberIds.has(person.id))} online={online} picked={picked} onChange={setPicked} />
              <button type="button" className="primary" disabled={!picked.length || busy} onClick={async () => { if (await patch({ addMemberIds: picked })) { setPicked([]); setAdding(false) } }}>Add {picked.length || ""}</button>
            </div>
          )}
          {sorted.map((person) => (
            <div key={person.id} className="chat-member">
              <Avatar name={person.name} online={online.has(person.id)} size="sm" />
              <span><b>{person.name}{person.id === me ? " (you)" : ""}</b><small>{person.email}</small></span>
              {person.id !== me && <button type="button" className="chat-member-action" onClick={() => onMessage(person.id)}>Message</button>}
              {manage && channel.private && person.id !== me && (
                <button type="button" className="chat-member-action is-danger" onClick={() => patch({ removeMemberIds: [person.id] })}>Remove</button>
              )}
            </div>
          ))}
        </div>
        {channel.kind === "channel" && (
          <div className="chat-details-actions">
            {channel.private && <button type="button" className="import-button" onClick={leave}>Leave channel</button>}
            {manage && <button type="button" className="import-button is-danger" onClick={archive}>Archive channel</button>}
          </div>
        )}
      </div>
    </aside>
  )
}

function PeoplePicker({ people, online, picked, onChange }) {
  const [query, setQuery] = useState("")
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const shown = people.filter((person) => words.every((word) => `${person.name} ${person.email}`.toLowerCase().includes(word))).slice(0, 50)
  return (
    <div className="chat-picker">
      <input value={query} placeholder="Search people" aria-label="Search people" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") event.preventDefault() }} />
      <div className="chat-picker-list">
        {shown.map((person) => {
          const on = picked.includes(person.id)
          return (
            <label key={person.id} className={on ? "is-on" : undefined}>
              <input type="checkbox" checked={on} onChange={() => onChange(on ? picked.filter((id) => id !== person.id) : [...picked, person.id])} />
              <Avatar name={person.name} online={online.has(person.id)} size="sm" />
              <span><b>{person.name}</b><small>{person.email}</small></span>
            </label>
          )
        })}
        {!shown.length && <p className="chat-nav-empty">Nobody matches.</p>}
      </div>
    </div>
  )
}

function CreateChannel({ peopleList, onClose, onCreated }) {
  const [name, setName] = useState("")
  const [topic, setTopic] = useState("")
  const [isPrivate, setPrivate] = useState(false)
  const [picked, setPicked] = useState([])
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)
  const slug = name.trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "")

  async function submit(event) {
    event.preventDefault()
    setPending(true)
    setError("")
    try {
      const data = await api("/chat/channels", { method: "POST", body: { name, topic, private: isPrivate, memberIds: picked } })
      onCreated(data.channel)
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet eyebrow="Chat" title="Create a channel" hint="Channels are where the team talks about a topic." onClose={onClose} onSubmit={submit} submitLabel="Create channel" pending={pending} error={error}>
      <div className="form-grid">
        <label className="field wide"><span>Name</span><input autoFocus required value={name} placeholder="e.g. acquisitions" onChange={(event) => setName(event.target.value)} /></label>
        {slug && slug !== name && <p className="chat-form-hint wide">It will be called #{slug}.</p>}
        <label className="field wide"><span>Topic <em>· optional</em></span><input value={topic} placeholder="What is this channel for?" onChange={(event) => setTopic(event.target.value)} /></label>
        <label className={isPrivate ? "access-row is-on wide" : "access-row wide"}>
          <input type="checkbox" hidden checked={isPrivate} onChange={(event) => setPrivate(event.target.checked)} />
          <span><b>Make it private</b><small>Only people you invite can see a private channel.</small></span>
          <i />
        </label>
        {isPrivate && (
          <div className="wide">
            <p className="chat-form-hint">Invite people ({picked.length} picked)</p>
            <PeoplePicker people={peopleList} online={new Set()} picked={picked} onChange={setPicked} />
          </div>
        )}
      </div>
    </FormSheet>
  )
}

function StartDirect({ peopleList, online, onClose, onStart }) {
  const [picked, setPicked] = useState([])
  const [error, setError] = useState("")
  const [pending, setPending] = useState(false)

  async function submit(event) {
    event.preventDefault()
    if (!picked.length) {
      setError("Pick at least one person.")
      return
    }
    setPending(true)
    setError("")
    try {
      await onStart(picked)
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet eyebrow="Chat" title="New message" hint="Pick one person, or up to eight for a group conversation." onClose={onClose} onSubmit={submit} submitLabel={picked.length > 1 ? "Start group" : "Open conversation"} pending={pending} error={error}>
      <PeoplePicker people={peopleList} online={online} picked={picked} onChange={setPicked} />
    </FormSheet>
  )
}

function SearchResults({ search, channels, people, me, onClose, onOpen }) {
  const byId = new Map(channels.map((channel) => [channel.id, channel]))
  return (
    <div className="chat-conversation">
      <header className="chat-head">
        <button type="button" className="chat-back is-always" aria-label="Close search" onClick={onClose}><Icon name="back" size={18} /></button>
        <span className="chat-head-icon"><Icon name="search" size={16} /></span>
        <div className="chat-head-copy">
          <h2>Results for “{search.query}”</h2>
          <p>{search.loading ? "Searching…" : `${search.items.length} ${search.items.length === 1 ? "message" : "messages"}`}</p>
        </div>
      </header>
      <div className="chat-scroll">
        {search.loading && <PageSpinner label="Searching" />}
        {search.error && <p className="chat-feed-error">{search.error}</p>}
        {!search.loading && !search.items.length && !search.error && <div className="chat-empty-main"><p>No messages match</p><span>Try another word or a person’s name.</span></div>}
        <div className="chat-results">
          {search.items.map((message) => {
            const channel = byId.get(message.channelId)
            return (
              <button key={message.id} type="button" className="chat-result" onClick={() => onOpen(message)}>
                <span className="chat-result-where">
                  {channel ? (channel.kind === "direct" ? channelTitle(channel, people, me) : channel.kind === "property" ? channel.name : `#${channel.name}`) : "Conversation"}
                  {message.parentId ? " · in a thread" : ""}
                  <small>{sameDay(message.createdAt, new Date()) ? clock(message.createdAt) : `${dayLabel(message.createdAt)}, ${clock(message.createdAt)}`}</small>
                </span>
                <span className="chat-result-body">
                  <Avatar name={nameOf(people, message.userId) || message.userName} size="sm" />
                  <span><b>{people.get(message.userId)?.name || message.userName}</b><em>{plain(message.text, people)}</em></span>
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
