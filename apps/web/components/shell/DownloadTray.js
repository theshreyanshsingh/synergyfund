"use client"

import { useEffect } from "react"
import { Icon } from "../ui/Icon"
import { closeDownload, saveFile, shareReady, useDownload } from "../../lib/download"

// In the app installed on an iPhone, a tap on any file download (a Download link, Download zip, Export Excel, a chat
// file) is caught here so the app is never replaced by a file preview with no way back. The file loads in the page
// and opens in the share sheet; this tray shows the progress, and a Save button when the phone wants another tap.
export function DownloadTray() {
  const download = useDownload()

  useEffect(() => {
    function onClick(event) {
      if (event.defaultPrevented || event.button > 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return
      const link = event.target instanceof Element ? event.target.closest("a[href]") : null
      // Links that open their own window (with a Done button) are fine as they are.
      if (!link || (link.target && link.target !== "_self")) return
      const url = new URL(link.href, location.href)
      if (url.origin !== location.origin || !url.pathname.startsWith("/api/")) return
      if (saveFile(url.href, { name: link.dataset.name || "", size: Number(link.dataset.size) || 0 })) event.preventDefault()
    }
    document.addEventListener("click", onClick)
    return () => document.removeEventListener("click", onClick)
  }, [])

  if (!download) return null
  const { name, status, progress, message } = download
  return (
    <div className={`download-tray is-${status}`} role="status" aria-live="polite">
      <span className="download-tray-icon" aria-hidden="true">
        {status === "loading" ? <span className="download-spinner" /> : <Icon name={status === "error" ? "alert" : "file"} size={18} />}
      </span>
      <span className="download-tray-copy">
        <strong title={name}>{name || (status === "error" ? "Download failed" : "Downloading")}</strong>
        <small>
          {status === "loading" ? (progress == null ? "Preparing…" : `Preparing… ${progress}%`) : status === "error" ? message : message || "Ready to save"}
        </small>
      </span>
      {status === "ready" && (
        <button type="button" className="primary download-tray-save" onClick={() => shareReady()}>
          <Icon name="download" size={14} /> Save
        </button>
      )}
      <button type="button" className="icon-btn download-tray-close" onClick={closeDownload} aria-label={status === "loading" ? "Cancel download" : "Close"}>
        <Icon name="close" size={16} />
      </button>
    </div>
  )
}
