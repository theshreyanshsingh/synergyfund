self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", () => {})

function readPayload(event) {
  const payload = { title: "SynergiFund", body: "", href: "/notifications" }
  try {
    Object.assign(payload, event.data?.json() || {})
  } catch {
    payload.body = event.data?.text() || ""
  }
  return payload
}

self.addEventListener("push", (event) => {
  const payload = readPayload(event)
  if (payload.kind === "call") {
    // A call rings like a phone call: it stays until answered or declined, vibrates, and offers Answer and Decline.
    event.waitUntil(self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag: payload.tag || `call-${payload.callId}`,
      renotify: true,
      requireInteraction: true,
      silent: false,
      vibrate: [600, 300, 600, 300, 600, 300, 600, 300, 600],
      timestamp: Date.now(),
      actions: [
        { action: "answer", title: payload.media === "video" ? "Answer video" : "Answer" },
        { action: "decline", title: "Decline" },
      ],
      data: { kind: "call", callId: payload.callId, href: payload.href || "/calls" },
    }))
    return
  }
  if (payload.kind === "call-over") {
    // Replace the ringing notification with "Missed call" or "Call ended".
    event.waitUntil(self.registration.getNotifications({ tag: payload.tag }).then((open) => {
      for (const note of open) note.close()
      return self.registration.showNotification(payload.title, {
        body: payload.body,
        icon: "/icon-192.png",
        badge: "/icon-192.png",
        tag: payload.tag,
        renotify: false,
        silent: Boolean(payload.quiet),
        data: { kind: "call-over", href: payload.href || "/calls" },
      })
    }))
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
