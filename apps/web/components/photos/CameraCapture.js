"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"

const MAX_SIDE = 2000
const QUALITY = 0.85

function makeId() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

function canvasToShot(canvas) {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => {
      if (!blob) return resolve(null)
      const file = new File([blob], `site-${Date.now()}-${Math.random().toString(36).slice(2, 6)}.jpg`, { type: "image/jpeg" })
      resolve({ id: makeId(), file, url: URL.createObjectURL(blob) })
    }, "image/jpeg", QUALITY)
  })
}

function drawScaled(source, width, height) {
  const scale = Math.min(1, MAX_SIDE / Math.max(width, height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(width * scale)
  canvas.height = Math.round(height * scale)
  canvas.getContext("2d").drawImage(source, 0, 0, canvas.width, canvas.height)
  return canvas
}

async function fileToShot(file) {
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" })
    const shot = await canvasToShot(drawScaled(bitmap, bitmap.width, bitmap.height))
    bitmap.close?.()
    if (shot) return shot
  } catch {}
  return { id: makeId(), file, url: URL.createObjectURL(file) }
}

function cameraSupported() {
  return typeof navigator !== "undefined" && Boolean(navigator.mediaDevices?.getUserMedia) && typeof window !== "undefined" && window.isSecureContext
}

export function CameraCapture({ shots, onChange, max = 60 }) {
  const [open, setOpen] = useState(false)
  const nativeInput = useRef(null)
  const live = useRef(shots)
  live.current = shots

  function remove(shot) {
    URL.revokeObjectURL(shot.url)
    onChange(shots.filter((item) => item.id !== shot.id))
  }

  async function addNative(event) {
    const files = [...(event.target.files || [])]
    event.target.value = ""
    const room = Math.max(0, max - live.current.length)
    const made = []
    for (const file of files.slice(0, room)) made.push(await fileToShot(file))
    onChange([...live.current, ...made])
  }

  function start() {
    if (cameraSupported()) setOpen(true)
    else nativeInput.current?.click()
  }

  return (
    <div className="camera-field">
      <div className="camera-field-actions">
        <button type="button" className="photo-pick camera-open" onClick={start} disabled={shots.length >= max}>
          <CameraIcon />
          {shots.length ? "Take more photos" : "Take photos"}
        </button>
        {shots.length > 0 && <span className="camera-count">{shots.length} {shots.length === 1 ? "photo" : "photos"} ready</span>}
      </div>
      <input ref={nativeInput} type="file" accept="image/*" capture="environment" multiple hidden onChange={addNative} />
      {shots.length > 0 ? (
        <div className="camera-picks">
          {shots.map((shot, index) => (
            <figure key={shot.id}>
              <img src={shot.url} alt={`Photo ${index + 1}`} />
              <button type="button" onClick={() => remove(shot)} aria-label={`Remove photo ${index + 1}`}>Remove</button>
            </figure>
          ))}
        </div>
      ) : (
        <em>No photos yet. Take them with the camera.</em>
      )}
      {open && (
        <CameraSession
          initial={shots}
          max={max}
          onCancel={() => setOpen(false)}
          onDone={(next) => {
            const kept = new Set(next.map((shot) => shot.id))
            for (const shot of shots) if (!kept.has(shot.id)) URL.revokeObjectURL(shot.url)
            onChange(next)
            setOpen(false)
          }}
          onFallback={() => {
            setOpen(false)
            nativeInput.current?.click()
          }}
        />
      )}
    </div>
  )
}

function CameraIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M4 8h3l2-3h6l2 3h3v11H4z" />
      <circle cx="12" cy="13" r="3.5" />
    </svg>
  )
}

function CameraSession({ initial, max, onCancel, onDone, onFallback }) {
  const videoRef = useRef(null)
  const streamRef = useRef(null)
  const created = useRef([])
  const [shots, setShots] = useState(initial)
  const [facing, setFacing] = useState("environment")
  const [error, setError] = useState("")
  const [ready, setReady] = useState(false)
  const [flash, setFlash] = useState(0)
  const [saving, setSaving] = useState(0)
  const [mounted, setMounted] = useState(false)

  useEffect(() => {
    setMounted(true)
    const { overflow } = document.body.style
    document.body.style.overflow = "hidden"
    return () => {
      document.body.style.overflow = overflow
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function begin() {
      setReady(false)
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: facing }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        })
        if (cancelled) {
          stream.getTracks().forEach((track) => track.stop())
          return
        }
        streamRef.current?.getTracks().forEach((track) => track.stop())
        streamRef.current = stream
        setError("")
        const video = videoRef.current
        if (video) {
          video.srcObject = stream
          await video.play().catch(() => {})
          setReady(true)
        }
      } catch {
        if (!cancelled) setError("The camera is blocked. Allow camera access for this site, or use the phone’s camera app instead.")
      }
    }
    if (mounted) begin()
    return () => {
      cancelled = true
    }
  }, [facing, mounted])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  async function take() {
    const video = videoRef.current
    if (!video?.videoWidth || shots.length + saving >= max) return
    setFlash((value) => value + 1)
    navigator.vibrate?.(25)
    setSaving((value) => value + 1)
    const canvas = drawScaled(video, video.videoWidth, video.videoHeight)
    try {
      const shot = await canvasToShot(canvas)
      if (!shot) return
      created.current.push(shot)
      setShots((current) => [...current, shot])
    } finally {
      setSaving((value) => value - 1)
    }
  }

  const total = shots.length + saving

  function remove(shot) {
    if (created.current.some((item) => item.id === shot.id)) URL.revokeObjectURL(shot.url)
    created.current = created.current.filter((item) => item.id !== shot.id)
    setShots((current) => current.filter((item) => item.id !== shot.id))
  }

  function cancel() {
    for (const shot of created.current) URL.revokeObjectURL(shot.url)
    onCancel()
  }

  if (!mounted) return null
  return createPortal(
    <div className="camera-sheet" role="dialog" aria-modal="true" aria-label="Take photos">
      <header>
        <button type="button" onClick={cancel}>Cancel</button>
        <div>
          <strong>{total ? `${total} ${total === 1 ? "photo" : "photos"}` : "Take photos"}</strong>
          <span>Tap the white button for each photo</span>
        </div>
        <button type="button" className="camera-done-top" disabled={!shots.length || saving > 0} onClick={() => onDone(shots)}>Done</button>
      </header>
      <div className="camera-stage">
        <video ref={videoRef} autoPlay muted playsInline />
        {flash > 0 && <i key={flash} className="camera-flash" aria-hidden="true" />}
        {!ready && !error && <p>Starting the camera…</p>}
        {error && (
          <div className="camera-error">
            <p>{error}</p>
            <button type="button" onClick={onFallback}>Open the phone camera</button>
          </div>
        )}
      </div>
      <footer>
        {shots.length > 0 && (
          <div className="camera-strip">
            {shots.map((shot, index) => (
              <button type="button" key={shot.id} onClick={() => remove(shot)} aria-label={`Remove photo ${index + 1}`}>
                <img src={shot.url} alt="" />
                <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
        )}
        <div className="camera-controls">
          <button type="button" className="camera-side" onClick={() => setFacing((current) => (current === "environment" ? "user" : "environment"))}>Flip</button>
          <button type="button" className="camera-shutter" aria-label="Take photo" disabled={!ready || Boolean(error) || total >= max} onClick={take}>
            <span />
          </button>
          <button type="button" className="camera-side camera-use" disabled={!shots.length || saving > 0} onClick={() => onDone(shots)}>
            {saving > 0 ? "Saving…" : `Use ${shots.length || ""}`}
          </button>
        </div>
      </footer>
    </div>,
    document.body,
  )
}
