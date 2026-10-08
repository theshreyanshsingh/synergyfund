self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting())
})

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim())
})

self.addEventListener("fetch", () => {})

self.addEventListener("push", (event) => {
  const payload = { title: "SynergiFund", body: "", href: "/notifications" }
  try {
    Object.assign(payload, event.data?.json() || {})
  } catch {
    payload.body = event.data?.text() || ""
  }
  event.waitUntil(self.registration.showNotification(payload.title, {
    body: payload.body,
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { href: payload.href || "/notifications" },
  }))
})

self.addEventListener("notificationclick", (event) => {
  event.notification.close()
  const href = new URL(event.notification.data?.href || "/notifications", self.location.origin).href
  event.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    for (const windowClient of windows) {
      if (windowClient.url.startsWith(self.location.origin)) {
        windowClient.navigate(href)
        return windowClient.focus()
      }
    }
    return self.clients.openWindow(href)
  }))
})
