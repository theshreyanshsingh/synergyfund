"use client"

import { useEffect } from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import { noteTitle, useBack } from "../../lib/back"
import { HeaderActions } from "./HeaderActions"

// Back goes one step back and says where: the page's previous step (a property's tab or folder), else the page you
// came from. Opened straight from a link or a new tab, it goes to `backHref` (the list) instead.
// metaAside: shown at the end of the line under the title on phones and tablets, where the header status is hidden.
export function DetailFrame({ backHref, backLabel, title, meta, status, metaAside, actions, children }) {
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
          <h1 className="page-title">{title}</h1>
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
