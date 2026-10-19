"use client"

import { useSyncExternalStore } from "react"

// In the app installed on an iPhone or iPad there is no Back button: opening a file's address swaps the whole app for
// a file preview you cannot leave. There, files are fetched in the page and handed to the share sheet instead
// (Save to Files, Mail, Outlook, AirDrop…), so you stay where you were.

const TYPES = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  csv: "text/csv",
  txt: "text/plain",
  zip: "application/zip",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
  heif: "image/heif",
  mp4: "video/mp4",
  mov: "video/quicktime",
  m4v: "video/x-m4v",
}
// Very large files are not loaded into the page; they open in a window with a Done button instead.
const MAX_IN_PAGE = 400 * 1024 * 1024

export function inInstalledIosApp() {
  if (typeof window === "undefined") return false
  const agent = navigator.userAgent
  const ios = /iphone|ipad|ipod/i.test(agent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  const standalone = window.navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches
  return ios && Boolean(standalone)
}

function canShareFiles() {
  try {
    return Boolean(navigator.canShare?.({ files: [new File(["x"], "file.pdf", { type: "application/pdf" })] }))
  } catch {
    return false
  }
}

// One download at a time: { name, status: "loading" | "ready" | "error", progress, file, url, message }
let current = null
let controller = null
const listeners = new Set()

function set(next) {
  current = next
  for (const listener of listeners) listener()
}

function subscribe(listener) {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useDownload() {
  return useSyncExternalStore(subscribe, () => current, () => null)
}

export function closeDownload() {
  controller?.abort()
  controller = null
  set(null)
}

function nameFrom(response, url, fallback) {
  const header = response.headers.get("content-disposition") || ""
  const encoded = /filename\*=UTF-8''([^;]+)/i.exec(header)
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1].trim())
    } catch {}
  }
  const plain = /filename="([^"]+)"/i.exec(header)
  if (plain) return plain[1]
  return fallback || decodeURIComponent(new URL(url, location.href).pathname.split("/").pop() || "file")
}

function typeOf(name, given) {
  const extension = String(name).split(".").pop().toLowerCase()
  return TYPES[extension] || (given && given !== "application/octet-stream" ? given : "application/octet-stream")
}

// The share sheet: Save to Files, Mail, AirDrop… If the phone will not show it straight after loading (it wants a
// fresh tap), the tray offers a Save button that does.
export async function shareReady({ tapped = true } = {}) {
  const ready = current
  if (!ready?.file) return
  if (!navigator.canShare?.({ files: [ready.file] })) {
    // This kind of file cannot go to the share sheet: open it in a window with a Done button (needs a tap).
    if (!tapped) return
    window.open(ready.url, "_blank", "noopener")
    set(null)
    return
  }
  try {
    await navigator.share({ files: [ready.file] })
    if (current === ready) set(null)
  } catch (error) {
    // Cancelled from the share sheet: the file stays ready to save again.
    if (current === ready && error?.name !== "AbortError") set({ ...ready, message: "Tap Save to keep it." })
  }
}

// In the phone app, the page asks for a short-lived download link and hands it to the app, which saves the file and
// opens the share sheet (Save to Files, AirDrop, Mail…). The page's own sign-in cookie does not reach the app.
async function saveInNativeApp(url, name) {
  set({ name, status: "loading", progress: null, url })
  try {
    const target = new URL(url, location.href)
    const response = await fetch("/api/documents/download-link", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ path: `${target.pathname.replace(/^\/api/, "")}${target.search}` }),
    })
    const data = await response.json().catch(() => ({}))
    if (!response.ok || !data.path) throw new Error(data.error || "The file could not be downloaded.")
    window.ReactNativeWebView?.postMessage(JSON.stringify({ type: "download", url: new URL(`/api${data.path}`, location.origin).href, name }))
    set(null)
  } catch (error) {
    set({ name, status: "error", progress: null, url, message: error.message })
  }
}

// Downloads a file the way that works here. Returns false when the normal browser download should go ahead.
export function saveFile(url, { name = "", size = 0 } = {}) {
  if (typeof window !== "undefined" && window.SynergiFundNative && window.ReactNativeWebView) {
    saveInNativeApp(url, name)
    return true
  }
  if (!inInstalledIosApp()) return false
  if (!canShareFiles() || size > MAX_IN_PAGE) {
    window.open(url, "_blank", "noopener")
    return true
  }
  load(url, name, size)
  return true
}

async function load(url, hint, size) {
  controller?.abort()
  const mine = new AbortController()
  controller = mine
  const label = hint || ""
  set({ name: label, status: "loading", progress: null, url })
  try {
    const response = await fetch(url, { credentials: "same-origin", signal: mine.signal })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      throw new Error(body?.error || body?.message || "The file could not be downloaded.")
    }
    const name = nameFrom(response, url, hint)
    const total = Number(response.headers.get("content-length")) || size || 0
    let blob
    if (response.body && total) {
      const reader = response.body.getReader()
      const parts = []
      let received = 0
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        parts.push(value)
        received += value.length
        if (controller === mine) set({ name, status: "loading", progress: Math.min(99, Math.round((received / total) * 100)), url })
      }
      blob = new Blob(parts)
    } else {
      blob = await response.blob()
    }
    if (controller !== mine) return
    const file = new File([blob], name, { type: typeOf(name, response.headers.get("content-type") || blob.type) })
    controller = null
    set({ name, status: "ready", progress: 100, file, url, message: "" })
    await shareReady({ tapped: false })
  } catch (error) {
    if (error?.name === "AbortError" || controller !== mine) return
    controller = null
    set({ name: label, status: "error", url, message: error.message || "The file could not be downloaded." })
  }
}
