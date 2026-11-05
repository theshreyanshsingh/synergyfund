"use client"

import { useEffect, useRef } from "react"

// A form in a sheet. Its error shows at the top of the form, and comes into view when it appears: on a phone you tap
// Save at the bottom of a long form, and a message out of sight looks like nothing happened.
export function FormSheet({ eyebrow, title, hint, onClose, onSubmit, submitLabel, pending, pendingLabel, error, children }) {
  const banner = useRef(null)
  useEffect(() => {
    if (error) banner.current?.scrollIntoView({ block: "nearest", behavior: "smooth" })
  }, [error])
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <form className="member-sheet" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>{eyebrow}</p>
            <h2>{title}</h2>
            {hint && <span>{hint}</span>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="member-sheet-body">
          {error && <div ref={banner} className="banner" role="alert">{error}</div>}
          {children}
        </div>
        {onSubmit && (
          <footer>
            <button type="button" className="tool" onClick={onClose}>Cancel</button>
            <button className="primary" type="submit" disabled={pending}>{pending ? pendingLabel || "Saving…" : submitLabel}</button>
          </footer>
        )}
      </form>
    </div>
  )
}

export function InfoSheet({ eyebrow, title, hint, onClose, children }) {
  return (
    <div className="sheet-backdrop" onMouseDown={onClose}>
      <section className="member-sheet" onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <p>{eyebrow}</p>
            <h2>{title}</h2>
            {hint && <span>{hint}</span>}
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close">×</button>
        </header>
        <div className="member-sheet-body">{children}</div>
        <footer>
          <span />
          <button type="button" className="primary" onClick={onClose}>Done</button>
        </footer>
      </section>
    </div>
  )
}
