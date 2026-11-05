"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { noteTitle, useBack } from "../../lib/back"
import { useCopy } from "../../lib/useCopy"
import { HeaderActions } from "./HeaderActions"
import { Icon } from "./Icon"

// Back goes one step back and says where: the page's previous step (a property's tab or folder), else the page you
// came from. Opened straight from a link or a new tab, it goes to `backHref` (the list) instead.
// metaAside: shown at the end of the line under the title on phones and tablets, where the header status is hidden.
// copyText: a small button by the title copies it (a property's whole address), with copyLabel as its name.
export function DetailFrame({ backHref, backLabel, title, meta, status, metaAside, actions, copyText = "", copyLabel = "Copy", children }) {
  const pathname = usePathname()
  const back = useBack()
  useEffect(() => {
    noteTitle(pathname, title)
  }, [pathname, title])
  return (
    <div className="workspace">
      <div className="detail-bar">
        <div className="detail-heading">
          {back.label ? (
            <button type="button" className="back-link" onClick={back.go} title={`Back to ${back.label}`}>← {back.label}</button>
          ) : (
            <Link href={backHref} className="back-link">← {backLabel}</Link>
          )}
          {copyText ? (
            <div className="detail-title-row">
              <h1 className="page-title">{title}</h1>
              <CopyButton text={copyText} label={copyLabel} />
            </div>
          ) : (
            <h1 className="page-title">{title}</h1>
          )}
          {meta && <p className="detail-meta">{meta}</p>}
        </div>
        {(status || actions) && (
          <div className="detail-actions">
            {actions && <HeaderActions>{actions}</HeaderActions>}
            {status && <span className="detail-status">{status}</span>}
          </div>
        )}
      </div>
      {meta && (
        <p className={metaAside ? "detail-meta detail-meta-below has-aside" : "detail-meta detail-meta-below"}>
          <span>{meta}</span>
          {metaAside && <span className="detail-meta-aside">{metaAside}</span>}
        </p>
      )}
      {children}
    </div>
  )
}

// Copies the text, and says so: a tick for a moment, and "Copied" for a screen reader.
function CopyButton({ text, label }) {
  const [copied, copy] = useCopy()
  const said = copied === "yes" ? "Copied" : copied === "no" ? "Could not copy" : label
  return (
    <>
      <button type="button" className={copied === "yes" ? "title-copy is-done" : "title-copy"} onClick={() => copy(text)} aria-label={said} title={said}>
        <Icon name={copied === "yes" ? "tick" : "copy"} size={15} />
      </button>
      <span className="sr-only" aria-live="polite">{copied === "yes" ? `${label}: copied` : copied === "no" ? "Could not copy" : ""}</span>
    </>
  )
}
