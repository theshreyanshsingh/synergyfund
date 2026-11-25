// Where and when a site photo was taken, as the phone reported it at the moment the photo was taken (the web page's
// CameraCapture asks the phone for its location while the camera is open). Staff see it under the photo's Info, with
// the distance from the house; contractors are never sent it.
//
// `status`: "shared" (the phone gave its position), "denied" (the person said no to location) or "unavailable" (the
// phone couldn't find its position in time, or has no location). The photo is filed whichever it is.

export const CAPTURE_STATUSES = ["shared", "denied", "unavailable"]

const MAX_ACCURACY = 100000
// A photo's time is the phone's; one claiming to be from the future or long ago gets the upload's time instead.
const AHEAD_MS = 10 * 60 * 1000
const BEHIND_MS = 60 * 24 * 60 * 60 * 1000

const round = (value, places) => Number(value.toFixed(places))

function asTime(value, now) {
  const time = new Date(value)
  const ms = time.getTime()
  return Number.isFinite(ms) && ms <= now + AHEAD_MS && ms >= now - BEHIND_MS ? time : null
}

// One photo's place as the page sent it, checked; null when nothing usable was sent (an older page).
export function cleanCapture(value, now = Date.now()) {
  if (!value || typeof value !== "object" || !CAPTURE_STATUSES.includes(value.status)) return null
  const takenAt = asTime(value.takenAt, now) || new Date(now)
  if (value.status !== "shared") return { status: value.status, takenAt }
  const lat = Number(value.lat)
  const lng = Number(value.lng)
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return { status: "unavailable", takenAt }
  const accuracy = Number(value.accuracy)
  return {
    status: "shared",
    takenAt,
    lat: round(lat, 6),
    lng: round(lng, 6),
    accuracy: Number.isFinite(accuracy) && accuracy >= 0 ? Math.min(Math.round(accuracy), MAX_ACCURACY) : null,
    fixedAt: asTime(value.fixedAt, now) || takenAt,
  }
}

// The `places` field of an upload: a JSON list, one entry per photo in the order the photos were sent.
export function readCaptures(raw, count, now = Date.now()) {
  let list = []
  try {
    list = JSON.parse(String(raw || "[]"))
  } catch {
    list = []
  }
  if (!Array.isArray(list)) list = []
  return Array.from({ length: count }, (_, index) => cleanCapture(list[index], now))
}

// Kept on the photo (DocumentFile.capture) as JSON, sealed like the other private fields.
export function captureField(capture) {
  return capture ? JSON.stringify(capture) : undefined
}

// For staff: what the photo's Info shows (null for a photo filed before places were kept, or from a library).
export function presentCapture(stored) {
  let capture = null
  try {
    capture = typeof stored === "string" ? JSON.parse(stored) : stored
  } catch {
    return null
  }
  if (!capture?.status) return null
  return {
    status: capture.status,
    takenAt: capture.takenAt ? new Date(capture.takenAt).toISOString() : null,
    ...(capture.status === "shared" ? { lat: capture.lat, lng: capture.lng, accuracy: capture.accuracy ?? null, fixedAt: capture.fixedAt ? new Date(capture.fixedAt).toISOString() : null } : {}),
  }
}
