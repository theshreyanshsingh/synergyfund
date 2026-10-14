import Link from "next/link"
import { HeaderActions } from "./HeaderActions"

// metaAside: shown at the end of the line under the title on phones and tablets, where the header status is hidden.
export function DetailFrame({ backHref, backLabel, title, meta, status, metaAside, actions, children }) {
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
