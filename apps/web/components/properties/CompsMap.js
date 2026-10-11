"use client"

import "leaflet/dist/leaflet.css"
import { useEffect, useRef, useState } from "react"

export function CompsMap({ subject, comps, onReady, className = "" }) {
  const box = useRef(null)
  const [state, setState] = useState("loading")

  const points = [
    ...(subject?.lat != null && subject?.lng != null ? [{ key: "subject", lat: subject.lat, lng: subject.lng, label: "S", title: subject.address, subject: true }] : []),
    ...comps.filter((comp) => comp.lat != null && comp.lng != null).map((comp) => ({ key: comp.id, lat: comp.lat, lng: comp.lng, label: String(comp.number), title: comp.address })),
  ]
  const signature = points.map((point) => `${point.key}:${point.lat.toFixed(5)},${point.lng.toFixed(5)}:${point.label}`).join("|")

  useEffect(() => {
    if (!box.current) return undefined
    if (!points.length) {
      setState("empty")
      onReady?.()
      return undefined
    }
    let map = null
    let cancelled = false
    import("leaflet").then(({ default: L }) => {
      if (cancelled || !box.current) return
      map = L.map(box.current, { zoomControl: true, attributionControl: true, scrollWheelZoom: false })
      const tiles = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        maxZoom: 19,
        subdomains: "abc",
        attribution: "© OpenStreetMap contributors",
        crossOrigin: true,
      }).addTo(map)
      const markers = points.map((point) => L.marker([point.lat, point.lng], {
        title: point.title,
        icon: L.divIcon({
          className: "",
          html: `<span class="map-pin${point.subject ? " is-subject" : ""}">${point.label}</span>`,
          iconSize: [28, 28],
          iconAnchor: [14, 14],
        }),
      }).bindTooltip(point.title).addTo(map))
      const group = L.featureGroup(markers)
      if (points.length === 1) map.setView([points[0].lat, points[0].lng], 15)
      else map.fitBounds(group.getBounds(), { padding: [36, 36], maxZoom: 16 })
      let done = false
      const ready = () => {
        if (done) return
        done = true
        setState("ready")
        onReady?.()
      }
      tiles.once("load", ready)
      setTimeout(ready, 4000)
    }).catch(() => {
      setState("error")
      onReady?.()
    })
    return () => {
      cancelled = true
      map?.remove()
    }
    // Rebuild only when the pins change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [signature])

  const missing = comps.filter((comp) => comp.lat == null || comp.lng == null)
  return (
    <div className={`comps-map ${className}`.trim()}>
      <div ref={box} className="comps-map-canvas" aria-label="Map of the property and its comps" />
      {state === "empty" && <p className="comps-map-note">No addresses could be placed on the map yet.</p>}
      {state === "error" && <p className="comps-map-note">The map could not load.</p>}
      {missing.length > 0 && points.length > 0 && (
        <p className="comps-map-foot">Not on the map: {missing.map((comp) => `#${comp.number} ${comp.address}`).join(", ")}. Check those addresses.</p>
      )}
    </div>
  )
}
