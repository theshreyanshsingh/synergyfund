# SynergiFund on the App Store (iPhone and iPad)

## What is set up

- Apple Developer team **Candid Promotions LLC** (Team ID `8PJ65D3FXP`), set as `ios.appleTeamId` in `app.json`.
- Bundle ID `com.synergifund.app`, registered under Certificates, IDs & Profiles; the app record in App Store
  Connect uses it.
- Version `expo.version` (shown in the store) and build number `ios.buildNumber` in `app.json`. **Every upload needs
  a higher build number** (or a new version): raise `ios.buildNumber` before building again.
- Signing is automatic: Xcode signs with Apple's cloud-managed distribution certificate through the Apple ID added in
  Xcode › Settings › Accounts. Nothing to keep in `~/secrets` for iPhone.
- Speech recognition, camera, microphone and photo library messages are in `ios.infoPlist`. The speech one is needed
  because the Agent's voice input uses Apple's Speech framework inside the web view; without it iOS closes the app.

## Building and uploading on this Mac

Needs Xcode (26.4 or newer for Expo SDK 58) selected with `sudo xcode-select -s /Applications/Xcode.app/Contents/Developer`.

From the `mobile` folder:
```bash
npx expo prebuild --platform ios
```
```bash
cd ios && xcodebuild -workspace SynergiFund.xcworkspace -scheme SynergiFund -configuration Release -destination 'generic/platform=iOS' -archivePath build/SynergiFund.xcarchive DEVELOPMENT_TEAM=8PJ65D3FXP CODE_SIGNING_ALLOWED=NO archive
```
```bash
xcodebuild -exportArchive -archivePath build/SynergiFund.xcarchive -exportPath build/upload -exportOptionsPlist ../store/ios/ExportOptions.plist -allowProvisioningUpdates
```
The archive is made unsigned on purpose: a signed archive first needs a development profile, and Apple only issues
those once an iPhone is registered to the team. The export step signs it for the App Store and uploads it to App
Store Connect (`store/ios/ExportOptions.plist`). Apple then processes the build for 5–30 minutes before it shows in
TestFlight and can be picked for review. Run it with `EXPO_PUBLIC_APP_URL` unset so the app opens the live site.

## Store listing (App Store Connect › the app › App Store)

- **Name**: SynergiFund
- **Subtitle** (26 of 30): Real estate team workspace
- **Promotional text**: Photograph a receipt and split it across properties, track rehab draws and payments, and talk
  to your team, all in one place.
- **Description**:

  SynergiFund is the private workspace for real estate investment teams. Everything about each house, from the
  purchase to the last draw, is in one place your partners, staff and contractors can open from their phone.

  • Properties: purchase price, ARV, rehab budget, loans and next steps for every house.
  • Receipts: contractors photograph a receipt and the store, items and tax are read for them. They check it, pick
    the property (or split it between several) and submit it for approval.
  • Expense tracking: what is being spent on each property, by category and by contractor, with exports to Excel,
    CSV and QuickBooks.
  • Rehab draws: budgets by line item, what was drawn, what is pending and what is left to withdraw.
  • Payments: mortgage payments, insurance, taxes and other bills, with what is due this week.
  • Documents: contracts, closing statements and photos filed by property and company.
  • Team chat and calls: a room for every property, channels, direct messages, and voice and video calls.
  • Tasks and calendar: who does what, and when.
  • The SynergiFund Agent: ask about your portfolio in plain words, attach a photo or a document, work out an ARV
    from sold comps, or draft an email.

  Accounts are created by your workspace administrator.

- **Keywords** (92 of 100): real estate,investor,rehab,draws,receipts,expenses,property,flip,contractor,construction,CRM
- **Support URL** and **Marketing URL**: https://admin.synergifund.com
- **Privacy Policy URL**: https://admin.synergifund.com/privacy
- **Category**: Business (secondary: Productivity). **Price**: Free.
- **Copyright**: 2026 Candid Promotions LLC
- **Screenshots**: 6.9-inch iPhone (1320 × 2868) and, because the app runs on iPad, 13-inch iPad (2064 × 2752).

## App Review information

- **Sign-in required**: a reviewer account that cannot see real business data: a Contractor assigned only to a demo
  property with sample data. Admin, finance and member accounts see the whole real portfolio.
- **First review (October 2026)**: Apple asked for more information (Guideline 2.1, usual for a new developer
  account): a screen recording on a real iPhone starting from launching the app, the app's purpose and audience,
  review instructions with the demo login, the outside services it uses, regional differences and any regulation.
  The full reply, what to record and how to set up the reviewer account are in
  `~/Desktop/SynergiFund App Store/App Review reply.txt`; keep the same text in App Review Information › Notes.
- **Chat safety (Guideline 1.2)**: anyone can report a message (the admins are notified at once with a link to it)
  and block a person (their messages are hidden; no direct messages either way). Admins can delete any message and
  remove people.
- **Distribution**: requested as Unlisted App Distribution (on the App Store, reachable only by link), because the
  app is for teams whose administrators create the accounts (Guideline 3.2).

## App Privacy (App Store Connect › App Privacy)

Suggested answers based on what the app does; check them before you publish. No tracking, no third-party ads.
Data is linked to the person's account and used for **App Functionality** only:
- Contact Info: Name, Email Address. Identifiers: User ID.
- User Content: Photos or Videos, Audio Data (calls and voice input), Customer Support, Other User Content (chat,
  documents, receipts).
- Financial Info: Other Financial Info (purchase prices, loans, expenses).

## On iPhone for now

- Calls work while the app is open; leaving the app ends a call (no CallKit yet).
- No push notifications on iPhone yet (the native calls and notifications module is Android-only). Both need Apple
  push (APNs) set up first.
