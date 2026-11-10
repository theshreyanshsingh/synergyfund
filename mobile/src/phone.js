import { Platform } from "react-native"
import Constants from "expo-constants"
import SynergiNative from "../modules/synergi-native"

// The native calls and notifications module (Android and iPhone builds). Null in Expo Go.
export const phone = SynergiNative

const VERSION = Constants.expoConfig?.version || "1.0.0"

// Pages where nobody is signed in yet: the phone registers once someone is.
export function signedOutPage(url) {
  return /\/(login|register|privacy)(\?|#|$)/.test(String(url || ""))
}

// A notification tap or Answer opens synergifund://open?path=/calls%3Fjoin%3D…: the page to show in the app.
export function pathFromLink(url) {
  const match = String(url || "").match(/^synergifund:\/\/open\?(?:.*&)?path=([^&#]+)/)
  if (!match) return ""
  let path = ""
  try {
    path = decodeURIComponent(match[1])
  } catch {
    return ""
  }
  return path.startsWith("/") && !path.startsWith("//") ? path : ""
}

// Goes to a notification's page while the app is open. The site switches pages in place, so a call in progress
// carries on; a page that does not (signed out, or an older site) loads it fresh.
export function openScript(origin, path) {
  return `(function () {
  var event = new CustomEvent("synergifund:open", { detail: ${JSON.stringify(path)}, cancelable: true });
  if (window.dispatchEvent(event)) location.href = ${JSON.stringify(`${origin}${path}`)};
})(); true;`
}

// Registers this phone's push address for whoever is signed in on the page; the page passes back the phone's key.
// An iPhone also gives its notification address and whether it is a test build (extra).
export function registerScript(token, extra = {}) {
  const body = { ...extra, token, platform: Platform.OS, appVersion: VERSION }
  return `(function () {
    if (!window.ReactNativeWebView) return;
    fetch("/api/push/native", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: ${JSON.stringify(JSON.stringify(body))} })
      .then(function (response) { return response.ok ? response.json() : null; })
      .then(function (data) {
        if (!data || !data.deviceKey) return;
        window.SynergiFundNative = Object.assign(window.SynergiFundNative || {}, { pushToken: ${JSON.stringify(token)}, pushReady: true });
        window.ReactNativeWebView.postMessage(JSON.stringify({ type: "push-registered", deviceKey: data.deviceKey }));
      })
      .catch(function () {});
  })(); true;`
}

// Android does not tell a web view when the app goes to the background, so the app does: the page then counts as
// away (the server sends this phone pushes, and the page does not ring over the phone's own ringtone).
// On iPhone only the background counts (Control Center or a Face ID prompt over the app is still the app on screen).
export function pageHidden(appState) {
  return Platform.OS === "ios" ? appState === "background" : appState !== "active"
}

export function visibilityScript(hidden) {
  return `(function () {
    try {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: function () { return ${hidden ? "\"hidden\"" : "\"visible\""}; } });
      Object.defineProperty(document, "hidden", { configurable: true, get: function () { return ${hidden ? "true" : "false"}; } });
      document.dispatchEvent(new Event("visibilitychange"));
    } catch (error) {}
  })(); true;`
}
