# SynergiFund phone app

An Expo (React Native) app for iPhone and Android. Step one shows the SynergiFund website inside the app, so every
screen works from day one, with the sign-in kept, downloads that go to the share sheet (Save to Files, AirDrop,
Mail), the camera and microphone, and links to mail, phone and maps opening in their own apps. Native notifications
and WhatsApp-style calls come next.

## Try it on your phone today (no Xcode needed)

1. Install **Expo Go** from the App Store or Google Play.
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
- `src/phone.js` and `modules/synergi-native/` (Android, Kotlin): calls and notifications. Server messages arrive
  through Firebase (`SynergiMessagingService`); a call rings with a call-style notification and, on a locked phone,
  the incoming call screen (`IncomingCallActivity`, Answer and Decline); an ongoing call runs a foreground service
  (`CallService`) with Hang up; everything else is a notification that opens its page. The page inside the app tells
  the app when a call starts or ends and passes on rings it hears over its open connection.
- `app.config.js`: switches Firebase on when `google-services.json` is in this folder (see `PLAY_STORE.md`).
- `patches/`: a fix to `react-native-webview` (applied by `patch-package` on every install). On Android a file input
  that takes a photo now asks for the camera permission instead of doing nothing, and a picker that cannot open no
  longer leaves the page's other file inputs stuck. When upgrading `react-native-webview`, check whether the new
  version still needs it, and remake or delete the patch.
- `app.json`: name, icons, app id `com.synergifund.app` (iPhone and Android), and the camera, microphone and photo
  permissions. On Android the permissions the app does not need are removed (`blockedPermissions`), and the
  keyboard makes room for the field being typed in (Android apps draw edge to edge, so it would cover it otherwise).
- `eas.json`: cloud builds. `preview` makes an Android `.apk` to install directly; `production` makes the Play Store
  `.aab` (the version code goes up by itself).
- `store/android/`: the Play Store icon, feature graphic and phone screenshots (invented demo data).

## Google Play

See `PLAY_STORE.md`: what is set up, the steps (accounts, test build, store build, upload), the store listing text
and suggested answers for the Play Console forms.

## Testing on an Android emulator

Native code (the `modules` folder) needs a development build, not Expo Go:
```bash
npx expo run:android
```
To point the app at a local copy of the website on the emulator, run `adb reverse tcp:3000 tcp:3000` and start Expo
with `EXPO_PUBLIC_APP_URL=http://localhost:3000` (calls need a secure page, and localhost counts as one).

## Next steps

- **iPhone calls and notifications**: CallKit and Apple push (VoIP) for the same ringing over the lock screen. Needs a
  real iPhone and the Apple Developer account.
- **Builds**: `npx eas-cli@latest build` makes iPhone and Android builds in the cloud (no Xcode or Android Studio on
  the Mac); TestFlight and Google Play internal testing for the team.

Follow `AGENTS.md`: Expo changes every SDK release, so check the docs for this SDK (58) before using an Expo API.
