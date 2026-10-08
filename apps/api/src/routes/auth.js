import { Router } from "express"
import bcrypt from "bcryptjs"
import { z } from "zod"
import { User } from "../models/index.js"
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
    setSessionCookie(res, signSession(user._id))
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
    if (!user || !(await bcrypt.compare(parsed.data.password, user.passwordHash))) {
      sendError(res, 401, "That email or password is not right.")
      return
    }
    setSessionCookie(res, signSession(user._id))
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
    await req.user.save()
    await recordActivity({ user: req.user, title: "Password changed", detail: "Changed their own password" })
    res.json({ user: publicUser(req.user) })
  }),
)
