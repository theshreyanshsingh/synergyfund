import Link from "next/link"
import { HeaderActions } from "./HeaderActions"

export function DetailFrame({ backHref, backLabel, title, meta, status, actions, children }) {
  return (
    <div className="workspace">
      <div className="detail-bar">
        <div className="detail-heading">
          <Link href={backHref} className="back-link">← {backLabel}</Link>
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
      {meta && <p className="detail-meta detail-meta-below">{meta}</p>}
      {children}
    </div>
  )
}
