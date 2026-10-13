"use client"

import { useSyncExternalStore } from "react"
import { api } from "./api"
import { refreshPushEndpoint } from "./chatSocket"

const INSTALLED_KEY = "synergifund-installed"
const listeners = new Set()
let snapshot = null
let pushChecked = false
let pushOn = false
let standaloneQuery = null

function standaloneMedia() {
  if (!standaloneQuery) standaloneQuery = window.matchMedia("(display-mode: standalone)")
  return standaloneQuery
}

function platform() {
  const agent = navigator.userAgent
  const ios = /iphone|ipad|ipod/i.test(agent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
  if (ios) return "ios"
  if (/android/i.test(agent)) return "android"
  if ("onbeforeinstallprompt" in window) return "chromium"
  if (/^((?!chrome|android|crios|fxios).)*safari/i.test(agent)) return "safari"
  return "other"
}

function rememberedInstall() {
  try {
    return localStorage.getItem(INSTALLED_KEY) === "1"
  } catch {
    return false
  }
}

function read() {
  const standalone = standaloneMedia().matches || window.navigator.standalone === true
  if (standalone) {
    try {
      localStorage.setItem(INSTALLED_KEY, "1")
    } catch {}
  }
  const kind = platform()
  const pushSupported = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window
  return {
    ready: true,
    standalone,
    installed: standalone || rememberedInstall(),
    // Firefox and some desktop browsers cannot install web apps at all.
    installable: kind !== "other",
    platform: kind,
    installEvent: window.__sfInstall || null,
    pushSupported: pushSupported && !(kind === "ios" && !standalone),
    pushOn,
    pushChecked,
    // iPhone Safari has no Notification API until the app is installed; that is "unsupported", not "blocked".
    permission: "Notification" in window ? Notification.permission : "unsupported",
  }
}

function emit() {
  snapshot = read()
  for (const listener of listeners) listener()
}

function checkPush() {
  if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
    pushChecked = true
    emit()
    return
  }
  // getRegistration answers right away; `ready` can wait forever if the worker never registered.
  navigator.serviceWorker.getRegistration()
    .then((registration) => registration?.pushManager.getSubscription() ?? null)
    .then((subscription) => {
      pushOn = Boolean(subscription)
    })
    .catch(() => {})
    .finally(() => {
      pushChecked = true
      emit()
    })
}

function subscribe(listener) {
  listeners.add(listener)
  if (listeners.size === 1) {
    window.addEventListener("sf-pwa", emit)
    standaloneMedia().addEventListener?.("change", emit)
    if (!pushChecked) checkPush()
    // Pick up anything that happened before the first subscriber arrived.
    queueMicrotask(emit)
  }
  return () => {
    listeners.delete(listener)
    if (!listeners.size) {
      window.removeEventListener("sf-pwa", emit)
      standaloneMedia().removeEventListener?.("change", emit)
    }
  }
}

const SERVER = { ready: false, standalone: false, installed: false, installable: false, platform: "other", installEvent: null, pushSupported: false, pushOn: false, pushChecked: false, permission: "default" }

export function usePwa() {
  return useSyncExternalStore(subscribe, () => snapshot || (snapshot = read()), () => SERVER)
}

export async function installApp() {
  const event = window.__sfInstall
  if (!event) return false
  event.prompt()
  const choice = await event.userChoice.catch(() => ({ outcome: "dismissed" }))
  window.__sfInstall = null
  if (choice.outcome === "accepted") {
    try {
      localStorage.setItem(INSTALLED_KEY, "1")
    } catch {}
  }
  emit()
  return choice.outcome === "accepted"
}

export function installSteps(state) {
  if (state.platform === "ios") return "Tap the Share button, then Add to Home Screen."
  if (state.platform === "safari") return "In Safari, choose File, then Add to Dock."
  if (state.platform === "android") return "Open the browser menu and tap Install app or Add to Home screen."
  return "Use the install icon at the right of the address bar, or the browser menu’s Install SynergiFund."
}

async function workerRegistration() {
  if (!(await navigator.serviceWorker.getRegistration())) await navigator.serviceWorker.register("/sw.js")
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise((_, reject) => setTimeout(() => reject(new Error("The app’s background worker did not start. Reload the page and try again.")), 10000)),
  ])
}

export async function enablePush() {
  if (!("Notification" in window)) throw new Error("This browser cannot receive push notifications.")
  const permission = await Notification.requestPermission()
  emit()
  if (permission !== "granted") throw new Error("Notifications are blocked. Allow them for this site in the browser settings, then try again.")
  const registration = await workerRegistration()
  const { publicKey } = await api("/push/vapid-public-key")
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(publicKey),
  })
  await api("/push/subscribe", { method: "POST", body: subscription.toJSON() })
  pushOn = true
  emit()
  refreshPushEndpoint()
}

export async function disablePush() {
  const registration = await navigator.serviceWorker.getRegistration()
  const subscription = await registration?.pushManager.getSubscription()
  if (subscription) {
    await api("/push/subscribe", { method: "DELETE", body: { endpoint: subscription.endpoint } })
    await subscription.unsubscribe()
  }
  pushOn = false
  emit()
  refreshPushEndpoint()
}

function urlBase64ToUint8Array(value) {
  const padding = "=".repeat((4 - (value.length % 4)) % 4)
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/")
  const raw = atob(base64)
  return Uint8Array.from(raw, (char) => char.charCodeAt(0))
}
