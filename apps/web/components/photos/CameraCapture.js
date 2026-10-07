"use client"

import { useEffect, useRef, useState } from "react"

export function CameraCapture({ shots, onChange }) {
  const [open, setOpen] = useState(false)
  const [stream, setStream] = useState(null)
  const [error, setError] = useState("")

  function remove(shot) {
    URL.revokeObjectURL(shot.url)
    onChange(shots.filter((item) => item.id !== shot.id))
  }

  async function openCamera() {
    setError("")
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: "environment" } })
      setStream(next)
      setOpen(true)
    } catch {
      setStream(null)
      setError("Allow the camera to take site photos. Photos already on the phone are not accepted.")
      setOpen(true)
    }
  }

  function close(nextShots) {
    if (nextShots) {
      const kept = new Set(nextShots.map((shot) => shot.id))
      for (const shot of shots) {
        if (!kept.has(shot.id)) URL.revokeObjectURL(shot.url)
      }
      onChange(nextShots)
    }
    stream?.getTracks().forEach((track) => track.stop())
    setStream(null)
    setOpen(false)
  }

  return (
    <div className="camera-field">
      <button type="button" className="photo-pick" onClick={openCamera}>Add photos</button>
      {shots.length > 0 ? (
        <div className="camera-picks">
          {shots.map((shot) => (
            <figure key={shot.id}>
              <img src={shot.url} alt="" />
              <button type="button" onClick={() => remove(shot)}>Remove</button>
            </figure>
          ))}
        </div>
      ) : (
        <em>No photos yet. Take them with the camera.</em>
      )}
      {open && (
        <CameraSession
          initial={shots}
          stream={stream}
          error={error}
          onClose={() => close()}
          onDone={(next) => close(next)}
        />
      )}
    </div>
  )
}

function CameraSession({ initial, stream, error, onClose, onDone }) {
  const videoRef = useRef(null)
  const created = useRef([])
  const streamRef = useRef(stream)
  const [shots, setShots] = useState(initial)
  const [facing, setFacing] = useState("environment")
  const [cameraError, setCameraError] = useState(error)
  const [ready, setReady] = useState(false)

  useEffect(() => {
    streamRef.current = stream
    const video = videoRef.current
    if (!stream || !video) return undefined
    video.srcObject = stream
    video.play().then(() => setReady(true)).catch(() => setReady(false))
    return undefined
  }, [stream])

  useEffect(() => () => {
    streamRef.current?.getTracks().forEach((track) => track.stop())
  }, [])

  async function flip() {
    const nextFacing = facing === "environment" ? "user" : "environment"
    try {
      const next = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: nextFacing } })
      streamRef.current?.getTracks().forEach((track) => track.stop())
      streamRef.current = next
      setFacing(nextFacing)
      setCameraError("")
      if (videoRef.current) {
        videoRef.current.srcObject = next
        await videoRef.current.play()
        setReady(true)
      }
    } catch {
      setCameraError("The other camera is not available.")
    }
  }

  function take() {
    const video = videoRef.current
    if (!video?.videoWidth) return
    const canvas = document.createElement("canvas")
    canvas.width = video.videoWidth
    canvas.height = video.videoHeight
    canvas.getContext("2d").drawImage(video, 0, 0)
    canvas.toBlob((blob) => {
      if (!blob) return
      const file = new File([blob], `site-${Date.now()}.jpg`, { type: "image/jpeg" })
      const shot = { id: crypto.randomUUID(), file, url: URL.createObjectURL(blob) }
      created.current.push(shot)
      setShots((current) => [...current, shot])
    }, "image/jpeg", 0.92)
  }

  function remove(shot) {
    if (created.current.some((item) => item.id === shot.id)) URL.revokeObjectURL(shot.url)
    created.current = created.current.filter((item) => item.id !== shot.id)
    setShots((current) => current.filter((item) => item.id !== shot.id))
  }

  function cancel() {
    const kept = new Set(initial.map((shot) => shot.id))
    for (const shot of created.current) {
      if (!kept.has(shot.id)) URL.revokeObjectURL(shot.url)
    }
    onClose()
  }

  return (
    <div className="camera-sheet" role="dialog" aria-modal="true" aria-label="Take photos">
      <header>
        <div>
          <strong>Take photos</strong>
          <span>Use the camera. Library photos are not accepted.</span>
        </div>
        <button type="button" onClick={cancel}>Close</button>
      </header>
      <div className="camera-stage">
        <video ref={videoRef} autoPlay muted playsInline />
        {cameraError && <p>{cameraError}</p>}
      </div>
      <footer>
        <div className="camera-strip">
          {shots.map((shot) => (
            <button type="button" key={shot.id} onClick={() => remove(shot)} aria-label="Remove photo">
              <img src={shot.url} alt="" />
            </button>
          ))}
        </div>
        <div className="camera-controls">
          <button type="button" onClick={flip}>Flip</button>
          <button type="button" className="camera-shutter" aria-label="Take photo" disabled={!ready || Boolean(cameraError)} onClick={take} />
          <button type="button" className="primary" disabled={!shots.length} onClick={() => onDone(shots)}>
            Use {shots.length} {shots.length === 1 ? "photo" : "photos"}
          </button>
        </div>
      </footer>
    </div>
  )
}
