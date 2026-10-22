"use client"

import { useEffect, useRef, useState } from "react"
import { Icon } from "../ui/Icon"
import { prepareFile } from "../photos/CameraCapture"
import { useSpeechInput } from "./useSpeechInput"
import { VoiceWaves } from "./VoiceWaves"

const MAX_PROMPT = 10000
const MAX_FILES = 5
const MAX_BYTES = 20 * 1024 * 1024
const DOCUMENTS = "image/*,application/pdf,.pdf,.docx,.xlsx,.xls,.xlsm,.csv,.txt,.md,.json"

// Phones and tablets: the return key adds a line and the arrow sends. Computers: Enter sends, Shift+Enter adds a line.
// Cmd/Ctrl+Enter sends everywhere.
function touchScreen() {
  return typeof window !== "undefined" && Boolean(window.matchMedia?.("(pointer: coarse)").matches)
}

// A photo is resized for upload; it keeps its own name (with .jpg once it is a JPEG).
async function ready(file) {
  const shot = await prepareFile(file)
  const base = String(file.name || "photo").replace(/\.[^.]+$/, "") || "photo"
  const named = shot.file.type === "image/jpeg" && shot.file !== file ? new File([shot.file], `${base}.jpg`, { type: "image/jpeg" }) : shot.file
  return { id: shot.id, file: named, url: shot.url, name: named.name }
}

export function AgentComposer({ onSend, streaming, connected }) {
  const [message, setMessage] = useState("")
  const [files, setFiles] = useState([])
  const [menu, setMenu] = useState(false)
  const [note, setNote] = useState("")
  const [touch, setTouch] = useState(false)
  const [dragging, setDragging] = useState(false)
  const textareaRef = useRef(null)
  const menuRef = useRef(null)
  const cameraRef = useRef(null)
  const photosRef = useRef(null)
  const filesRef = useRef(null)
  const live = useRef(files)
  live.current = files
  const speech = useSpeechInput((text) => setMessage((current) => `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`.slice(0, MAX_PROMPT)))

  useEffect(() => setTouch(touchScreen()), [])

  function grow() {
    const element = textareaRef.current
    if (!element) return
    element.style.height = "40px"
    element.style.height = `${element.scrollHeight}px`
  }

  useEffect(grow, [message])

  useEffect(() => {
    if (!menu) return
    function onDown(event) {
      if (!menuRef.current?.contains(event.target)) setMenu(false)
    }
    function onKey(event) {
      if (event.key === "Escape") setMenu(false)
    }
    document.addEventListener("pointerdown", onDown)
    document.addEventListener("keydown", onKey)
    return () => {
      document.removeEventListener("pointerdown", onDown)
      document.removeEventListener("keydown", onKey)
    }
  }, [menu])

  async function add(list) {
    const picked = [...(list || [])]
    setMenu(false)
    if (!picked.length) return
    setNote("")
    const room = MAX_FILES - live.current.length
    if (picked.length > room) setNote(`Attach up to ${MAX_FILES} files to one question.`)
    const made = []
    for (const file of picked.slice(0, Math.max(0, room))) {
      if (file.size > MAX_BYTES) {
        setNote(`${file.name} is larger than 20 MB.`)
        continue
      }
      made.push(await ready(file))
    }
    setFiles((current) => [...current, ...made].slice(0, MAX_FILES))
  }

  function remove(item) {
    if (item.url) URL.revokeObjectURL(item.url)
    setFiles((current) => current.filter((entry) => entry.id !== item.id))
    setNote("")
  }

  function send(event) {
    event?.preventDefault()
    const text = message.trim()
    if ((!text && !files.length) || streaming) return
    if (speech.listening) speech.stop()
    // The page shows the sent photos from these addresses, so they are not released here.
    onSend(text, files.map((item) => ({ file: item.file, name: item.name, url: item.url, mime: item.file.type })))
    setMessage("")
    setFiles([])
    setNote("")
  }

  const pick = (ref) => () => {
    setMenu(false)
    ref.current?.click()
  }
  const chosen = (event) => {
    add(event.target.files)
    event.target.value = ""
  }

  return (
    <form className="agent-composer" onSubmit={send}>
      {streaming && (
        <div className="agent-building" role="status">
          <span className="spinner spinner-md tw:animate-spin" />
          <span>Agent is working</span>
        </div>
      )}
      {connected === false && (
        <p className="agent-composer-note">The agent is not connected to a model yet. Add OPENROUTER_API_KEY to the server .env file.</p>
      )}
      {speech.error && <p className="agent-composer-note">{speech.error}</p>}
      {note && <p className="agent-composer-note">{note}</p>}
      <div
        className={dragging ? "agent-box is-dropping" : "agent-box"}
        onDragOver={(event) => {
          if ([...(event.dataTransfer?.types || [])].includes("Files")) {
            event.preventDefault()
            setDragging(true)
          }
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(event) => {
          if (!event.dataTransfer?.files?.length) return
          event.preventDefault()
          setDragging(false)
          add(event.dataTransfer.files)
        }}
      >
        <VoiceWaves listening={speech.listening} />
        {files.length > 0 && (
          <div className="agent-files">
            {files.map((item) => (
              <span key={item.id} className="agent-file">
                {item.url && item.file.type.startsWith("image/") ? <img src={item.url} alt="" /> : <span className="agent-file-icon"><Icon name="file" size={16} /></span>}
                <span className="agent-file-name">{item.name}</span>
                <button type="button" onClick={() => remove(item)} aria-label={`Remove ${item.name}`}>×</button>
              </span>
            ))}
          </div>
        )}
        <textarea
          ref={textareaRef}
          maxLength={MAX_PROMPT}
          rows={1}
          value={message}
          disabled={speech.listening}
          placeholder="Ask Agent"
          enterKeyHint={touch ? "enter" : "send"}
          onChange={(event) => setMessage(event.target.value)}
          onPaste={(event) => {
            const pasted = [...(event.clipboardData?.files || [])]
            if (!pasted.length) return
            event.preventDefault()
            add(pasted)
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return
            if (event.metaKey || event.ctrlKey) {
              event.preventDefault()
              send()
              return
            }
            if (touch || event.shiftKey) return
            event.preventDefault()
            send()
          }}
        />
        <div className="agent-box-foot">
          <div className="agent-attach" ref={menuRef}>
            <button
              type="button"
              className={menu ? "agent-icon-button agent-plus is-on" : "agent-icon-button agent-plus"}
              aria-label="Add photos and files"
              aria-haspopup="menu"
              aria-expanded={menu}
              title="Add photos and files"
              disabled={files.length >= MAX_FILES}
              onClick={() => setMenu((open) => !open)}
            >
              <Icon name="plus" size={18} />
            </button>
            {menu && (
              <div className="agent-attach-menu" role="menu" aria-label="Add">
                {touch && (
                  <button type="button" role="menuitem" onClick={pick(cameraRef)}>
                    <Icon name="camera" size={24} />
                    <span>Camera</span>
                  </button>
                )}
                <button type="button" role="menuitem" onClick={pick(photosRef)}>
                  <Icon name="image" size={24} />
                  <span>Photos</span>
                </button>
                <button type="button" role="menuitem" onClick={pick(filesRef)}>
                  <Icon name="file" size={24} />
                  <span>Files</span>
                </button>
              </div>
            )}
            <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={chosen} />
            <input ref={photosRef} type="file" accept="image/*" multiple hidden onChange={chosen} />
            <input ref={filesRef} type="file" accept={DOCUMENTS} multiple hidden onChange={chosen} />
          </div>
          <div className="agent-box-actions">
            {speech.supported && (
              <button
                type="button"
                className={speech.listening ? "agent-icon-button is-listening" : "agent-icon-button"}
                title={speech.listening ? "Stop recording" : "Start voice input"}
                aria-label={speech.listening ? "Stop recording" : "Start voice input"}
                onClick={speech.listening ? speech.stop : speech.start}
              >
                <Icon name={speech.listening ? "stop" : "mic"} size={16} />
              </button>
            )}
            <button type="submit" className="agent-send-button" disabled={streaming || (!message.trim() && !files.length)} aria-label="Send">
              {streaming ? <span className="spinner spinner-md tw:animate-spin" /> : <Icon name="arrowUp" size={16} />}
            </button>
          </div>
        </div>
      </div>
    </form>
  )
}
