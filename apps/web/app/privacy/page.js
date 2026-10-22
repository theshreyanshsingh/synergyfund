import Link from "next/link"

export const metadata = {
  title: "Privacy Policy · SynergiFund",
  description: "How SynergiFund and its phone app handle your information.",
}

const UPDATED = "October 22, 2026"

// Public: the Play Store and App Store listings link here, and it opens without signing in.
export default function PrivacyPage() {
  const contact = String(process.env.PRIVACY_CONTACT_EMAIL || "").trim()
  return (
    <main className="legal-page">
      <article className="legal-card">
        <Link href="/login" className="legal-brand"><span className="mark">S</span>SynergiFund</Link>
        <h1>Privacy Policy</h1>
        <p className="legal-updated">Last updated {UPDATED}</p>

        <p>
          SynergiFund is a private workspace for a real estate investment team: properties, renovation draws, expenses,
          loans, documents, tasks, chat and calls. This policy explains what information the SynergiFund website and the
          SynergiFund phone apps (for Android and iPhone) handle, why, and who it is shared with. The phone apps show the
          same SynergiFund workspace as the website, so this policy covers both.
        </p>

        <h2>Who can use SynergiFund</h2>
        <p>
          Accounts are created by a workspace administrator for the team, its contractors and the partners it works with.
          There is no public sign-up. SynergiFund is not meant for children and is not directed to anyone under 16.
        </p>

        <h2>Information we handle</h2>
        <ul>
          <li><b>Account details:</b> your name, email address, role, job title and the properties you are assigned to. Passwords are stored only as a one-way hash.</li>
          <li><b>Work you and your team add:</b> property details, loans, draws, expenses and receipts, documents, site photos and videos, tasks, calendar events, chat messages and shared files.</li>
          <li><b>Calls:</b> audio and video travel between the people on the call while it lasts, sometimes through a relay server when a direct connection is not possible. Calls are not recorded. Anyone on a call can turn on AI call notes, and everyone on the call sees when they are on. While they are on, what people say is transcribed, each piece of audio is discarded as soon as it is transcribed, and the written notes are saved in the conversation.</li>
          <li><b>Activity:</b> a log of actions in the workspace (for example, who added a cost or signed in, and when) so the team can see what changed.</li>
          <li><b>Notification settings:</b> if you turn on notifications, the address your browser or phone gives us for delivering them.</li>
          <li><b>Sign-in cookie:</b> one cookie keeps you signed in. Display preferences such as dark mode are stored on your device.</li>
        </ul>
        <p>We do not use advertising or analytics trackers, and we do not collect your location or contacts.</p>

        <h2>Camera, microphone and files in the phone apps</h2>
        <p>
          The phone apps ask for the camera and microphone only for what you choose to do: take site photos or receipt
          photos, record video, or join a call. Files you pick come in through your phone's own file picker. Files you
          download are handed to your phone's share sheet so you can save or send them where you choose.
        </p>

        <h2>How we use information</h2>
        <ul>
          <li>To run the workspace: show records to the people allowed to see them, keep budgets and payments up to date, and connect calls.</li>
          <li>To send the notifications and emails you or your team set off, such as an assigned task, an expense decision or an invitation.</li>
          <li>To answer questions you ask the SynergiFund Agent, for the AI teammate in property chats to keep renovation progress up to date, and to read the receipts you photograph so you don't have to type the items in.</li>
          <li>To keep a daily backup of the workspace, so it can be restored after a mistake or an outage.</li>
          <li>To keep accounts secure, for example signing out old sessions when a password is changed.</li>
        </ul>

        <h2>Who we share it with</h2>
        <p>We do not sell personal information or share it for advertising. We use service providers who process it for us:</p>
        <ul>
          <li><b>Hosting and file storage</b> for the workspace and its files.</li>
          <li><b>AI model providers</b> (through OpenRouter) when you ask the Agent a question, when the AI teammate reviews a property chat and its photos, when a receipt photo is read, and for AI call notes. Only what is needed for that request is sent.</li>
          <li><b>Web search</b> (Firecrawl) when the Agent looks up public information such as listings or comparable sales. Searches use public terms like addresses, not your private figures.</li>
          <li><b>Email delivery</b> (Resend) for notification and invitation emails.</li>
          <li><b>Push notification services</b> run by Google, Apple and browser makers, which deliver notifications to your device.</li>
          <li><b>Call relay servers</b> that pass call audio and video along when a direct connection is not possible.</li>
        </ul>
        <p>We may also disclose information when the law requires it.</p>

        <h2>Who in your team can see what</h2>
        <p>
          Access follows the role your administrator gives you. For example, contractors see only the properties they are
          assigned to and the costs they submitted, and company bills and loan details stay with the internal team.
        </p>

        <h2>Keeping and deleting information</h2>
        <p>
          Workspace records are kept while the workspace uses SynergiFund, because they are the team's business records.
          Temporary Agent chats are deleted after a day. When an administrator removes your account, you can no longer sign
          in and your sign-in details are deleted; records you added for the business, such as costs or documents, stay
          with the workspace. Daily backups are kept for 7 to 90 days (30 unless your administrator changes it), so
          something deleted can stay in a backup until that backup is removed. To have your account deleted, ask your
          workspace administrator
          {contact ? <> or write to <a href={`mailto:${contact}`}>{contact}</a></> : null}.
        </p>

        <h2>Security</h2>
        <p>
          Information travels over encrypted connections (HTTPS). Passwords are hashed, sessions end when a password is
          reset or changed, and download links made for the phone apps work for only a few minutes.
        </p>

        <h2>Changes and contact</h2>
        <p>
          We will update this page when our practices change and show the date at the top. For questions about this policy
          or your information, contact your workspace administrator{contact ? <> or <a href={`mailto:${contact}`}>{contact}</a></> : null}.
        </p>
      </article>
    </main>
  )
}
