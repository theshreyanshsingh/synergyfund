"use client"

import { useRef, useState } from "react"
import { FormSheet } from "../ui/FormSheet"
import { PhotoViewer } from "../ui/PhotoViewer"
import { CompsMap } from "./CompsMap"
import { shotPlaces } from "../../lib/photoPlace"
import { CameraCapture, prepareFile } from "../photos/CameraCapture"
import { api } from "../../lib/api"

const MAX_PHOTOS = 60

export function addedLabel(day) {
  const [year, month, date] = String(day || "").split("-").map(Number)
  if (!year || !month || !date) return ""
  return new Date(year, month - 1, date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const photoCount = (count) => `${count} ${count === 1 ? "photo" : "photos"}`

// Farther than this from the house, a photo's place is flagged.
const FAR_MILES = 0.5

// Miles between two points on the earth.
export function milesApart(a, b) {
  if (a?.lat == null || a?.lng == null || b?.lat == null || b?.lng == null) return null
  const rad = (degrees) => (degrees * Math.PI) / 180
  const dLat = rad(b.lat - a.lat)
  const dLng = rad(b.lng - a.lng)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2
  return 3958.8 * 2 * Math.asin(Math.min(1, Math.sqrt(h)))
}

export function distanceLabel(miles) {
  if (miles == null) return ""
  return miles < 0.1 ? `${Math.max(10, Math.round((miles * 5280) / 10) * 10)} ft` : `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`
}

function accuracyLabel(meters) {
  if (meters == null) return ""
  const feet = meters * 3.281
  return feet < 1000 ? `about ${Math.max(5, Math.round(feet / 5) * 5)} ft` : `about ${(feet / 5280).toFixed(1)} mi`
}

const takenLabel = (iso) => new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })

// A photo's Info for staff: when and by whom it was taken, and where, with how far that was from the house and a map.
// (Contractors' copies of the photos carry none of this, so they get no Info.)
function PhotoInfo({ photo, house }) {
  const capture = photo.capture
  const miles = capture?.status === "shared" ? milesApart(capture, house) : null
  const far = miles != null && miles > FAR_MILES
  return (
    <div className="photo-info">
      <dl>
        <div>
          <dt>Taken</dt>
          <dd>{capture?.takenAt ? takenLabel(capture.takenAt) : photo.addedOn ? `Added ${addedLabel(photo.addedOn)}` : "Not known"}{photo.takenBy ? ` · ${photo.takenBy}` : ""}</dd>
        </div>
        <div>
          <dt>Where</dt>
          <dd>
            {!capture && "No location recorded. It was added before locations were kept, or chosen from a photo library."}
            {capture?.status === "denied" && "Location not shared: the phone wasn't allowed to give its location."}
            {capture?.status === "unavailable" && "Location unavailable: the phone couldn't find where it was."}
            {capture?.status === "shared" && (
              <>
                {miles != null ? <strong className={far ? "photo-info-far" : "photo-info-near"}>{distanceLabel(miles)} from {house?.address || "the house"}</strong> : <strong>{capture.lat.toFixed(5)}, {capture.lng.toFixed(5)}</strong>}
                {capture.accuracy != null && <small>Accurate to {accuracyLabel(capture.accuracy)}</small>}
              </>
            )}
          </dd>
        </div>
      </dl>
      {capture?.status === "shared" && (
        <>
          <CompsMap className="photo-info-map" subject={house?.lat != null ? house : null} comps={[{ id: "photo", number: "P", lat: capture.lat, lng: capture.lng, address: "Where the photo was taken" }]} />
          <p className="photo-info-foot">
            <span>S the house · P the photo</span>
            <a href={`https://www.google.com/maps/search/?api=1&query=${capture.lat},${capture.lng}`} target="_blank" rel="noreferrer">Open in Maps</a>
          </p>
        </>
      )}
    </div>
  )
}

// A property's photos, newest first, each with the day it was added. A tap opens it full screen, inside the app.
// Staff (`house`: the property, for the distance) also get each photo's Info, and a flag on photos taken far from the
// house or with no location.
export function FiledPhotos({ photos, house = null }) {
  const [viewing, setViewing] = useState(-1)
  if (!photos.length) return <p className="property-missing">No photos yet.</p>
  const shown = photos.map((photo) => ({ ...photo, url: photo.url || `/api/documents/${photo.id}/raw`, download: `/api/documents/${photo.id}/download` }))
  const staff = (photo) => "capture" in photo
  return (
    <div className="property-photos">
      {viewing >= 0 && <PhotoViewer photos={shown} index={viewing} onIndex={setViewing} onClose={() => setViewing(-1)} info={(photo) => (staff(photo) ? <PhotoInfo photo={photo} house={house} /> : null)} />}
      {shown.map((photo, index) => {
        const capture = photo.capture
        const miles = capture?.status === "shared" ? milesApart(capture, house) : null
        const flag = staff(photo) && capture && (capture.status !== "shared" ? "No location" : miles != null && miles > FAR_MILES ? `${distanceLabel(miles)} away` : "")
        return (
          <figure key={photo.id} className="property-photo" data-photo={photo.id}>
            <a href={photo.url} target="_blank" rel="noreferrer" onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey) return
              event.preventDefault()
              setViewing(index)
            }}>
              <img src={photo.url} alt={photo.name} loading="lazy" />
              {flag && <span className={capture.status === "shared" ? "photo-flag is-far" : "photo-flag"}>{flag}</span>}
            </a>
            {photo.addedOn && <figcaption>Added {addedLabel(photo.addedOn)}</figcaption>}
          </figure>
        )
      })}
    </div>
  )
}

// The Photos tab: the team adds photos here, from the camera or the library. (A contractor's page has its own form,
// camera only, since their photos are the proof of the work on site.)
export function PhotosSection({ property, photos, canAdd, onAdded }) {
  const [adding, setAdding] = useState(false)
  const [message, setMessage] = useState("")
  return (
    <>
      <section className="panel property-card">
        <div className="property-card-head">
          <div>
            <h2>Photos</h2>
            <p className="property-missing">Photos of this property, newest first, each with the day it was added.</p>
          </div>
          {canAdd && <button type="button" className="primary" onClick={() => { setMessage(""); setAdding(true) }}>Add photos</button>}
        </div>
        {message && <p className="info-message">{message}</p>}
        <FiledPhotos photos={photos} house={property} />
      </section>
      {adding && (
        <AddPhotos
          property={property}
          onClose={() => setAdding(false)}
          onAdded={(count) => {
            setAdding(false)
            setMessage(`${photoCount(count)} added.`)
            onAdded?.()
          }}
        />
      )}
    </>
  )
}

function AddPhotos({ property, onClose, onAdded }) {
  const [shots, setShots] = useState([])
  const [note, setNote] = useState("")
  const [preparing, setPreparing] = useState(false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState("")
  const picker = useRef(null)

  async function choose(event) {
    const files = [...(event.target.files || [])]
    event.target.value = ""
    if (!files.length) return
    setError("")
    setPreparing(true)
    const ready = []
    for (const file of files.slice(0, Math.max(0, MAX_PHOTOS - shots.length))) ready.push(await prepareFile(file))
    const photos = ready.filter((shot) => shot.url)
    setShots((current) => [...current, ...photos])
    if (photos.length < ready.length) setError("Only photos can be added here, so the other files were left out.")
    else if (files.length > ready.length) setError(`Up to ${MAX_PHOTOS} photos can be added at a time.`)
    setPreparing(false)
  }

  const release = () => { for (const shot of shots) URL.revokeObjectURL(shot.url) }

  async function submit(event) {
    event.preventDefault()
    if (pending || preparing) return
    if (!shots.length) return setError("Take or choose at least one photo.")
    const form = new FormData()
    form.set("propertyId", property.id)
    form.set("note", note.trim())
    for (const shot of shots) form.append("photos", shot.file, shot.file.name)
    form.set("places", JSON.stringify(shotPlaces(shots)))
    setPending(true)
    setError("")
    try {
      const result = await api("/photo-sets", { method: "POST", body: form })
      release()
      onAdded(result.count)
    } catch (err) {
      setError(err.message)
      setPending(false)
    }
  }

  return (
    <FormSheet
      eyebrow={property.address}
      title="Add photos"
      hint="Take them now or choose them from your library. Each one shows today as the day it was added."
      onClose={() => { release(); onClose() }}
      onSubmit={submit}
      pending={pending || preparing}
      pendingLabel={preparing ? "Getting photos ready…" : `Adding ${photoCount(shots.length)}…`}
      error={error}
      submitLabel={shots.length ? `Add ${photoCount(shots.length)}` : "Add photos"}
    >
      <div className="form-grid">
        <div className="field wide">
          <span>Photos</span>
          <CameraCapture
            shots={shots}
            onChange={setShots}
            max={MAX_PHOTOS}
            locate
            emptyText="No photos yet. Take some or choose them from your library."
            actions={<button type="button" className="photo-pick" onClick={() => picker.current?.click()} disabled={shots.length >= MAX_PHOTOS}>Choose from library</button>}
          />
          <input ref={picker} name="library" type="file" accept="image/*,.heic,.heif" multiple hidden onChange={choose} />
        </div>
        <label className="field wide"><span>What changed on site (optional)</span><input name="note" value={note} onChange={(event) => setNote(event.target.value)} maxLength={500} /></label>
      </div>
    </FormSheet>
  )
}
