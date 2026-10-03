import Link from "next/link"

export function DetailFrame({ backHref, backLabel, title, meta, actions, children }) {
  return (
    <div className="workspace">
      <div className="detail-bar">
        <div>
          <Link href={backHref} className="back-link">← {backLabel}</Link>
          <h1 className="page-title">{title}</h1>
          {meta && <p className="detail-meta">{meta}</p>}
        </div>
        {actions && <div className="detail-actions">{actions}</div>}
      </div>
      {children}
    </div>
  )
}
