"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Icon } from "../ui/Icon"
import { api } from "../../lib/api"
import { Avatar } from "./TaskPickers"
import { sinceLabel } from "./taskFormat"

const MAX_FILES = 5
const ACCEPT = ".pdf,.png,.jpg,.jpeg,.gif,.webp,.heic,.doc,.docx,.xls,.xlsx,.xlsm,.csv,.txt,.mp4,.mov"

// A comment's words with each @mention picked out.
function withMentions(text, mentionIds, people) {
  const names = people.filter((person) => mentionIds.includes(person.id)).map((person) => `@${person.name}`).sort((a, b) => b.length - a.length)
  if (!names.length) return text
  const parts = []
  let rest = text
  while (rest) {
    const at = names.map((name) => ({ name, index: rest.indexOf(name) })).filter((hit) => hit.index >= 0).sort((a, b) => a.index - b.index)[0]
    if (!at) {
      parts.push(rest)
      break
    }
    if (at.index) parts.push(rest.slice(0, at.index))
    parts.push(<span key={parts.length} className="task-mention">{at.name}</span>)
    rest = rest.slice(at.index + at.name.length)
  }
  return parts
}

// Where to write: @ opens the people to mention, the paperclip adds files.
function Composer({ taskId, people, parentId = "", placeholder, autoFocus = false, onPosted, onCancel = null }) {
  const [text, setText] = useState("")
  const [files, setFiles] = useState([])
  const [mentions, setMentions] = useState({})
  const [ask, setAsk] = useState(null)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const area = useRef(null)
  const picker = useRef(null)
  const caret = useRef(null)

  useEffect(() => {
    if (autoFocus) area.current?.focus()
  }, [autoFocus])

  // After a mention goes in, the caret sits just past it (as the text is written, so fast typing lands after it).
  useLayoutEffect(() => {
    if (caret.current == null) return
    area.current?.focus()
    area.current?.setSelectionRange(caret.current, caret.current)
    caret.current = null
  }, [text])

  function grow() {
    const element = area.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`
  }
  useEffect(grow, [text])

  function onChange(event) {
    const value = event.target.value
    setText(value)
    const before = value.slice(0, event.target.selectionStart)
    const match = /(^|\s)@([^\s@]*(?:\s[^\s@]*)?)$/.exec(before)
    setAsk(match ? { query: match[2], at: before.length - match[2].length - 1 } : null)
  }

  const matches = ask ? people.filter((person) => person.name.toLowerCase().includes(ask.query.toLowerCase())).slice(0, 6) : []

  function mention(person) {
    const end = ask.at + 1 + ask.query.length
    const next = `${text.slice(0, ask.at)}@${person.name} ${text.slice(end)}`
    setText(next)
    setMentions((current) => ({ ...current, [person.name]: person.id }))
    setAsk(null)
    caret.current = ask.at + person.name.length + 2
  }

  async function post(event) {
    event?.preventDefault()
    const body = text.trim()
    if ((!body && !files.length) || pending) return
    setPending(true)
    setError("")
    const mentionIds = Object.entries(mentions).filter(([name]) => body.includes(`@${name}`)).map(([, id]) => id)
    try {
      let result
      if (files.length) {
        const form = new FormData()
        form.set("text", body)
        form.set("mentionIds", JSON.stringify(mentionIds))
        if (parentId) form.set("parentId", parentId)
        for (const file of files) form.append("files", file, file.name)
        result = await api(`/tasks/${taskId}/comments`, { method: "POST", body: form })
      } else {
        result = await api(`/tasks/${taskId}/comments`, { method: "POST", body: { text: body, mentionIds, parentId: parentId || undefined } })
      }
      setText("")
      setFiles([])
      setMentions({})
      onPosted(result.comment)
    } catch (err) {
      setError(err.message)
    } finally {
      setPending(false)
    }
  }

  return (
    <form className={parentId ? "task-composer is-reply" : "task-composer"} onSubmit={post}>
      <div className="task-composer-box">
        <textarea
          ref={area}
          rows={1}
          value={text}
          placeholder={placeholder}
          maxLength={5000}
          aria-label={placeholder}
          onChange={onChange}
          onKeyDown={(event) => {
            if (ask && matches.length && (event.key === "Enter" || event.key === "Tab")) {
              event.preventDefault()
              mention(matches[0])
              return
            }
            if (event.key === "Escape" && ask) setAsk(null)
            if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) post()
          }}
        />
        {ask && matches.length > 0 && (
          <div className="task-mention-menu" ref={picker} role="listbox" aria-label="Mention someone">
            {matches.map((person) => (
              <button key={person.id} type="button" role="option" onMouseDown={(event) => event.preventDefault()} onClick={() => mention(person)}>
                <Avatar name={person.name} /> {person.name}
              </button>
            ))}
          </div>
        )}
        {files.length > 0 && (
          <div className="task-composer-files">
            {files.map((file, index) => (
              <span key={`${file.name}-${index}`} className="task-file-chip">
                <Icon name="file" size={13} /> {file.name}
                <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((list) => list.filter((_, at) => at !== index))}>×</button>
              </span>
            ))}
          </div>
        )}
        <div className="task-composer-foot">
          <label className="task-composer-tool" title="Attach files">
            <Icon name="paperclip" size={16} />
            <span className="sr-only">Attach files</span>
            <input type="file" multiple accept={ACCEPT} hidden onChange={(event) => {
            const picked = [...event.target.files]
            event.target.value = ""
            setFiles((list) => [...list, ...picked].slice(0, MAX_FILES))
          }} />
          </label>
          <button type="button" className="task-composer-tool" title="Mention someone" onClick={() => {
            const at = text.length && !/\s$/.test(text) ? `${text} @` : `${text}@`
            setText(at)
            setAsk({ query: "", at: at.length - 1 })
            area.current?.focus()
          }}>
            <Icon name="at" size={16} />
          </button>
          <span />
          {onCancel && <button type="button" className="tool" onClick={onCancel}>Cancel</button>}
          <button type="submit" className="primary" disabled={pending || (!text.trim() && !files.length)}>{pending ? "Posting…" : parentId ? "Reply" : "Comment"}</button>
        </div>
      </div>
      {error && <p className="task-error">{error}</p>}
    </form>
  )
}

function Comment({ comment, taskId, people, me, admin, onReply, onDelete }) {
  return (
    <div className="task-comment">
      <Avatar name={comment.userName} />
      <div className="task-comment-body">
        <p className="task-comment-head"><strong>{comment.userName}</strong> <span>{sinceLabel(comment.createdAt)}</span></p>
        {comment.text && <p className="task-comment-text">{withMentions(comment.text, comment.mentionIds, people)}</p>}
        {comment.attachments.length > 0 && (
          <div className="task-comment-files">
            {comment.attachments.map((file) => (
              <a key={file.id} className="task-file-chip" href={`/api/tasks/${taskId}/files/${file.id}`} target="_blank" rel="noreferrer">
                <Icon name="file" size={13} /> {file.name}
              </a>
            ))}
          </div>
        )}
        <div className="task-comment-actions">
          {onReply && <button type="button" onClick={onReply}><Icon name="reply" size={13} /> Reply</button>}
          {(comment.userId === me || admin) && <button type="button" onClick={onDelete}>Delete</button>}
        </div>
      </div>
    </div>
  )
}

// Comments on a task, in threads, newest thread first. `onCount` hears the total (for the bubble in the list).
export function TaskComments({ taskId, user, focus = false, onCount }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState("")
  const [replying, setReplying] = useState("")
  const ref = useRef(null)

  useEffect(() => {
    let alive = true
    api(`/tasks/${taskId}/comments`).then((result) => { if (alive) setData(result) }).catch((err) => { if (alive) setError(err.message) })
    return () => { alive = false }
  }, [taskId])

  useEffect(() => {
    if (focus && data) ref.current?.scrollIntoView({ block: "start", behavior: "smooth" })
  }, [focus, data])

  // The count as it changes, once loaded (so the list's bubble agrees with what's here).
  const count = data ? data.comments.length : null
  useEffect(() => {
    if (count != null) onCount?.(count)
  }, [count])

  const comments = data?.comments || []
  const people = data?.people || []
  const add = (comment) => {
    setData((current) => ({ ...current, comments: [...current.comments, comment] }))
    setReplying("")
  }
  const remove = async (comment) => {
    if (!window.confirm(comment.parentId ? "Delete this reply?" : "Delete this comment and its replies?")) return
    try {
      const result = await api(`/tasks/${taskId}/comments/${comment.id}`, { method: "DELETE" })
      setData((current) => ({ ...current, comments: current.comments.filter((item) => !result.deleted.includes(item.id)) }))
    } catch (err) {
      setError(err.message)
    }
  }
  const threads = comments.filter((comment) => !comment.parentId).reverse()
  return (
    <section className="task-section" ref={ref} aria-label="Comments">
      <h3>Comments{comments.length ? <em>{comments.length}</em> : null}</h3>
      {error && <p className="task-error">{error}</p>}
      {!data && !error ? <p className="task-muted">Loading comments…</p> : (
        <>
          <Composer taskId={taskId} people={people} placeholder="Write a comment and mention others with @" autoFocus={focus} onPosted={add} />
          {threads.length === 0 && <p className="task-muted">No comments yet.</p>}
          {threads.map((thread) => (
            <div key={thread.id} className="task-thread">
              <Comment comment={thread} taskId={taskId} people={people} me={user.id} admin={user.role === "admin"} onReply={() => setReplying(replying === thread.id ? "" : thread.id)} onDelete={() => remove(thread)} />
              <div className="task-replies">
                {comments.filter((comment) => comment.parentId === thread.id).map((reply) => (
                  <Comment key={reply.id} comment={reply} taskId={taskId} people={people} me={user.id} admin={user.role === "admin"} onDelete={() => remove(reply)} />
                ))}
                {replying === thread.id && <Composer taskId={taskId} people={people} parentId={thread.id} placeholder="Write a reply" autoFocus onPosted={add} onCancel={() => setReplying("")} />}
              </div>
            </div>
          ))}
        </>
      )}
    </section>
  )
}
