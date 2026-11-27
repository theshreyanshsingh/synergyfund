import { createHash, randomBytes } from "node:crypto"
import { PasswordLink, User } from "../models/index.js"
import { appOrigin } from "./appUrl.js"
import { sendMail } from "./notify.js"

// Links to set a password, so a password is never sent by email: "Forgot password" on the sign-in page (good for an
// hour), one an admin sends from Members (3 days) and a new member's invitation (a week). Only a hash of the secret is
// stored, a link works once, and making a new link for someone ends their older ones.
export const LINK_HOURS = { reset: 1, admin: 3 * 24, invite: 7 * 24 }

const hash = (token) => createHash("sha256").update(String(token)).digest("hex")

export async function createPasswordLink(user, purpose) {
  const token = randomBytes(32).toString("base64url")
  const now = new Date()
  await PasswordLink.updateMany({ userId: user._id, usedAt: null }, { $set: { usedAt: now } })
  await PasswordLink.create({ userId: user._id, tokenHash: hash(token), purpose, expiresAt: new Date(now.getTime() + LINK_HOURS[purpose] * 60 * 60 * 1000) })
  return { token, path: `/set-password?token=${token}`, url: `${appOrigin()}/set-password?token=${token}` }
}

// The link and its person, while it can still be used.
export async function openPasswordLink(token) {
  if (!token || String(token).length > 200) return null
  const link = await PasswordLink.findOne({ tokenHash: hash(token), usedAt: null, expiresAt: { $gt: new Date() } })
  if (!link) return null
  const user = await User.findById(link.userId)
  if (!user || user.bot) return null
  return { link, user }
}

// Marks the link used, once: two tabs sending the same link at once can't both set a password.
export async function usePasswordLink(link) {
  const claimed = await PasswordLink.findOneAndUpdate({ _id: link._id, usedAt: null }, { $set: { usedAt: new Date() } })
  return Boolean(claimed)
}

function wording(user, purpose, by, passwordSet) {
  if (purpose === "invite") {
    return {
      title: "You're invited to SynergiFund",
      body: passwordSet
        ? `${by} created your SynergiFund account. Sign in with ${user.email} and the password ${by} gives you, or choose your own with the button below. The link works for 7 days.`
        : `${by} created your SynergiFund account. Choose your password with the button below, then sign in with ${user.email}. The link works for 7 days.`,
      button: "Choose your password",
      event: "member.invited",
    }
  }
  if (purpose === "admin") {
    return {
      title: passwordSet ? "Your SynergiFund password was changed" : "Choose a new SynergiFund password",
      body: passwordSet
        ? `${by} set a new password for your account. Ask them for it, or choose your own with the button below. The link works for 3 days.`
        : `${by} sent you a link to choose a new password for ${user.email}. The link works for 3 days, and your current password works until you use it.`,
      button: "Choose a new password",
      event: "member.password",
    }
  }
  return {
    title: "Set a new SynergiFund password",
    body: `Someone asked to reset the password for ${user.email}. Choose a new one with the button below; the link works for 1 hour. If it wasn't you, ignore this email and your password stays the same.`,
    button: "Choose a new password",
    event: "password.reset",
  }
}

// The email with the link. The link goes in the button (the email log keeps only the subject and text, so the secret
// isn't stored in the clear anywhere). `by`: the admin who invited them or sent it; `passwordSet`: the admin also chose
// a password, which they share themselves (it is never in the email).
export async function mailPasswordLink(user, purpose, { by = "An administrator", passwordSet = false, details = [] } = {}) {
  const made = await createPasswordLink(user, purpose)
  const words = wording(user, purpose, by, passwordSet)
  const mail = await sendMail({ people: [user], title: words.title, body: words.body, details, href: made.path, button: words.button, event: words.event })
  return { mail, link: made.url }
}
