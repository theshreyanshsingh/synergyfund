"use client"

import { Fragment, useEffect, useRef, useState } from "react"
import { Icon } from "../ui/Icon"
import { Avatar } from "./ChatComposer"
import { ChatText } from "./ChatMarkdown"
import { QUICK_EMOJI, clock, dayLabel, fileSize, fromEditable, nameOf, sameDay, toEditable } from "./chatFormat"

const GROUP_GAP = 5 * 60 * 1000

export function ChatMessages({ messages, people, me, isAdmin, online, unreadAfter, inThread, onReact, onReply, onEdit, onDelete }) {
  let lastAuthor = ""
  let lastAt = 0
  let shownUnread = false
  return (
    <div className="chat-messages">
      {messages.map((message, index) => {
        const previous = messages[index - 1]
        const newDay = !previous || !sameDay(previous.createdAt, message.createdAt)
        const at = new Date(message.createdAt).getTime()
        const unread = !shownUnread && unreadAfter && message.userId !== me && at > new Date(unreadAfter).getTime()
        if (unread) shownUnread = true
        const compact = !newDay && !unread && message.userId === lastAuthor && at - lastAt < GROUP_GAP && previous && !previous.replyCount
        lastAuthor = message.userId
        lastAt = at
        return (
          <Fragment key={message.id}>
            {newDay && <div className="chat-day"><span>{dayLabel(message.createdAt)}</span></div>}
            {unread && <div className="chat-unread-line"><span>New</span></div>}
            <ChatMessage
              message={message}
              people={people}
              me={me}
              compact={compact}
              canDelete={message.userId === me || isAdmin}
              online={online.has(message.userId)}
              inThread={inThread}
              onReact={onReact}
              onReply={onReply}
              onEdit={onEdit}
              onDelete={onDelete}
            />
          </Fragment>
        )
      })}
    </div>
  )
}

function ChatMessage({ message, people, me, compact, canDelete, online, inThread, onReact, onReply, onEdit, onDelete }) {
  const [editing, setEditing] = useState(false)
  const [picking, setPicking] = useState(false)
  const author = people.get(message.userId)?.name || message.userName || "Someone"
  const mine = message.userId === me
  const mentioned = message.mentionsChannel || message.mentionIds.includes(me)

  if (message.deleted) {
    return (
      <div className={compact ? "chat-message is-compact is-deleted" : "chat-message is-deleted"}>
        <div className="chat-gutter">{compact ? null : <Avatar name={author} />}</div>
        <div className="chat-body">
          {!compact && <div className="chat-meta"><b>{author}</b><time>{clock(message.createdAt)}</time></div>}
          <p className="chat-removed">This message was deleted.</p>
          {!inThread && message.replyCount > 0 && <ThreadSummary message={message} people={people} onOpen={() => onReply(message)} />}
        </div>
      </div>
    )
  }

  return (
    <div className={`chat-message${compact ? " is-compact" : ""}${mentioned && !mine ? " is-mentioned" : ""}${editing ? " is-editing" : ""}`} id={`message-${message.id}`}>
      <div className="chat-gutter">
        {compact ? <time className="chat-gutter-time">{clock(message.createdAt)}</time> : <Avatar name={author} online={online} />}
      </div>
      <div className="chat-body">
        {!compact && (
          <div className="chat-meta">
            <b>{author}</b>
            <time title={new Date(message.createdAt).toLocaleString()}>{clock(message.createdAt)}</time>
          </div>
        )}
        {editing ? (
          <EditBox message={message} people={people} onCancel={() => setEditing(false)} onSave={async (text) => { await onEdit(message, text); setEditing(false) }} />
        ) : (
          <>
            {message.text && <ChatText text={message.text} people={people} me={me} />}
            {message.editedAt && <span className="chat-edited">(edited)</span>}
          </>
        )}
        {message.attachments.length > 0 && (
          <div className="chat-attachments">
            {message.attachments.map((file) => (
              String(file.mime).startsWith("image/") ? (
                <a key={file.id} className="chat-image" href={file.url} target="_blank" rel="noreferrer">
                  <img src={file.url} alt={file.name} loading="lazy" />
                </a>
              ) : (
                <a key={file.id} className="chat-attachment" href={`${file.url}?download=1`}>
                  <Icon name="file" size={18} />
                  <span><b>{file.name}</b><small>{fileSize(file.size)}</small></span>
                </a>
              )
            ))}
          </div>
        )}
        {message.reactions.length > 0 && (
          <div className="chat-reactions">
            {message.reactions.map((reaction) => {
              const reacted = reaction.userIds.includes(me)
              return (
                <button
                  key={reaction.emoji}
                  type="button"
                  className={reacted ? "is-mine" : undefined}
                  title={reaction.userIds.map((id) => (id === me ? "You" : nameOf(people, id))).join(", ")}
                  onClick={() => onReact(message, reaction.emoji)}
                >
                  <span>{reaction.emoji}</span>
                  <b>{reaction.userIds.length}</b>
                </button>
              )
            })}
            <button type="button" className="chat-reaction-add" aria-label="Add reaction" onClick={() => setPicking((current) => !current)}>
              <Icon name="smile" size={14} />
            </button>
          </div>
        )}
        {!inThread && message.replyCount > 0 && <ThreadSummary message={message} people={people} onOpen={() => onReply(message)} />}
      </div>
      {!editing && (
        <div className={picking ? "chat-actions is-open" : "chat-actions"}>
          {QUICK_EMOJI.slice(0, 3).map((emoji) => (
            <button key={emoji} type="button" title={`React ${emoji}`} onClick={() => onReact(message, emoji)}>{emoji}</button>
          ))}
          <button type="button" title="More reactions" aria-label="More reactions" onClick={() => setPicking((current) => !current)}><Icon name="smile" size={15} /></button>
          {!inThread && !message.parentId && <button type="button" title="Reply in thread" aria-label="Reply in thread" onClick={() => onReply(message)}><Icon name="reply" size={15} /></button>}
          {mine && <button type="button" title="Edit" aria-label="Edit message" onClick={() => setEditing(true)}><Icon name="edit" size={15} /></button>}
          {canDelete && <button type="button" title="Delete" aria-label="Delete message" className="is-danger" onClick={() => onDelete(message)}><Icon name="trash" size={15} /></button>}
          {picking && (
            <div className="chat-react-menu" onMouseLeave={() => setPicking(false)}>
              {QUICK_EMOJI.map((emoji) => (
                <button key={emoji} type="button" onClick={() => { onReact(message, emoji); setPicking(false) }}>{emoji}</button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

function ThreadSummary({ message, people, onOpen }) {
  return (
    <button type="button" className="chat-thread-link" onClick={onOpen}>
      <span className="chat-thread-faces">
        {message.replyUserIds.slice(-3).map((id) => <Avatar key={id} name={nameOf(people, id)} size="xs" />)}
      </span>
      <b>{message.replyCount} {message.replyCount === 1 ? "reply" : "replies"}</b>
      {message.lastReplyAt && <small>Last reply {sameDay(message.lastReplyAt, new Date()) ? clock(message.lastReplyAt) : dayLabel(message.lastReplyAt)}</small>}
    </button>
  )
}

function EditBox({ message, people, onCancel, onSave }) {
  const start = useRef(toEditable(message.text, people))
  const [text, setText] = useState(start.current.text)
  const [error, setError] = useState("")
  const [saving, setSaving] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.focus()
    element.setSelectionRange(element.value.length, element.value.length)
  }, [])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, 260)}px`
  }, [text])

  async function save() {
    if (saving) return
    setSaving(true)
    setError("")
    try {
      await onSave(fromEditable(text.trim(), start.current.mentions))
    } catch (err) {
      setError(err.message)
      setSaving(false)
    }
  }

  return (
    <div className="chat-edit">
      <textarea
        ref={ref}
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") onCancel()
          if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault()
            save()
          }
        }}
      />
      <div className="chat-edit-foot">
        {error && <span className="chat-composer-error">{error}</span>}
        <span>Escape to cancel · Enter to save</span>
        <button type="button" className="import-button" onClick={onCancel}>Cancel</button>
        <button type="button" className="primary" disabled={saving} onClick={save}>{saving ? "Saving…" : "Save"}</button>
      </div>
    </div>
  )
}
