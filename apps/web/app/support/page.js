import Link from "next/link"
import { supportEmail } from "../../lib/contact"

export const metadata = {
  title: "Support · SynergiFund",
  description: "Help with SynergiFund and its phone apps, and how to reach us.",
}

// Public: the App Store and Play Store listings link here as the app's support page, and it opens without signing in.
export default function SupportPage() {
  const email = supportEmail()
  return (
    <main className="legal-page">
      <article className="legal-card">
        <Link href="/login" className="legal-brand"><span className="mark">S</span>SynergiFund</Link>
        <h1>Support</h1>

        <p>
          SynergiFund is the private workspace of a real estate investment team: its properties, renovation draws,
          expenses, loans, documents, tasks, chat and calls. The SynergiFund apps for iPhone, iPad and Android open the
          same workspace as the website.
        </p>

        <h2>Contact us</h2>
        <p>
          For help with the app, your account or your information, email <a href={`mailto:${email}`}>{email}</a>. We
          answer within one business day.
        </p>

        <h2>Getting an account</h2>
        <p>
          SynergiFund is for the team, its contractors and the partners it works with. There is no public sign-up: a
          workspace administrator creates each person's account, and the invitation email has a link to choose a password.
        </p>

        <h2>Signing in</h2>
        <ul>
          <li>Your invitation email has a link to choose your password. Then sign in with your email and that password.</li>
          <li>Forgot your password? Tap Forgot password on the sign-in page and we'll email you a link to choose a new one.</li>
          <li>Changed your password and signed out elsewhere? That's on purpose: a new password signs out every other device.</li>
        </ul>

        <h2>Notifications and calls on your phone</h2>
        <ul>
          <li>Turn notifications on in Settings › App inside SynergiFund, and allow them when your phone asks.</li>
          <li>On iPhone, calls ring like a phone call. If they don't, check that notifications are allowed for SynergiFund in the iPhone's Settings.</li>
        </ul>

        <h2>Reporting a message or a person</h2>
        <p>
          In chat, tap a message (or point at it on a computer) and choose Report to send it to the administrators, with
          the option to block its author. Blocked people's messages are hidden from you and they can't message you
          directly.
        </p>

        <h2>Deleting your account</h2>
        <p>
          Ask your workspace administrator to remove your account, or email <a href={`mailto:${email}`}>{email}</a>. Once
          it is removed you can no longer sign in and your sign-in details are deleted; what you added for the business
          stays with the workspace. <Link href="/privacy">Our privacy policy</Link> explains what we keep and for how long.
        </p>
      </article>
    </main>
  )
}
