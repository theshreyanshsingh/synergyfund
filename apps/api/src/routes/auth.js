import { Router } from "express"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { AGENT_SOUNDS, CHIMES, RINGTONES, cleanSounds } from "@synergifund/shared"
import { NativeDevice, PushSubscription, User } from "../models/index.js"
import jwt from "jsonwebtoken"
import { recordActivity } from "../services/notify.js"
import { disconnectChat } from "../services/chatHub.js"
import { asyncHandler, sendError } from "../lib/http.js"
import { publicUser } from "../lib/serialize.js"
import { clearSessionCookie, endSession, requireAuth, setSessionCookie, signSession } from "../middleware/auth.js"
import { clientAddress, createLimiter, minutes } from "../services/rateLimit.js"
import { mailPasswordLink, openPasswordLink, usePasswordLink } from "../services/passwordLinks.js"

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const authRouter = Router()

// Wrong passwords: 5 for one email from one address in 15 minutes, 30 from one address, or 50 for one email from
// anywhere in an hour, then sign-in waits. Each try counts before the password is checked, so tries sent at once count
// too. A right password clears that email and address. (Many tries from everywhere at one email could make its owner
// wait an hour; Forgot password still works then.)
const pairTries = createLimiter({ max: 5, windowMs: 15 * 60 * 1000 })
const addressTries = createLimiter({ max: 30, windowMs: 15 * 60 * 1000 })
const emailTries = createLimiter({ max: 50, windowMs: 60 * 60 * 1000 })

export function signInWait(email, address) {
  return Math.max(pairTries.blocked(`${email}|${address}`), addressTries.blocked(address), emailTries.blocked(email))
}

function countTry(email, address) {
  pairTries.hit(`${email}|${address}`)
  addressTries.hit(address)
  emailTries.hit(email)
}

// A password just set from a link: earlier wrong guesses at that email no longer make its owner wait.
function forgetTries(email) {
  emailTries.clear(email)
  pairTries.clearWhere((key) => key.startsWith(`${email}|`))
}

function sessionPayload(req) {
  const header = req.headers.authorization || ""
  const token = header.startsWith("Bearer ") ? header.slice(7) : req.cookies?.sf_session
  if (!token) return null
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    return payload.purpose ? null : payload
  } catch {
    return null
  }
}

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const parsed = credentials.extend({ name: z.string().min(2) }).safeParse(req.body)
    if (!parsed.success) {
      sendError(res, 400, "Enter your name, a valid email, and a password of at least 8 characters.")
      return
    }
    if (await User.countDocuments()) {
      sendError(res, 403, "Accounts are created by an admin.")
      return
    }
    const email = parsed.data.email.toLowerCase()
    if (await User.findOne({ email })) {
      sendError(res, 409, "An account with that email already exists.")
      return
    }
    const role = "admin"
    const user = await User.create({
      name: parsed.data.name,
      email,
      passwordHash: await bcrypt.hash(parsed.data.password, 10),
      role,
      title: role === "admin" ? "Signed in · Private workspace" : "Member",
    })
    await recordActivity({ user, title: "Workspace created", detail: `${user.name} became the first admin` })
    setSessionCookie(res, signSession(user))
    res.status(201).json({ user: publicUser(user) })
  }),
)

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const parsed = credentials.safeParse(req.body)
    if (!parsed.success) {
      sendError(res, 400, "Enter the email and password for this workspace.")
      return
    }
    const email = parsed.data.email.toLowerCase()
    const address = clientAddress(req)
    const wait = signInWait(email, address)
    if (wait) {
      sendError(res, 429, `Too many sign-in tries. Try again in ${minutes(wait)}, or use Forgot password.`)
      return
    }
    countTry(email, address)
    const user = await User.findOne({ email })
    // The AI teammate's account never signs in.
    if (!user || user.bot || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      sendError(res, 401, "That email or password is not right.")
      return
    }
    pairTries.clear(`${email}|${address}`)
    setSessionCookie(res, signSession(user))
    await recordActivity({ user, title: "Signed in", detail: user.email })
    res.json({ user: publicUser(user) })
  }),
)

// "Forgot password": emails a link to choose a new password. The answer is the same whether or not the email has an
// account, so the page can't be used to find out who does. 3 emails an hour for one address and 20 from one network
// address keep it from being used to flood someone's inbox.
const forgotEmails = createLimiter({ max: 3, windowMs: 60 * 60 * 1000 })
const forgotAddresses = createLimiter({ max: 20, windowMs: 60 * 60 * 1000 })
const FORGOT_SENT = "If that email has a SynergiFund account, we've sent it a link to choose a new password. It works for 1 hour."

authRouter.post(
  "/forgot",
  asyncHandler(async (req, res) => {
    const email = String(req.body?.email || "").trim().toLowerCase()
    if (!z.string().email().safeParse(email).success) return sendError(res, 400, "Enter the email you sign in with.")
    const address = clientAddress(req)
    const wait = Math.max(forgotEmails.blocked(email), forgotAddresses.blocked(address))
    if (wait) return sendError(res, 429, `Too many requests. Try again in ${minutes(wait)}.`)
    forgotEmails.hit(email)
    forgotAddresses.hit(address)
    const user = await User.findOne({ email })
    if (user && !user.bot) {
      const { mail } = await mailPasswordLink(user, "reset")
      if (mail.status !== "Sent") console.error(`Password reset email for a member: ${mail.status} ${mail.error || ""}`)
      await recordActivity({ user, title: "Password reset requested", detail: user.email })
    }
    res.json({ ok: true, message: FORGOT_SENT })
  }),
)

// What the set-password page shows before the person chooses one: whose account, and why.
authRouter.get(
  "/password-link",
  asyncHandler(async (req, res) => {
    const found = await openPasswordLink(String(req.query.token || ""))
    if (!found) return sendError(res, 404, "This link has expired or was already used. Ask for a new one from the sign-in page.")
    res.json({ email: found.user.email, name: found.user.name, purpose: found.link.purpose })
  }),
)

// Sets the password from a link and signs in. Every other session ends (as when an admin resets a password).
authRouter.post(
  "/password-link",
  asyncHandler(async (req, res) => {
    const password = String(req.body?.password || "")
    if (password.length < 8) return sendError(res, 400, "Use a password of at least 8 characters.")
    const found = await openPasswordLink(String(req.body?.token || ""))
    if (!found || !(await usePasswordLink(found.link))) return sendError(res, 404, "This link has expired or was already used. Ask for a new one from the sign-in page.")
    const { user, link } = found
    user.passwordHash = await bcrypt.hash(password, 10)
    user.sessionVersion = (user.sessionVersion || 0) + 1
    await user.save()
    await NativeDevice.deleteMany({ userId: user._id })
    disconnectChat([user._id])
    forgetTries(user.email)
    setSessionCookie(res, signSession(user))
    await recordActivity({ user, title: link.purpose === "invite" ? "Password chosen" : "Password reset", detail: user.email })
    res.json({ user: publicUser(user) })
  }),
)

// Signing out ends this session on the server too, so the token stops working even if it was copied.
authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const payload = sessionPayload(req)
    if (payload) {
      await endSession(payload)
      const user = await User.findById(payload.sub)
      if (user) await recordActivity({ user, title: "Signed out", detail: user.email })
    }
    clearSessionCookie(res)
    res.json({ ok: true })
  }),
)

// Signs out every other phone and browser (a lost phone, a shared computer). This device stays signed in with a new
// session. The others stop getting notifications too; `keepEndpoint` (this browser's push address) and `keepToken`
// (this phone's) keep this device's.
authRouter.post(
  "/sign-out-everywhere",
  requireAuth,
  asyncHandler(async (req, res) => {
    req.user.sessionVersion = (req.user.sessionVersion || 0) + 1
    await req.user.save()
    const keepEndpoint = String(req.body?.keepEndpoint || "")
    const keepToken = String(req.body?.keepToken || "")
    await PushSubscription.deleteMany({ userId: req.user._id, ...(keepEndpoint ? { endpoint: { $ne: keepEndpoint } } : {}) })
    await NativeDevice.deleteMany({ userId: req.user._id, ...(keepToken ? { token: { $ne: keepToken } } : {}) })
    setSessionCookie(res, signSession(req.user))
    // Chat connections end everywhere; this page connects again with its new session, the others can't.
    disconnectChat([req.user._id])
    await recordActivity({ user: req.user, title: "Signed out everywhere", detail: "Signed out their other devices" })
    res.json({ user: publicUser(req.user) })
  }),
)

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) })
  }),
)

// The sounds this person hears in the app: the call ringtone, the message chime and the Agent's sounds (on or off).
authRouter.patch(
  "/me/sounds",
  requireAuth,
  asyncHandler(async (req, res) => {
    const next = { ...cleanSounds(req.user.sounds) }
    for (const [key, list] of [["ringtone", RINGTONES], ["chime", CHIMES], ["agent", AGENT_SOUNDS]]) {
      if (!(key in (req.body || {}))) continue
      if (!list.some((item) => item.id === req.body[key])) {
        sendError(res, 400, "Choose one of the sounds in the list.")
        return
      }
      next[key] = req.body[key]
    }
    req.user.sounds = next
    await req.user.save()
    res.json({ user: publicUser(req.user) })
  }),
)

// The AI notice: this person agrees that the Agent, Talk and receipt reading send what they need (their question, files
// they attach, the records looked up, a receipt's photo) to outside AI models through OpenRouter. Asked once, the first
// time one of them is used.
authRouter.post(
  "/me/ai-consent",
  requireAuth,
  asyncHandler(async (req, res) => {
    if (req.body?.agree !== true) return sendError(res, 400, "Send agree: true to agree to the AI notice.")
    if (!req.user.aiConsentAt) {
      req.user.aiConsentAt = new Date()
      await req.user.save()
    }
    res.json({ user: publicUser(req.user) })
  }),
)

authRouter.post(
  "/password",
  requireAuth,
  asyncHandler(async (req, res) => {
    const currentPassword = String(req.body.currentPassword || "")
    const nextPassword = String(req.body.nextPassword || "")
    if (nextPassword.length < 8) {
      sendError(res, 400, "Use a new password of at least 8 characters.")
      return
    }
    if (!(await bcrypt.compare(currentPassword, req.user.passwordHash))) {
      sendError(res, 401, "The current password is not right.")
      return
    }
    req.user.passwordHash = await bcrypt.hash(nextPassword, 10)
    // Other devices signed in with the old password are signed out; this one gets a new session.
    req.user.sessionVersion = (req.user.sessionVersion || 0) + 1
    await req.user.save()
    // Phones register again when the app is next opened with the new password.
    await NativeDevice.deleteMany({ userId: req.user._id })
    setSessionCookie(res, signSession(req.user))
    // Chat connections end everywhere; this page connects again with its new session, the others can't.
    disconnectChat([req.user._id])
    await recordActivity({ user: req.user, title: "Password changed", detail: "Changed their own password" })
    res.json({ user: publicUser(req.user) })
  }),
)
