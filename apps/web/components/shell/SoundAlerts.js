"use client"

import { useEffect } from "react"
import { activeChatId, useChatEvents } from "../../lib/chatSocket"
import { playChime, setSoundPrefs, unlockSounds } from "../../lib/sounds"

// Plays the person's chime for a direct message, an @mention or a new notification while SynergiFund is on screen.
// Nothing plays for a conversation you are looking at, or when the app is in the background (the phone or computer
// shows the notification with its own sound then).
export function SoundAlerts({ user, chat }) {
  const me = user?.id
  const ringtone = user?.sounds?.ringtone
  const chime = user?.sounds?.chime
  useEffect(() => {
    setSoundPrefs({ ringtone, chime })
  }, [ringtone, chime])

  // Browsers only allow sound after a tap or key press.
  useEffect(() => {
    const events = ["pointerdown", "keydown", "touchstart"]
    const unlock = () => unlockSounds()
    for (const name of events) window.addEventListener(name, unlock, { capture: true, passive: true })
    return () => {
      for (const name of events) window.removeEventListener(name, unlock, { capture: true })
    }
  }, [])

  function onScreen() {
    return typeof document !== "undefined" && document.visibilityState === "visible"
  }

  useChatEvents({
    "message:new": ({ message, channel, read } = {}) => {
      if (!message || message.userId === me || read || !onScreen()) return
      const forMe = channel?.kind === "direct" || message.mentionsChannel || (message.mentionIds || []).includes(me)
      if (!forMe) return
      if (message.channelId === activeChatId() && document.hasFocus()) return
      playChime()
    },
    "notification:new": () => {
      if (onScreen()) playChime()
    },
  }, chat)
  return null
}
