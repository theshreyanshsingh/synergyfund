# App Review: what Apple asked, and our answers

Two rejections so far:

- **Oct 26, 2026, Guideline 2.1 (Information Needed).** This is usual for a new developer account. Apple asked for:
  - a screen recording on a real iPhone;
  - the app's purpose and audience;
  - review steps with a demo login;
  - the outside services the app uses;
  - regional differences;
  - any regulation.
- **Nov 10, 2026, Guideline 3.2 (Business).** The app isn't for the general public. This is fixed: Unlisted App Distribution is approved.

What follows is what we send, and where it goes. The demo password stays only in App Store Connect's Sign-In fields; it is never written here.

## 1. App Review Information › Notes (added after the sign-in lines already there)

```
ABOUT THE APP
SynergiFund is the private workspace of a US real estate investment team: its partners, staff and renovation
contractors. It holds the team's properties, renovation budgets and draws, expenses and receipts, loans, documents,
tasks, team chat and voice/video calls, and an AI assistant (the Agent) that answers questions about the team's own
records. It is not for the general public: there is no sign-up, an administrator creates each account, and the app
is approved for Unlisted App Distribution.

HOW TO REVIEW
1. Sign in with the account above. Open Properties › Demo property: scope of work, site photos and receipts.
2. Expenses › Scan receipt: photograph any receipt. The first time, the app explains that receipts are read by an
   outside AI model and asks you to agree; you can skip it and type the items in.
3. Messages, or the Demo property's chat: tap a message to show its actions. Report (warning sign) opens the report
   form, which can also block the author.
4. Agent: the first time, the same AI notice appears (Agree and continue). Then ask "What is left in the budget for
   the demo property?"
5. Settings › App: notifications. Support page: https://admin.synergifund.com/support
The attached screen recording was made on an iPhone, starting from launching the app.

ACCOUNTS AND CONTENT
No in-app sign-up, purchases or subscriptions. Administrators create and delete accounts; anyone can ask for their
account to be deleted on the Support page or by email to contact@candidpromotions.com. Chat is only between members
of the team; anyone can report a message (the admins are told at once and can delete it or remove the person) and
block a person.

EXTERNAL SERVICES
- Amazon Web Services: our server and file storage (admin.synergifund.com, behind Cloudflare).
- OpenRouter: AI models for the Agent, Talk, receipt reading and call notes. Each person agrees to an in-app notice
  before anything of theirs is sent.
- Apple Push Notification service, Firebase Cloud Messaging and web push: notifications and incoming calls.
- Cloudflare Realtime: relay for voice and video calls.
- Resend: email notifications.
- Firecrawl: reading public web pages for the Agent.
- US Census Geocoder and OpenStreetMap: placing property addresses on a map.

REGIONS
The app works the same everywhere it is available, in English with US dollars. It is not offered in China mainland.

REGULATION
SynergiFund does not offer loans, payments, banking, investments or brokerage. It records the team's own properties,
costs and loan details for its own bookkeeping; no money moves through the app. It has no third-party protected
material.
```

## 2. Reply to App Review (App Store Connect › App Review › the message thread)

```
Hello, and thank you for reviewing SynergiFund. Here is the information you asked for. The same is in App Review
Information › Notes, with the demo sign-in in the Sign-In Information fields.

1. Screen recording
Attached to App Review Information (recorded on an iPhone, starting from launching the app). It shows signing in,
the demo property, filing a receipt, the team chat with Report and Block, and the Agent.

2. Purpose and audience
SynergiFund is the private workspace of a US real estate investment team: its partners, staff and renovation
contractors. It keeps each property's costs, renovation draws, loans, payments, documents, tasks and team
conversations in one place. It is not for the general public: an administrator creates every account, and the app
is approved for Unlisted App Distribution.

3. How to review
Sign in with the demo account in Sign-In Information, then:
- Properties › Demo property: scope of work, site photos, receipts.
- Expenses › Scan receipt (any receipt photo works).
- Messages or the Demo property's chat: tap a message for Report, which can also block the author.
- Agent: agree to the AI notice the first time, then ask about the demo property.
There is no sign-up or purchase. Account deletion: through the team's administrator, the Support page
(https://admin.synergifund.com/support) or contact@candidpromotions.com.

4. External services
Amazon Web Services (server and storage), Cloudflare (website and call relay), OpenRouter (AI models for the Agent,
Talk, receipt reading and call notes; each person agrees to an in-app notice first), Apple Push Notification
service, Firebase Cloud Messaging and web push (notifications and calls), Resend (email), Firecrawl (reading public
web pages for the Agent), US Census Geocoder and OpenStreetMap (maps of property addresses).

5. Regional differences
None. The app works the same in every region where it is available, in English with US dollars.

6. Regulated industry
SynergiFund does not offer loans, payments, banking, investments or brokerage, and no money moves through the app.
It records the team's own properties, costs and loans for its own bookkeeping, so no licence applies.

Thank you.
```

## 3. App Privacy (App Store Connect › App Privacy)

"Data Not Collected" is wrong and was a risk at review.

- **Tracking:** none. The app has no ads and no analytics SDKs.
- **How each type is held:** every type below is **linked to the person** and used only for **App Functionality**.

| Category | Data types |
| --- | --- |
| Contact Info | Name, Email Address |
| Location | Precise Location (where a site photo was taken, from app 1.0.5) |
| User Content | Emails or Text Messages (chat), Photos or Videos, Audio Data (Talk, call notes), Other User Content (documents, receipts, tasks, notes) |
| Financial Info | Other Financial Info (expenses, receipts, loans and costs that people enter) |
| Identifiers | User ID |
| Usage Data | Product Interaction (the workspace's activity log) |

Not collected:
- phone number;
- contacts;
- browsing or search history;
- health;
- payment info (no payments);
- device ID;
- diagnostics;
- sensitive info.

## 4. Other App Store Connect settings

- **Privacy Policy URL:** https://admin.synergifund.com/privacy
- **Support URL:** https://admin.synergifund.com/support. Change this once the Support page is deployed.
- **Availability:**
  - every country except China mainland. CallKit isn't allowed there, and China now also needs security and AI filings.
  - not on Mac or Apple Vision Pro.
- **Age rating:** the new question about sharing location. Site photos note where they were taken and show it only to the team's staff. That is not location sharing between users, and nothing is shown publicly.

## 5. Still to do by hand

- **Deploy the website.** The Support page and the AI notice must be live, because the reviewer uses the live site through the app.
- **Fix the demo account.** Its password is weak. Give it a strong one and update the Sign-In Information.
  - It should only see the Demo property.
  - The Demo property's chat needs a few messages from someone else, so there is something to Report.
- **Make a new screen recording on a real iPhone.** It must show the AI notice and Report/Block.
  - Start from launching the app: sign in, Demo property, Scan receipt, chat (tap a message › Report › Also block), then Agent (Agree, ask a question).
  - Replace the attachment in App Review Information.
- **Submit 1.0.5 when 1.0.3 is approved.** 1.0.5 (build 3) is on TestFlight and asks for location for site photos.
