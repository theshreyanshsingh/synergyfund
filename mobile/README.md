# SynergiFund phone app

An Expo (React Native) app for iPhone and Android. Step one shows the SynergiFund website inside the app, so every
screen works from day one, with the sign-in kept, downloads that go to the share sheet (Save to Files, AirDrop,
Mail), the camera and microphone, and links to mail, phone and maps opening in their own apps. Native notifications
and WhatsApp-style calls come next.

## Try it on your phone today (no Xcode needed)

1. Install **Expo Go** from the App Store (or Google Play).
2. On this Mac: `npm run dev:mobile` (from the repo root), or `cd mobile && npx expo start`.
3. Scan the QR code with the iPhone camera. The phone and the Mac need to be on the same Wi-Fi
   (or run `npx expo start --tunnel`).

The app opens https://admin.synergifund.com. To try a local copy of the website instead, use the Mac's address on
the Wi-Fi: `EXPO_PUBLIC_APP_URL=http://192.168.1.18:3000 npx expo start` (with `npm run dev` running).

## How it fits together

- `App.js`: the screen. It loads the website, keeps pages of the site inside the app and opens everything else in
  the right app, matches the phone's status bar to the light or dark theme, reloads if iOS closes the page in the
  background, and shows a Try Again screen when there is no connection.
- `src/downloads.js`: saving files. The website asks the API for a short-lived download link
  (`POST /api/documents/download-link`, five minutes, one address, GET only) and hands it to the app, which
  downloads it and opens the share sheet. The website knows it is inside the app from `window.SynergiFundNative`.
- `src/config.js`: which website the app shows.
- `app.json`: name, icons, bundle id `com.synergifund.app`, and the camera, microphone and photo permissions.

## Next steps

- **Notifications**: `expo-notifications` and Apple push. Needs a development build and the Apple Developer account.
- **Calls like WhatsApp**: `react-native-webrtc` for the call audio and video, CallKit (`react-native-callkeep`) for the
  incoming-call screen and VoIP push to ring a locked phone. Needs a real iPhone (the simulator cannot ring) and the
  Apple Developer account.
- **Builds**: `npx eas-cli@latest build` makes iPhone builds in the cloud (no Xcode on the Mac); TestFlight for the team.

Follow `AGENTS.md`: Expo changes every SDK release, so check the docs for this SDK (58) before using an Expo API.
