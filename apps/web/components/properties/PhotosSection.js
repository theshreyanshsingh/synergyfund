"use client"

import { useRef, useState } from "react"
import { FormSheet } from "../ui/FormSheet"
import { CameraCapture, prepareFile } from "../photos/CameraCapture"
import { api } from "../../lib/api"

const MAX_PHOTOS = 60

export function addedLabel(day) {
  const [year, month, date] = String(day || "").split("-").map(Number)
  if (!year || !month || !date) return ""
  return new Date(year, month - 1, date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
}

const photoCount = (count) => `${count} ${count === 1 ? "photo" : "photos"}`

// A property's photos, newest first, each with the day it was added.
export function FiledPhotos({ photos }) {
  if (!photos.length) return <p className="property-missing">No photos yet.</p>
  return (
    <div className="property-photos">
      {photos.map((photo) => {
        const href = photo.url || `/api/documents/${photo.id}/raw`
        return (
          <figure key={photo.id} className="property-photo" data-photo={photo.id}>
            <a href={href} target="_blank" rel="noreferrer">
              <img src={href} alt={photo.name} loading="lazy" />
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
        <FiledPhotos photos={photos} />
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
