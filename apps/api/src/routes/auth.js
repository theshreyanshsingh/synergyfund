import { Router } from "express"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { CHIMES, RINGTONES, cleanSounds } from "@synergifund/shared"
import { NativeDevice, User } from "../models/index.js"
import jwt from "jsonwebtoken"
import { recordActivity } from "../services/notify.js"
import { asyncHandler, sendError } from "../lib/http.js"
import { publicUser } from "../lib/serialize.js"
import { requireAuth, setSessionCookie, signSession } from "../middleware/auth.js"

const credentials = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const authRouter = Router()

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
    const user = await User.findOne({ email: parsed.data.email.toLowerCase() })
    // The AI teammate's account never signs in.
    if (!user || user.bot || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      sendError(res, 401, "That email or password is not right.")
      return
    }
    setSessionCookie(res, signSession(user))
    await recordActivity({ user, title: "Signed in", detail: user.email })
    res.json({ user: publicUser(user) })
  }),
)

authRouter.post(
  "/logout",
  asyncHandler(async (req, res) => {
    const token = req.cookies?.sf_session
    if (token) {
      try {
        const payload = jwt.verify(token, process.env.JWT_SECRET)
        const user = await User.findById(payload.sub)
        if (user) await recordActivity({ user, title: "Signed out", detail: user.email })
      } catch {}
    }
    res.clearCookie("sf_session", { path: "/" })
    res.json({ ok: true })
  }),
)

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: publicUser(req.user) })
  }),
)

// The sounds this person hears in the app: the call ringtone and the message chime.
authRouter.patch(
  "/me/sounds",
  requireAuth,
  asyncHandler(async (req, res) => {
    const next = { ...cleanSounds(req.user.sounds) }
    for (const [key, list] of [["ringtone", RINGTONES], ["chime", CHIMES]]) {
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
    await recordActivity({ user: req.user, title: "Password changed", detail: "Changed their own password" })
    res.json({ user: publicUser(req.user) })
  }),
)
