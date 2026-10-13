"use client"

import { useState } from "react"
import { api } from "../../lib/api"

// Finds the ways this device can reach others in a call: directly, through the internet (STUN), and through a relay (TURN).
async function gather(iceServers) {
  const found = { host: false, srflx: false, relay: false }
  const pc = new RTCPeerConnection({ iceServers })
  pc.createDataChannel("check")
  const done = new Promise((resolve) => {
    const timer = setTimeout(resolve, 9000)
    pc.onicecandidate = (event) => {
      if (!event.candidate) {
        clearTimeout(timer)
        resolve()
        return
      }
      const type = event.candidate.type || (/ typ (\w+)/.exec(event.candidate.candidate) || [])[1]
      if (type in found) found[type] = true
    }
  })
  await pc.setLocalDescription(await pc.createOffer())
  await done
  pc.close()
  return found
}

export function CallCheck({ admin }) {
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState("")

  async function run() {
    setBusy(true)
    setError("")
    setResult(null)
    try {
      if (typeof RTCPeerConnection === "undefined") throw new Error("This browser cannot make calls.")
      const net = await api("/calls/network")
      const found = await gather(net.iceServers || [])
      setResult({ ...found, provider: net.provider, relayConfigured: Boolean(net.relay) })
    } catch (err) {
      setError(err.message || "The test could not run.")
    } finally {
      setBusy(false)
    }
  }

  const rows = result ? [
    { label: "This device", ok: result.host, text: result.host ? "Ready for calls." : "No network found." },
    { label: "Direct connection", ok: result.srflx, text: result.srflx ? "Calls can connect directly on most networks." : "This network blocks direct calls." },
    {
      label: "Relay",
      ok: result.relay,
      text: result.relay
        ? "On. Calls connect even on mobile data and strict office networks."
        : result.relayConfigured
          ? "Set up, but this device could not reach it. Check the relay keys."
          : "Not set up. Calls with people on some networks (mobile data, office Wi‑Fi) will not connect.",
    },
  ] : []

  return (
    <div className="settings-row call-check">
      <div>
        <h2>Call connection</h2>
        <p>Test whether calls can connect from this device and network.</p>
        {error && <p className="banner">{error}</p>}
        {result && (
          <ul className="call-check-list">
            {rows.map((row) => (
              <li key={row.label} className={row.ok ? "is-ok" : "is-bad"}>
                <span aria-hidden="true">{row.ok ? "✓" : "✕"}</span>
                <strong>{row.label}</strong>
                <em>{row.text}</em>
              </li>
            ))}
          </ul>
        )}
        {admin && result && !result.relayConfigured && (
          <div className="call-check-help">
            <strong>Turn on the relay (Cloudflare, free allowance each month)</strong>
            <ol>
              <li>In the Cloudflare dashboard open <b>Realtime</b> → <b>TURN Server</b> and create a TURN key.</li>
              <li>Copy its <b>Key ID</b> and <b>API token</b>.</li>
              <li>On the API server set <code>CLOUDFLARE_TURN_KEY_ID</code> and <code>CLOUDFLARE_TURN_API_TOKEN</code>, then restart the API.</li>
              <li>Run this test again. Relay should show a tick.</li>
            </ol>
          </div>
        )}
      </div>
      <button type="button" className="primary" disabled={busy} onClick={run}>{busy ? "Testing…" : result ? "Test again" : "Test"}</button>
    </div>
  )
}
