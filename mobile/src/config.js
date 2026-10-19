// The SynergiFund website the app shows. To try a local copy on a phone on the same Wi-Fi, start Expo with
// EXPO_PUBLIC_APP_URL set to the Mac's address, for example: EXPO_PUBLIC_APP_URL=http://192.168.1.18:3000 npx expo start
export const APP_URL = (process.env.EXPO_PUBLIC_APP_URL || "https://admin.synergifund.com").replace(/\/+$/, "")

export const APP_ORIGIN = (APP_URL.match(/^https?:\/\/[^/]+/i) || [APP_URL])[0].toLowerCase()

// A page of the website itself (it stays in the app); anything else opens in the right app (Mail, Phone, Safari).
export function isAppPage(url) {
  const value = String(url || "").toLowerCase()
  return value === APP_ORIGIN || value.startsWith(`${APP_ORIGIN}/`) || value.startsWith(`${APP_ORIGIN}?`) || value.startsWith(`${APP_ORIGIN}#`)
}
