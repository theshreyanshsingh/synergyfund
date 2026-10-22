const fs = require("fs")
const path = require("path")

// Firebase (Android push for calls and notifications). google-services.json is kept out of git: local builds read it
// from this folder, and Expo's cloud builds get it from the GOOGLE_SERVICES_JSON file variable (Expo dashboard →
// project → Environment variables). Without either, the app builds and runs without push.
module.exports = ({ config }) => {
  const local = path.join(__dirname, "google-services.json")
  const file = process.env.GOOGLE_SERVICES_JSON || (fs.existsSync(local) ? "./google-services.json" : "")
  if (file) config.android = { ...config.android, googleServicesFile: file }
  return config
}
