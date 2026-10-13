self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", () => {})

const AGENT = self.navigator.userAgent || ""
const APPLE_MOBILE = /iphone|ipad|ipod/i.test(AGENT) || (/macintosh/i.test(AGENT) && self.navigator.maxTouchPoints > 1)
// Only Chrome and Edge on a computer allow a push to show nothing while the site is open and in focus.
const DESKTOP_CHROMIUM = !APPLE_MOBILE && !/android|mobile/i.test(AGENT) && /chrome|chromium|edg\//i.test(AGENT)

function readPayload(event) {
  const payload = { title: "SynergiFund", body: "", href: "/notifications" }
  try {
    Object.assign(payload, event.data?.json() || {})
  } catch {
    payload.body = event.data?.text() || ""
  }
  return payload
}

// Every push must end in a visible notification: iPhones stop delivering to apps that skip one.
self.addEventListener("push", (event) => {
  const payload = readPayload(event)
  if (payload.kind === "call") {
    event.waitUntil(showCall(payload))
    return
  }
  if (payload.kind === "call-over") {
    event.waitUntil(showCallOver(payload))
    return
  }
  // Messages from the same conversation share a tag, so the newest replaces the last one and still alerts.
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    ...(payload.tag ? { tag: payload.tag, renotify: true } : {}),
    data: { href: payload.href || "/notifications" },
  }))
})

function callerName(title) {
  return String(title || "").replace(/ is (calling you|adding you to an? \w+ call)$/, "")
}

async function showCall(payload) {
  const tag = payload.tag || `call-${payload.callId}`
  // Chrome or Edge on a computer with SynergiFund open and in focus already shows the ringing card, so it skips
  // the notification. Phones, Safari and Firefox always show it.
  if (DESKTOP_CHROMIUM) {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
    if (windows.some((client) => client.visibilityState === "visible" && client.focused)) return
  }
  // A ring that arrives late (the phone was offline) is shown as a missed call instead.
  if (payload.sentAt && Date.now() - payload.sentAt > (payload.ringFor || 45000) + 15000) {
    const name = callerName(payload.title)
    return self.registration.showNotification(name ? `Missed call from ${name}` : "Missed call", {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      data: { kind: "call-over", href: "/calls" },
    })
  }
  const data = { kind: "call", callId: payload.callId, href: payload.href || "/calls", test: Boolean(payload.test) }
  try {
    // Rings like a phone call: stays until answered or declined, vibrates, and offers Answer and Decline where supported.
    return await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [600, 300, 600, 300, 600, 300, 600, 300, 600],
      timestamp: Date.now(),
      actions: [
        { action: "answer", title: payload.media === "video" ? "Answer video" : "Answer" },
        { action: "decline", title: "Decline" },
      ],
      data,
    })
  } catch {
    // If this device rejects any of the call options, still show a plain notification.
    return self.registration.showNotification(payload.title, { body: payload.body, icon: "/icon-192.png", badge: "/icon-192.png", tag, data })
  }
}

// Replaces the ringing notification with "Missed call" or "Call ended".
async function showCallOver(payload) {
  const open = await self.registration.getNotifications({ tag: payload.tag })
  for (const note of open) note.close()
  return self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    tag: payload.tag,
    silent: Boolean(payload.quiet),
    data: { kind: "call-over", href: payload.href || "/calls" },
  })
}

function openApp(path) {
  const href = new URL(path || "/notifications", self.location.origin).href
  return self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const windowClient of windows) {
      if (windowClient.url.startsWith(self.location.origin)) {
        return windowClient.navigate(href).then((client) => (client || windowClient).focus()).catch(() => windowClient.focus())
      }
    }
    return self.clients.openWindow(href)
  })
}

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {}
  event.notification.close()
  if (data.test) {
    // The Settings test call: Decline just closes it; anything else opens Settings.
    if (event.action !== "decline") event.waitUntil(openApp("/settings"))
    return
  }
  if (data.kind === "call" && event.action === "decline") {
    event.waitUntil(fetch(`/api/calls/${encodeURIComponent(data.callId)}/decline`, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: "{}" }).catch(() => {}))
    return
  }
  if (data.kind === "call") {
    // Answer joins straight away; tapping the notification itself opens the call screen to choose.
    const href = event.action === "answer" ? `${data.href}${data.href.includes("?") ? "&" : "?"}answer=1` : data.href
    event.waitUntil(openApp(href))
    return
  }
  event.waitUntil(openApp(data.href))
})
