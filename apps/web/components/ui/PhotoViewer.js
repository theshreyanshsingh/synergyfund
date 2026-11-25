"use client"

import { useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Icon } from "./Icon"

const SWIPE = 50

// Photos full screen, inside the app: a tap on a photo in a chat or on a house opens it here rather than as a page of
// its own (which on a phone leaves the app, and ends a call). Swipe or ← → between them, Save to keep one, and × or
// Escape to close. `photos`: [{ url, name, download }] (`download`: the address that saves it, when there is one).
// `info(photo)`: what Info shows about a photo (when and where it was taken), or null for no Info button.
export function PhotoViewer({ photos, index, onIndex, onClose, info = null }) {
  const [mounted, setMounted] = useState(false)
  const [showInfo, setShowInfo] = useState(false)
  const closeRef = useRef(null)
  const swipe = useRef(null)
  const photo = photos[index]
  const many = photos.length > 1
  const step = (by) => onIndex((index + by + photos.length) % photos.length)

  useEffect(() => {
    setMounted(true)
    const opener = document.activeElement
    return () => opener?.focus?.({ preventScroll: true })
  }, [])

  useEffect(() => {
    if (!mounted) return undefined
    closeRef.current?.focus({ preventScroll: true })
    const onKey = (event) => {
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        onClose()
      } else if (many && event.key === "ArrowRight") step(1)
      else if (many && event.key === "ArrowLeft") step(-1)
    }
    document.addEventListener("keydown", onKey, true)
    return () => document.removeEventListener("keydown", onKey, true)
  }, [mounted, index, many])

  if (!mounted || !photo) return null
  const details = info ? info(photo) : null
  return createPortal(
    <div
      className="photo-viewer"
      role="dialog"
      aria-modal="true"
      aria-label={many ? `Photo ${index + 1} of ${photos.length}` : "Photo"}
      onTouchStart={(event) => { swipe.current = { x: event.touches[0].clientX, y: event.touches[0].clientY } }}
      onTouchEnd={(event) => {
        if (!swipe.current || !many) return
        const dx = event.changedTouches[0].clientX - swipe.current.x
        const dy = event.changedTouches[0].clientY - swipe.current.y
        swipe.current = null
        if (Math.abs(dx) > SWIPE && Math.abs(dx) > Math.abs(dy)) step(dx < 0 ? 1 : -1)
      }}
    >
      <div className="photo-viewer-bar">
        <button ref={closeRef} type="button" className="photo-viewer-button" onClick={onClose} aria-label="Close"><Icon name="close" size={20} /></button>
        <span className="photo-viewer-name">{many ? `${index + 1} of ${photos.length}` : photo.name}</span>
        <span className="photo-viewer-tools">
          {details && (
            <button type="button" className={showInfo ? "photo-viewer-button is-on" : "photo-viewer-button"} onClick={() => setShowInfo((open) => !open)} aria-label="Info" aria-pressed={showInfo} title="Info">
              <Icon name="info" size={19} />
            </button>
          )}
          {photo.download && <a className="photo-viewer-button" href={photo.download} aria-label={`Save ${photo.name}`} title="Save"><Icon name="download" size={19} /></a>}
        </span>
      </div>
      {/* (Touches inside don't swipe between photos: Info can hold a map to drag.) */}
      {details && showInfo && <section className="photo-viewer-info" aria-label="Photo info" onTouchStart={(event) => event.stopPropagation()} onTouchEnd={(event) => event.stopPropagation()}>{details}</section>}
      {/* A tap beside the photo closes it, as in Photos. */}
      <div className="photo-viewer-stage" onClick={onClose}>
        <img key={photo.url} src={photo.url} alt={photo.name} onClick={(event) => event.stopPropagation()} />
      </div>
      {many && (
        <>
          <button type="button" className="photo-viewer-step is-back" onClick={() => step(-1)} aria-label="Previous photo"><Icon name="back" size={22} /></button>
          <button type="button" className="photo-viewer-step is-next" onClick={() => step(1)} aria-label="Next photo"><Icon name="back" size={22} /></button>
        </>
      )}
    </div>,
    document.body,
  )
}
