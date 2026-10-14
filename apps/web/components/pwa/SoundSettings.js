"use client"

import { useState } from "react"
import { CHIMES, RINGTONES, cleanSounds } from "@synergifund/shared"
import { useSession } from "../shell/Providers"
import { api } from "../../lib/api"
import { previewChime, previewRingtone, setSoundPrefs } from "../../lib/sounds"
import { Icon } from "../ui/Icon"

// Settings › App: the ringtone for incoming calls and the chime for new messages, with a Play button to hear each.
// Saved to the person's account, so every device they use plays the same sounds.
export function SoundSettings() {
  const session = useSession()
  const saved = cleanSounds(session?.user?.sounds)
  const [busy, setBusy] = useState("")
  const [error, setError] = useState("")

  async function choose(key, value) {
    setError("")
    setBusy(key)
    // Heard right away, and used straight away even before the save finishes.
    if (key === "ringtone") previewRingtone(value)
    else previewChime(value)
    setSoundPrefs({ ...saved, [key]: value })
    try {
      const data = await api("/auth/me/sounds", { method: "PATCH", body: { [key]: value } })
      session.setUser(data.user)
    } catch (err) {
      setSoundPrefs(saved)
      setError(err.message)
    } finally {
      setBusy("")
    }
  }

  return (
    <div className="settings-row sound-settings">
      <div>
        <h2>Sounds</h2>
        <p>What you hear while SynergiFund is open: a ringtone when someone calls, and a chime for direct messages, @mentions and notifications. When the app is closed, your phone or computer plays its own notification sound.</p>
        {error && <p className="banner">{error}</p>}
      </div>
      <div className="sound-pickers">
        <SoundPicker label="Incoming call" value={saved.ringtone} options={RINGTONES} busy={busy === "ringtone"} onChange={(value) => choose("ringtone", value)} onPlay={() => previewRingtone(saved.ringtone)} />
        <SoundPicker label="New message" value={saved.chime} options={CHIMES} busy={busy === "chime"} onChange={(value) => choose("chime", value)} onPlay={() => previewChime(saved.chime)} />
      </div>
    </div>
  )
}

function SoundPicker({ label, value, options, busy, onChange, onPlay }) {
  const silent = value === "off"
  return (
    <div className="sound-picker">
      <label>
        <span>{label}</span>
        <select value={value} disabled={busy} onChange={(event) => onChange(event.target.value)}>
          {options.map((option) => <option key={option.id} value={option.id}>{option.name}</option>)}
        </select>
      </label>
      <button type="button" className="tool" onClick={onPlay} disabled={silent && label === "New message"} aria-label={`Play the ${label.toLowerCase()} sound`}>
        <Icon name="play" size={13} /> Play
      </button>
    </div>
  )
}
