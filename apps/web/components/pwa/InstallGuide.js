"use client"

import { useEffect, useState } from "react"
import { createPortal } from "react-dom"
import { Icon } from "../ui/Icon"

function iosBrowser() {
  const agent = typeof navigator === "undefined" ? "" : navigator.userAgent
  if (/CriOS/i.test(agent)) return "Chrome"
  if (/EdgiOS/i.test(agent)) return "Edge"
  if (/FxiOS/i.test(agent)) return "Firefox"
  return "Safari"
}

function PlusBox() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="4" y="4" width="16" height="16" rx="4" /><path d="M12 8v8M8 12h8" />
    </svg>
  )
}

function Dots() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      <circle cx="12" cy="5" r="1.7" /><circle cx="12" cy="12" r="1.7" /><circle cx="12" cy="19" r="1.7" />
    </svg>
  )
}

function guideFor(platform) {
  if (platform === "ios") {
    const browser = iosBrowser()
    const where = browser === "Safari"
      ? "at the bottom of the screen (or next to the address bar)"
      : browser === "Firefox"
        ? "in the menu (☰) at the bottom right"
        : "next to the address bar at the top"
    return {
      title: "Add SynergiFund to your Home Screen",
      intro: "iPhone and iPad install apps from the Share menu. It takes a few seconds.",
      steps: [
        { icon: <Icon name="share" size={18} />, text: <>Tap the <b>Share</b> button {where}.</> },
        { icon: <PlusBox />, text: <>Scroll down and tap <b>Add to Home Screen</b>.</> },
        { icon: <Icon name="tick" size={18} />, text: <>Tap <b>Add</b> in the top-right corner.</> },
        { icon: <Icon name="bell" size={18} />, text: <>Open <b>SynergiFund</b> from your Home Screen, then turn on notifications so calls and messages reach you.</> },
      ],
      note: "Don’t see Add to Home Screen? Open this page in Safari (or Chrome) first. Apps opened inside Gmail, WhatsApp or other apps cannot install it.",
    }
  }
  if (platform === "android") {
    return {
      title: "Install SynergiFund",
      intro: "Add it to your home screen like any other app.",
      steps: [
        { icon: <Dots />, text: <>Tap the browser menu <b>⋮</b> at the top right.</> },
        { icon: <PlusBox />, text: <>Tap <b>Install app</b> or <b>Add to Home screen</b>.</> },
        { icon: <Icon name="tick" size={18} />, text: <>Tap <b>Install</b>.</> },
        { icon: <Icon name="bell" size={18} />, text: <>Open <b>SynergiFund</b> from your home screen and turn on notifications.</> },
      ],
      note: "Using Samsung Internet or Firefox? The option is in the same menu, sometimes called Add page to.",
    }
  }
  if (platform === "safari") {
    return {
      title: "Add SynergiFund to your Dock",
      intro: "Safari on a Mac installs web apps from the File menu.",
      steps: [
        { icon: <Icon name="file" size={18} />, text: <>Open the <b>File</b> menu at the top of the screen.</> },
        { icon: <PlusBox />, text: <>Choose <b>Add to Dock…</b></> },
        { icon: <Icon name="tick" size={18} />, text: <>Click <b>Add</b>, then open SynergiFund from the Dock.</> },
      ],
    }
  }
  return {
    title: "Install SynergiFund",
    intro: "Chrome and Edge install web apps from the address bar.",
    steps: [
      { icon: <Icon name="popout" size={18} />, text: <>Click the <b>install icon</b> at the right end of the address bar.</> },
      { icon: <Dots />, text: <>Don’t see it? Open the browser menu <b>⋮</b> and choose <b>Cast, save and share</b> → <b>Install page as app</b> (Edge: <b>Apps</b> → <b>Install this site as an app</b>).</> },
      { icon: <Icon name="tick" size={18} />, text: <>Click <b>Install</b>. SynergiFund opens in its own window.</> },
    ],
  }
}

// Step-by-step install help for browsers that cannot show an install prompt themselves (iPhone, iPad, Safari).
export function InstallGuide({ platform, onClose }) {
  const guide = guideFor(platform)
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  useEffect(() => {
    function onKey(event) {
      if (event.key === "Escape") onClose()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onClose])
  if (!mounted) return null
  // Rendered at the page level so the sliding sidebar on phones cannot clip or shift it.
  return createPortal(
    <div className="install-guide-backdrop" onMouseDown={onClose}>
      <div className="install-guide" role="dialog" aria-modal="true" aria-label={guide.title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <span className="mark">S</span>
          <div>
            <strong>{guide.title}</strong>
            <span>{guide.intro}</span>
          </div>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" size={16} /></button>
        </header>
        <ol>
          {guide.steps.map((step, index) => (
            <li key={index}>
              <span className="install-guide-number">{index + 1}</span>
              <span className="install-guide-icon">{step.icon}</span>
              <span>{step.text}</span>
            </li>
          ))}
        </ol>
        {guide.note && <p className="install-guide-note">{guide.note}</p>}
        <button type="button" className="primary install-guide-done" onClick={onClose}>Got it</button>
      </div>
    </div>,
    document.body,
  )
}
