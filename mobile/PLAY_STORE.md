# Publishing SynergiFund on Google Play

Everything in this repository is ready for an Android build. What is left needs your accounts: a Google Play developer
account, an Expo account, and filling in the Play Console forms below.

## What is already set up

- **App**: `com.synergifund.app`, targets Android 16 (API 36), which Google Play requires for new apps since
  August 31, 2026. The Android version code goes up by itself with each store build.
- **Permissions**: camera and microphone (site photos, receipts, calls), notifications, full-screen incoming calls
  and a foreground service while you are on a call. The template's "display over other apps" and shared-storage
  permissions are removed. Backups of app data to Google Drive are off (the sign-in stays on the phone).
- **Calls and notifications** (native, through Firebase Cloud Messaging): calls ring like a phone call, over the lock
  screen, with Answer and Decline, even when the app is closed; an ongoing call keeps going with the screen off and
  has Hang up in its notification; messages, mentions, tasks and the rest arrive as notifications that open the right
  page. Needs the Firebase project below.
- **Android behaviour**: the back button goes back a page; the keyboard no longer covers the chat box and other
  fields at the bottom; dark mode follows the phone; videos can go full screen; downloads open the share sheet.
- **Icons**: adaptive icon plus a one-colour version for Android 13+ themed icons.
- **Builds** (`eas.json`):
  - `preview`: an `.apk` to install straight on any Android phone, for testing.
  - `production`: an `.aab` for the Play Store, submitted to the internal testing track as a draft.
- **Privacy policy**: https://admin.synergifund.com/privacy (public, also linked from the sign-in page and Settings,
  which Google requires). It goes live with the next website deploy. Set `PRIVACY_CONTACT_EMAIL` on the web server
  to show a contact address on it.
- **Store images** in `store/android/`: the 512 × 512 icon, the 1024 × 500 feature graphic and six 1080 × 1920
  phone screenshots, made with invented demo data (no real properties or people).

## Firebase (calls and notifications on Android)

Android only lets apps ring and notify a closed or locked phone through Firebase Cloud Messaging (free).

1. Go to https://console.firebase.google.com, **Add project** (for example "SynergiFund"); Google Analytics is not
   needed.
2. In the project: **Add app → Android**, package name `com.synergifund.app`. Download **google-services.json** and
   put it in the `mobile/` folder (next to `app.json`). The next build has push switched on. It is kept out of git;
   for Expo's cloud builds (`eas build`), add it once in the Expo dashboard: project → Environment variables → Add,
   name `GOOGLE_SERVICES_JSON`, type file, upload the file, visibility Secret, for the preview and production
   environments.
3. **Project settings → Service accounts → Generate new private key.** This file is a secret: never commit it or send
   it in chat. On the server, set `FIREBASE_SERVICE_ACCOUNT` to its contents (or `FIREBASE_SERVICE_ACCOUNT_FILE` to
   its path) in the API's environment, then restart the API.
4. Open the app, sign in: the phone registers itself. Settings → Send a notification (admins) reaches phones too.

## Steps

1. **Google Play developer account** at https://play.google.com/console ($25 once). Choose an **organization**
   account (needs the company's D-U-N-S number). New *personal* accounts must first run a closed test with at least
   12 testers for 14 days before they can publish to production; organization accounts skip that.
2. **Expo account** (free) at https://expo.dev, then from this folder:
   ```bash
   cd mobile
   npx eas-cli@latest login
   npx eas-cli@latest init
   ```
   `init` links the project and adds its id to `app.json`; commit that change.
3. **Try it on an Android phone**:
   ```bash
   npx eas-cli@latest build --platform android --profile preview
   ```
   EAS gives a link and QR code to install the `.apk`. Check sign-in, a site photo, a call, a download, the chat
   box with the keyboard open, and the back button.
4. **Store build**:
   ```bash
   npx eas-cli@latest build --platform android --profile production
   ```
   EAS creates and keeps the app's signing key (Google Play then manages the final signing). Never delete it.
5. **Create the app in Play Console**: Create app → name `SynergiFund`, default language English (US), App, Free.
   Fill in the forms below and the store listing.
6. **Upload**: the first time, the easiest is to download the `.aab` from the EAS build page and upload it in
   Play Console → Testing → Internal testing → Create new release. After that, `eas submit` can do it:
   ```bash
   npx eas-cli@latest submit --platform android --profile production
   ```
   (`eas submit` needs a Google service account key, set up once with `npx eas-cli@latest credentials`.)
7. **Internal testing**: add the team's Google account emails as testers (up to 100). They get a Play Store link
   and the app updates through Play like any other.
8. **Production** (only if the app should be listed publicly): promote the release and send it for review.
   Private team apps can stay on internal testing for good.

## Building the store file on this Mac (without Expo's cloud)

Release builds are signed with SynergiFund's **upload key**, kept outside the project:
`~/secrets/synergifund-upload.jks` and `~/secrets/synergifund-upload.properties` (its password). **Back both up
somewhere safe** (a password manager): every future Play Store update must be signed with this same key. If it is
ever lost, Play Console → Setup → App signing lets you request a new upload key. (Google Play keeps the final app
signing key itself.) To use Expo's cloud builds later, upload this same key with `npx eas-cli@latest credentials`.

From the `mobile` folder:
```bash
npx expo prebuild --platform android
```
```bash
cd android && ./gradlew :app:bundleRelease :app:assembleRelease
```
The store file is `android/app/build/outputs/bundle/release/app-release.aab`; the `.apk` next to it in
`outputs/apk/release/` installs directly on a phone. Raise `android.versionCode` in `app.json` for every upload.

## Store listing

- **App name**: SynergiFund
- **Short description** (74 of 80 characters):
  Run your real estate portfolio: properties, draws, payments and team chat.
- **Full description**:

  SynergiFund is the private workspace for real estate investment teams. Everything about each house, from the
  purchase to the last draw, is in one place your partners, staff and contractors can open from their phone.

  • Properties: purchase price, ARV, rehab budget, loans and next steps for every house.
  • Rehab draws: budgets by line item, what was drawn, what is pending and what is left to withdraw.
  • Payments: mortgage payments, insurance, taxes and other bills, with what is due this week.
  • Expenses: contractors send costs with receipt photos; the team approves them.
  • Documents: contracts, closing statements and photos filed by property and company, with downloads to your phone.
  • Team chat and calls: a room for every property, channels, direct messages, and voice and video calls.
  • Tasks and calendar: who does what, and when.
  • The SynergiFund Agent: ask about your portfolio in plain words, work out an ARV from sold comps, or draft an email.

  Accounts are created by your workspace administrator.

- **App category**: Business
- **Contact email**: the address people may write to about the app (shown publicly on the listing).
- **Website**: https://admin.synergifund.com
- **Privacy policy**: https://admin.synergifund.com/privacy
- **Graphics**: `store/android/icon-512.png`, `store/android/feature-graphic.png`,
  `store/android/screenshots/*.png` (phone screenshots).

## App content forms (Play Console → Policy → App content)

These are suggested answers based on what the app does; check them before you submit.

- **Privacy policy**: https://admin.synergifund.com/privacy
- **App access**: "All or some functionality is restricted". Give Google a reviewer sign-in. Use a dedicated
  account that cannot see real business data, for example a Contractor assigned only to a demo property, and write
  in the instructions that it is a test account.
- **Ads**: No ads.
- **Content rating**: questionnaire category "Utility, Productivity, Communication or Other". Answer yes to "users
  can interact or exchange content" (chat and calls) and no to the rest. It usually comes out as Everyone / 3+ with
  "Users interact".
- **Target audience**: 18 and over only.
- **Foreground service permissions**: the app uses a microphone (and camera, on video) foreground service only while
  you are on a call, so the call keeps going when the phone locks. Choose "Phone calls / VoIP" style use and attach a
  short screen recording of a call continuing with the screen off.
- **Full-screen intent**: SynergiFund is a calling app (incoming voice and video calls ring over the lock screen).
- **Government apps**: No. **Financial features**: none (the app tracks your own records; it does not offer
  banking, loans or payments to the public). **Health**: No. **News**: No.
- **Data safety**:
  - Collects data: Yes. Shares data: No (the service providers in the privacy policy work on our behalf, which Google
    does not count as sharing). Encrypted in transit: Yes. Way to request deletion: Yes (through the workspace
    administrator, as the privacy policy says).
  - Data types, all "collected", for **App functionality** (name and email also for **Account management**), none
    for advertising or analytics:
    - Personal info: Name, Email address, User IDs (required)
    - Financial info: Other financial info (purchase prices, loans, expenses; optional)
    - Photos and videos: Photos, Videos (optional)
    - Audio: Voice or sound recordings (only for AI call notes, processed ephemerally; optional)
    - Files and docs (optional)
    - Messages: Other in-app messages (chat; optional)
    - App activity: Other user-generated content, App interactions (the team activity log)
    - Device or other IDs: the phone's push address, to deliver calls and notifications (App functionality)
  - Not collected: location, contacts, calendar from the phone, health, web browsing.

## Later

- **iPhone**: the same native calls and notifications (CallKit and Apple push) are the next step for the iOS app.
- Each year Google raises the required Android version. Upgrading the Expo SDK once a year keeps the app current.
