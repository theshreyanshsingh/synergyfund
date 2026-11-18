"use client"

import { useEffect, useLayoutEffect, useRef, useState } from "react"
import { Icon } from "../ui/Icon"
import { prepareFile } from "../photos/CameraCapture"
import { AgentBottomSheet } from "./AgentSheets"
import { AgentTalk } from "./AgentTalk"
import { useSpeechInput } from "./useSpeechInput"

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

const joinWords = (current, text) => `${current}${current && !/\s$/.test(current) ? " " : ""}${text}`

// The box: what to ask on top; + (photos and files) on the left of its foot, and on the right the microphone (writes
// what is said into the box) and one round button: Talk (the wave, while the box is empty), the coloured arrow to
// send (once there is something to send), or a spinner while the Agent answers.
//
// The microphone turns the box into "Getting ready…" then "Listening…" with a moving coloured edge; what is heard is
// written in as it comes. ✓ keeps it; X puts the box back as it was.
//
// + on a phone or tablet is a sheet of Camera, Photos and Files (and Saved prompts, `onPrompts`); on a computer a
// small menu over the box. A temporary chat (`temporary`) has a dashed box and says it is not kept.
// `autoFocus` opens the keyboard at once (it runs in the tap that opened it, which phones require). `fill`
// ({ text, key }) puts a prompt in the box to send or edit. `blocked`: why the Agent can't answer now (this month's AI
// budget is used up). `voice` (useAgentVoice): while Talk is on it has the screen (AgentTalk) and what was typed waits.
export function AgentComposer({ onSend, streaming, connected, temporary = false, autoFocus = false, fill = null, placeholder = "Ask Agent anything…", blocked = "", voice = null, onPrompts = null }) {
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
  const before = useRef("")
  const live = useRef(files)
  live.current = files
  const talking = Boolean(voice?.on)
  const endTalk = useRef(null)
  endTalk.current = voice?.end
  const speech = useSpeechInput((text) => setMessage((current) => joinWords(current, text).slice(0, MAX_PROMPT)), { sounds: true })
  const dictating = speech.active
  const shown = dictating && speech.interim ? joinWords(message, speech.interim) : message

  useEffect(() => setTouch(touchScreen()), [])

  function grow() {
    const element = textareaRef.current
    if (!element) return
    element.style.height = "40px"
    element.style.height = `${element.scrollHeight}px`
  }

  useEffect(grow, [shown, talking])

  // The box going away (another view, the sheet closing) ends Talk mode and lets the microphone go.
  useEffect(() => () => endTalk.current?.(), [])

  useLayoutEffect(() => {
    if (autoFocus) textareaRef.current?.focus()
  }, [autoFocus])

  useEffect(() => {
    if (!fill?.key) return
    setMessage(fill.text.slice(0, MAX_PROMPT))
    const element = textareaRef.current
    if (!element) return
    element.focus()
    requestAnimationFrame(() => element.setSelectionRange(element.value.length, element.value.length))
  }, [fill?.key])

  // The computer's small menu closes on a click elsewhere or Escape (the phone's sheet closes itself).
  useEffect(() => {
    if (!menu || touch) return
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
  }, [menu, touch])

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
    if (dictating) return
    const text = message.trim()
    if ((!text && !files.length) || streaming) return
    // The page shows the sent photos from these addresses, so they are not released here.
    onSend(text, files.map((item) => ({ file: item.file, name: item.name, url: item.url, mime: item.file.type })))
    setMessage("")
    setFiles([])
    setNote("")
  }

  function dictate() {
    before.current = message
    setNote("")
    speech.start()
  }

  function cancelDictation() {
    speech.cancel()
    setMessage(before.current)
  }

  // Talk: dictation stops first (one use of the microphone at a time), then the Agent says hello and listens.
  function talk() {
    if (dictating) speech.cancel()
    setMenu(false)
    setNote("")
    voice.start()
  }

  const pick = (ref, close) => () => {
    close?.()
    setMenu(false)
    ref.current?.click()
  }
  const chosen = (event) => {
    add(event.target.files)
    event.target.value = ""
  }

  const hasSomething = Boolean(message.trim() || files.length)
  const canTalk = Boolean(voice?.ready) && !hasSomething
  const tiles = (close) => (
    <div className="agent-attach-tiles">
      {touch && (
        <button type="button" role="menuitem" onClick={pick(cameraRef, close)}>
          <Icon name="camera" size={22} />
          <span>Camera</span>
        </button>
      )}
      <button type="button" role="menuitem" onClick={pick(photosRef, close)}>
        <Icon name="image" size={22} />
        <span>Photos</span>
      </button>
      <button type="button" role="menuitem" onClick={pick(filesRef, close)}>
        <Icon name="file" size={22} />
        <span>Files</span>
      </button>
    </div>
  )

  let main
  if (streaming) {
    main = <button type="submit" className="agent-go is-busy" disabled aria-label="The Agent is answering"><span className="spinner spinner-md tw:animate-spin" /></button>
  } else if (canTalk) {
    main = (
      <button type="button" className="agent-go is-talk" title="Talk with the Agent and hear its answers" aria-label="Talk with the Agent" disabled={connected === false || Boolean(blocked)} onClick={talk}>
        <Icon name="talk" size={17} />
      </button>
    )
  } else {
    main = <button type="submit" className="agent-go is-send" disabled={!hasSomething} aria-label="Send"><Icon name="arrowUp" size={17} /></button>
  }

  return (
    <form className={temporary ? "agent-composer is-temporary" : "agent-composer"} onSubmit={send}>
      {connected === false && (
        <p className="agent-composer-note">The agent is not connected to a model yet. Add OPENROUTER_API_KEY to the server .env file.</p>
      )}
      {connected !== false && blocked && <p className="agent-composer-note is-blocked">{blocked}</p>}
      {speech.error && <p className="agent-composer-note">{speech.error}</p>}
      {note && <p className="agent-composer-note">{note}</p>}
      {voice?.error && !talking && !blocked && <p className="agent-composer-note">{voice.error}</p>}
      {talking && <AgentTalk voice={voice} />}
      <div
        className={["agent-box", dragging ? "is-dropping" : "", dictating ? "is-dictating" : ""].filter(Boolean).join(" ")}
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
          value={shown}
          readOnly={dictating}
          placeholder={dictating ? (speech.starting ? "Getting ready…" : "Listening…") : placeholder}
          enterKeyHint={touch ? "enter" : "send"}
          aria-label="Ask the Agent"
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
        {dictating ? (
          <div className="agent-box-foot">
            <button type="button" className="agent-round is-line" onClick={cancelDictation} aria-label="Stop and put back what was there" title="Cancel">
              <Icon name="close" size={16} />
            </button>
            <button type="button" className="agent-go is-done" onClick={speech.stop} disabled={speech.starting} aria-label="Done" title="Done">
              <Icon name="tick" size={17} />
            </button>
          </div>
        ) : (
          <div className="agent-box-foot">
            <div className="agent-attach" ref={menuRef}>
              <button
                type="button"
                className={menu ? "agent-round is-line agent-plus is-on" : "agent-round is-line agent-plus"}
                aria-label="Add photos and files"
                aria-haspopup="menu"
                aria-expanded={menu}
                title="Add photos and files"
                disabled={files.length >= MAX_FILES}
                onClick={() => setMenu((open) => !open)}
              >
                <Icon name="plus" size={17} />
              </button>
              {menu && !touch && <div className="agent-attach-menu" role="menu" aria-label="Add">{tiles()}</div>}
              <input ref={cameraRef} type="file" accept="image/*" capture="environment" hidden onChange={chosen} />
              <input ref={photosRef} type="file" accept="image/*" multiple hidden onChange={chosen} />
              <input ref={filesRef} type="file" accept={DOCUMENTS} multiple hidden onChange={chosen} />
            </div>
            <div className="agent-box-actions">
              {speech.supported && (
                <button type="button" className="agent-round" title="Say it instead of typing" aria-label="Say it instead of typing" onClick={dictate}>
                  <Icon name="mic" size={18} />
                </button>
              )}
              {main}
            </div>
          </div>
        )}
      </div>
      {menu && touch && (
        <AgentBottomSheet title="Add" className="agent-attach-sheet" onClose={() => setMenu(false)}>
          {(close) => (
            <>
              {tiles(close)}
              {onPrompts && (
                <button type="button" className="agent-sheet-row" onClick={() => { close(); onPrompts() }}>
                  <Icon name="starLine" size={18} />
                  <span>Saved prompts</span>
                  <Icon name="chevron" size={16} />
                </button>
              )}
            </>
          )}
        </AgentBottomSheet>
      )}
      {temporary && <p className="agent-composer-foot agent-temp-note">Temporary chats stay out of your history and are deleted within a day.</p>}
    </form>
  )
}
