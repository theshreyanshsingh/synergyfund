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
// Apple (iPhone, iPad, Safari on a Mac) turns notifications off for sites that receive a push and show nothing.
const MUST_SHOW = APPLE_MOBILE || (/safari/i.test(AGENT) && !/chrome|chromium|crios|edg|fxios|firefox|android/i.test(AGENT))

// Call notes kept between pushes (the worker can be stopped at any time): which calls are over on this device,
// and which ringing notifications were swiped away. Entries older than a day are cleared.
const CALL_NOTES = "synergifund-call-notes"

async function readNote(name) {
  try {
    const cache = await caches.open(CALL_NOTES)
    const found = await cache.match(`/__call-note/${name}`)
    return found ? await found.json() : null
  } catch {
    return null
  }
}

async function writeNote(name, value) {
  try {
    const cache = await caches.open(CALL_NOTES)
    await cache.put(`/__call-note/${name}`, new Response(JSON.stringify({ ...value, savedAt: Date.now() }), { headers: { "Content-Type": "application/json" } }))
    for (const request of await cache.keys()) {
      const entry = await cache.match(request)
      const note = entry ? await entry.json().catch(() => null) : null
      if (!note || Date.now() - (note.savedAt || 0) > 24 * 3600 * 1000) await cache.delete(request)
    }
  } catch {}
}

async function onScreen() {
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true })
  return windows.some((client) => client.visibilityState === "visible" && client.focused)
}

async function ownEndpoint() {
  try {
    const subscription = await self.registration.pushManager.getSubscription()
    return subscription?.endpoint || ""
  } catch {
    return ""
  }
}

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
  const visible = await onScreen()
  // Chrome or Edge on a computer with SynergiFund open and in focus already shows the ringing card, so it skips
  // the notification. Phones, Safari and Firefox show the first one.
  if (DESKTOP_CHROMIUM && visible) return
  // The server sends the notification again every few seconds so it keeps ringing. A late copy must not
  // bring back a call that was answered, declined or ended here, or a notification that was swiped away.
  const started = Number(payload.ringStartedAt) || 0
  const over = await readNote(`over-${payload.callId}`)
  if (over && (!started || (over.at || 0) >= started)) {
    if (!MUST_SHOW) return
    return self.registration.showNotification(over.title, { body: over.body, icon: "/icon-192.png", badge: "/icon-192.png", tag, silent: true, data: { kind: "call-over", href: over.href || "/calls" } })
  }
  if (payload.repeat) {
    // Swiped away here, or SynergiFund is open on this screen and already ringing there: a repeat stays quiet.
    const dismissed = await readNote(`dismissed-${payload.callId}`)
    if (visible || (dismissed && started && dismissed.ringStartedAt === started)) {
      if (!MUST_SHOW) return
      return showRinging(payload, tag, true)
    }
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
  return showRinging(payload, tag, false)
}

// Rings like a phone call: stays until answered or declined, vibrates, and offers Answer and Decline where supported.
// Quiet: the same notification replaced without sound or vibration.
async function showRinging(payload, tag, quiet) {
  const data = callData(payload)
  try {
    return await self.registration.showNotification(payload.title, {
      body: payload.body,
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      tag,
      renotify: !quiet,
      requireInteraction: true,
      silent: quiet,
      ...(quiet ? {} : { vibrate: [600, 300, 600, 300, 600, 300, 600, 300, 600] }),
      timestamp: Date.now(),
      actions: [
        { action: "answer", title: payload.media === "video" ? "Answer video" : "Answer" },
        { action: "decline", title: "Decline" },
      ],
      data,
    })
  } catch {
    // If this device rejects any of the call options, still show a plain notification.
    return self.registration.showNotification(payload.title, { body: payload.body, icon: "/icon-192.png", badge: "/icon-192.png", tag, silent: quiet, data })
  }
}

function callData(payload) {
  return { kind: "call", callId: payload.callId, href: payload.href || "/calls", test: Boolean(payload.test), ringStartedAt: Number(payload.ringStartedAt) || 0 }
}

// Replaces the ringing notification with "Missed call", "Call ended" or "Answered on another device".
async function showCallOver(payload) {
  await writeNote(`over-${payload.callId}`, { at: Number(payload.at) || Date.now(), title: payload.title, body: payload.body, href: payload.href || "/calls" })
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

function post(path, body = {}) {
  return fetch(path, { method: "POST", credentials: "include", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }).catch(() => {})
}

// Remembers on this device that this ring was dealt with here, so a copy already on its way does not ring again.
// Marked with the ring's own start time, so if the same call rings this person again later it still rings.
function handledHere(notification, declined) {
  const data = notification.data || {}
  return writeNote(`over-${data.callId}`, { at: data.ringStartedAt || Date.now(), title: declined ? "Call declined" : "Call in progress", body: notification.body || "", href: "/calls" })
}

self.addEventListener("notificationclick", (event) => {
  const data = event.notification.data || {}
  if (data.kind === "call" && !data.test) {
    event.waitUntil(answerOrDecline(event, data))
    return
  }
  if (data.test) {
    // The Settings test call: any tap stops the test ringing; Decline just closes it, anything else opens Settings.
    event.waitUntil((async () => {
      await writeNote("over-test", { at: data.ringStartedAt || Date.now(), title: "Test call finished", body: "", href: "/settings" })
      event.notification.close()
      await post("/api/calls/test-notification/stop")
      if (event.action !== "decline") await openApp("/settings")
    })())
    return
  }
  event.notification.close()
  event.waitUntil(openApp(data.href))
})

async function answerOrDecline(event, data) {
  const declined = event.action === "decline"
  // Noted before the notification closes, so the close below is not mistaken for a swipe.
  await handledHere(event.notification, declined)
  event.notification.close()
  if (declined) {
    await post(`/api/calls/${encodeURIComponent(data.callId)}/decline`, { endpoint: await ownEndpoint() })
    return
  }
  // Answer joins straight away; tapping the notification itself opens the call screen to choose.
  const href = event.action === "answer" ? `${data.href}${data.href.includes("?") ? "&" : "?"}answer=1` : data.href
  await openApp(href)
}

// Swiping a ringing notification away stops it coming back on this device. The call still rings in the app,
// and Decline is still the way to turn it down.
self.addEventListener("notificationclose", (event) => {
  const data = event.notification.data || {}
  if (data.kind !== "call") return
  if (data.test) {
    event.waitUntil(Promise.all([writeNote("dismissed-test", { ringStartedAt: data.ringStartedAt || 0 }), post("/api/calls/test-notification/stop")]))
    return
  }
  event.waitUntil((async () => {
    // Closed because it was answered, declined or replaced, not swiped away.
    const still = await self.registration.getNotifications({ tag: event.notification.tag })
    if (still.length) return
    const over = await readNote(`over-${data.callId}`)
    if (over && (over.at || 0) >= (data.ringStartedAt || 0)) return
    await writeNote(`dismissed-${data.callId}`, { ringStartedAt: data.ringStartedAt || 0 })
    await post(`/api/calls/${encodeURIComponent(data.callId)}/silence`)
  })())
})
