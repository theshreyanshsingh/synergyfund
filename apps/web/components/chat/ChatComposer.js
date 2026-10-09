"use client"

import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react"
import { Icon } from "../ui/Icon"
import { useSpeechInput } from "../agent/useSpeechInput"
import { EMOJI, fileSize, fromEditable } from "./chatFormat"

const MAX = 8000
const TYPING_GAP = 3000

export const ChatComposer = forwardRef(function ChatComposer({ placeholder, members, allowChannel, draft, onDraft, onSend, onTyping, onUpload, disabled, autoFocus }, ref) {
  const [text, setText] = useState(draft?.text || "")
  const [files, setFiles] = useState([])
  const [mention, setMention] = useState(null)
  const [active, setActive] = useState(0)
  const [emojiOpen, setEmojiOpen] = useState(false)
  const [error, setError] = useState("")
  const [sending, setSending] = useState(false)
  const mentions = useRef(new Map(draft?.mentions || []))
  const textareaRef = useRef(null)
  const fileRef = useRef(null)
  const lastTyping = useRef(0)
  const speech = useSpeechInput((spoken) => setText((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${spoken}`.slice(0, MAX)))

  useImperativeHandle(ref, () => ({
    focus: () => textareaRef.current?.focus(),
    addFiles: (list) => upload(list),
  }))

  useEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
    // Focus only when the box first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    onDraft?.({ text, mentions: [...mentions.current] })
  }, [text, onDraft])

  useEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = "auto"
    element.style.height = `${Math.min(element.scrollHeight, 220)}px`
  }, [text])

  const options = useMemo(() => {
    if (!mention) return []
    const query = mention.query.toLowerCase()
    const list = members
      .filter((person) => !query || person.name.toLowerCase().includes(query) || person.email?.toLowerCase().startsWith(query))
      .slice(0, 8)
      .map((person) => ({ id: person.id, label: person.name, hint: person.email, online: person.online }))
    if (allowChannel && "channel".startsWith(query)) list.push({ id: "channel", label: "channel", hint: "Notify everyone in this conversation" })
    return list
  }, [mention, members, allowChannel])

  function findMention(value, caret) {
    const before = value.slice(0, caret)
    const match = before.match(/(^|\s)@([\w.'-]{0,30})$/)
    if (!match) return null
    return { query: match[2], start: caret - match[2].length - 1, end: caret }
  }

  function change(event) {
    const value = event.target.value
    setText(value)
    setError("")
    const next = findMention(value, event.target.selectionStart)
    setMention(next)
    setActive(0)
    if (value.trim() && Date.now() - lastTyping.current > TYPING_GAP) {
      lastTyping.current = Date.now()
      onTyping?.()
    }
  }

  function choose(option) {
    if (!mention) return
    const label = option.id === "channel" ? "channel" : option.label
    if (option.id !== "channel") mentions.current.set(option.label, option.id)
    const next = `${text.slice(0, mention.start)}@${label} ${text.slice(mention.end)}`
    const caret = mention.start + label.length + 2
    setText(next)
    setMention(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(caret, caret)
    })
  }

  function insert(value) {
    const element = textareaRef.current
    const start = element ? element.selectionStart : text.length
    const end = element ? element.selectionEnd : text.length
    const next = `${text.slice(0, start)}${value}${text.slice(end)}`
    setText(next)
    requestAnimationFrame(() => {
      element?.focus()
      element?.setSelectionRange(start + value.length, start + value.length)
    })
  }

  async function upload(list) {
    const picked = [...(list || [])].slice(0, 10)
    for (const file of picked) {
      const key = `${file.name}-${file.size}-${Math.random().toString(36).slice(2)}`
      setFiles((current) => [...current, { key, name: file.name, size: file.size, status: "uploading" }])
      try {
        const saved = await onUpload(file)
        setFiles((current) => current.map((item) => (item.key === key ? { ...item, id: saved.id, status: "ready" } : item)))
      } catch (err) {
        setFiles((current) => current.map((item) => (item.key === key ? { ...item, status: "failed", error: err.message } : item)))
      }
    }
  }

  async function send(event) {
    event?.preventDefault()
    if (sending || disabled) return
    const ready = files.filter((file) => file.status === "ready")
    if (files.some((file) => file.status === "uploading")) {
      setError("Wait for the files to finish uploading.")
      return
    }
    const body = fromEditable(text.trim(), mentions.current, allowChannel)
    if (!body && !ready.length) return
    if (speech.listening) speech.stop()
    setSending(true)
    setError("")
    try {
      await onSend({ text: body, fileIds: ready.map((file) => file.id) })
      setText("")
      setFiles([])
      mentions.current = new Map()
      lastTyping.current = 0
    } catch (err) {
      setError(err.message)
    } finally {
      setSending(false)
      requestAnimationFrame(() => textareaRef.current?.focus())
    }
  }

  function keyDown(event) {
    if (mention && options.length) {
      if (event.key === "ArrowDown") {
        event.preventDefault()
        setActive((current) => (current + 1) % options.length)
        return
      }
      if (event.key === "ArrowUp") {
        event.preventDefault()
        setActive((current) => (current - 1 + options.length) % options.length)
        return
      }
      if (event.key === "Enter" || event.key === "Tab") {
        event.preventDefault()
        choose(options[Math.min(active, options.length - 1)])
        return
      }
      if (event.key === "Escape") {
        event.preventDefault()
        setMention(null)
        return
      }
    }
    if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
      event.preventDefault()
      send()
    }
  }

  function paste(event) {
    const pasted = [...(event.clipboardData?.files || [])]
    const hasText = Boolean(event.clipboardData?.getData("text/plain"))
    if (pasted.length && !hasText) {
      event.preventDefault()
      upload(pasted)
    }
  }

  const canSend = !disabled && !sending && (text.trim() || files.some((file) => file.status === "ready"))

  return (
    <form className="chat-composer" onSubmit={send}>
      {mention && options.length > 0 && (
        <div className="chat-mention-menu" role="listbox">
          {options.map((option, index) => (
            <button
              key={option.id}
              type="button"
              role="option"
              aria-selected={index === active}
              className={index === active ? "is-active" : undefined}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(option)}
            >
              {option.id === "channel" ? <span className="chat-avatar sm is-channel"><Icon name="at" size={12} /></span> : <Avatar name={option.label} online={option.online} size="sm" />}
              <b>{option.id === "channel" ? "@channel" : option.label}</b>
              {option.hint && <small>{option.hint}</small>}
            </button>
          ))}
        </div>
      )}
      <div className="chat-box">
        {files.length > 0 && (
          <div className="chat-files">
            {files.map((file) => (
              <span key={file.key} className={`chat-file-chip is-${file.status}`} title={file.error || file.name}>
                {file.status === "uploading" ? <span className="spinner spinner-sm tw:animate-spin" /> : <Icon name="paperclip" size={13} />}
                <b>{file.name}</b>
                <small>{file.status === "failed" ? "Failed" : fileSize(file.size)}</small>
                <button type="button" aria-label={`Remove ${file.name}`} onClick={() => setFiles((current) => current.filter((item) => item.key !== file.key))}>
                  <Icon name="close" size={12} />
                </button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          rows={1}
          maxLength={MAX}
          value={text}
          disabled={disabled}
          placeholder={placeholder}
          onChange={change}
          onKeyDown={keyDown}
          onPaste={paste}
          onBlur={() => setTimeout(() => setMention(null), 120)}
          onClick={(event) => { setMention(findMention(event.currentTarget.value, event.currentTarget.selectionStart)); setActive(0) }}
        />
        <div className="chat-box-foot">
          <div className="chat-box-tools">
            <input ref={fileRef} type="file" multiple hidden onChange={(event) => { upload(event.target.files); event.target.value = "" }} />
            <button type="button" className="agent-icon-button" title="Attach files" aria-label="Attach files" disabled={disabled} onClick={() => fileRef.current?.click()}>
              <Icon name="paperclip" size={16} />
            </button>
            <div className="chat-emoji">
              <button type="button" className="agent-icon-button" title="Emoji" aria-label="Emoji" aria-expanded={emojiOpen} disabled={disabled} onClick={() => setEmojiOpen((current) => !current)}>
                <Icon name="smile" size={16} />
              </button>
              {emojiOpen && (
                <div className="chat-emoji-menu" onMouseLeave={() => setEmojiOpen(false)}>
                  {EMOJI.map((emoji) => (
                    <button key={emoji} type="button" onClick={() => { insert(emoji); setEmojiOpen(false) }}>{emoji}</button>
                  ))}
                </div>
              )}
            </div>
            <button type="button" className="agent-icon-button" title="Mention someone" aria-label="Mention someone" disabled={disabled} onClick={() => insert(/(^|\s)$/.test(text) ? "@" : " @")}>
              <Icon name="at" size={16} />
            </button>
            {speech.supported && (
              <button
                type="button"
                className={speech.listening ? "agent-icon-button is-listening" : "agent-icon-button"}
                title={speech.listening ? "Stop recording" : "Voice input"}
                aria-label={speech.listening ? "Stop recording" : "Voice input"}
                disabled={disabled}
                onClick={speech.listening ? speech.stop : speech.start}
              >
                <Icon name={speech.listening ? "stop" : "mic"} size={16} />
              </button>
            )}
          </div>
          <span className="chat-box-hint">Enter to send · Shift + Enter for a new line</span>
          <button type="submit" className="chat-send" disabled={!canSend} aria-label="Send">
            {sending ? <span className="spinner spinner-sm tw:animate-spin" /> : <Icon name="arrowUp" size={16} />}
          </button>
        </div>
      </div>
      {(error || speech.error) && <p className="chat-composer-error">{error || speech.error}</p>}
    </form>
  )
})

export function Avatar({ name, online, size = "md" }) {
  const letters = String(name || "?").split(/[\s.@_-]+/).filter(Boolean).slice(0, 2).map((part) => part[0]).join("").toUpperCase()
  let hash = 0
  for (const char of String(name || "")) hash = (hash * 31 + char.charCodeAt(0)) % 360
  return (
    <span className={`chat-avatar ${size}`} style={{ "--hue": hash }}>
      {letters || "?"}
      {online !== undefined && <i className={online ? "is-online" : ""} aria-label={online ? "Online" : "Away"} />}
    </span>
  )
}
