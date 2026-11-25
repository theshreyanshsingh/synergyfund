"use client"

// Where the phone is while site photos are taken, so staff can see where each one was taken (the photo's Info). The
// camera starts watching when it opens (the phone asks for location the first time); each photo is stamped with the
// time and the latest position. Photos are taken either way: a "no" or no position only marks them so.
//
// A photo's place: { takenAt, status: "shared" | "denied" | "unavailable", lat, lng, accuracy, fixedAt }.

// A position this old or older doesn't count for a photo taken now.
const FRESH_MS = 2 * 60 * 1000

let watchId = null
let watchers = 0
let fix = null
let status = "idle"

export function watchPlace() {
  if (typeof navigator === "undefined" || !navigator.geolocation) {
    status = "unavailable"
    return () => {}
  }
  watchers += 1
  if (watchId == null) {
    if (status !== "denied") status = "asking"
    watchId = navigator.geolocation.watchPosition(
      (position) => {
        fix = { lat: position.coords.latitude, lng: position.coords.longitude, accuracy: position.coords.accuracy, time: position.timestamp || Date.now() }
        status = "shared"
      },
      (error) => {
        // 1: the person (or the phone's settings) said no. Anything else: no position yet; keep watching.
        if (error?.code === 1) status = "denied"
        else if (!fix) status = "unavailable"
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 30000 },
    )
  }
  let stopped = false
  return () => {
    if (stopped) return
    stopped = true
    watchers -= 1
    if (watchers <= 0 && watchId != null) {
      navigator.geolocation.clearWatch(watchId)
      watchId = null
      watchers = 0
    }
  }
}

function fromFix(takenAt) {
  if (!fix || Math.abs(fix.time - takenAt) > FRESH_MS) return null
  return { status: "shared", lat: fix.lat, lng: fix.lng, accuracy: Math.round(fix.accuracy), fixedAt: new Date(fix.time).toISOString() }
}

// The place for a photo taken right now.
export function placeNow() {
  const takenAt = Date.now()
  return { takenAt: new Date(takenAt).toISOString(), ...(fromFix(takenAt) || { status: status === "denied" ? "denied" : "unavailable" }) }
}

// The places to send with photos, in their order: a photo taken before the first position arrived gets it if it came
// within two minutes. A photo with no place (one picked from the library) sends null.
export function shotPlaces(shots) {
  return shots.map((shot) => {
    const place = shot.place
    if (!place) return null
    if (place.status === "shared") return place
    const better = fromFix(new Date(place.takenAt).getTime())
    return better ? { ...place, ...better } : { ...place, status: status === "denied" ? "denied" : place.status }
  })
}
