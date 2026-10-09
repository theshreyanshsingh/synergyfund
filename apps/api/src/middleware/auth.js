import jwt from "jsonwebtoken"
import { permissionsFor } from "@synergifund/shared"
import { User } from "../models/index.js"
import { sendError } from "../lib/http.js"
import { publicUser } from "../lib/serialize.js"

export function signSession(userId) {
  return jwt.sign({ sub: String(userId) }, process.env.JWT_SECRET, { expiresIn: "7d" })
}

export function setSessionCookie(res, token) {
  res.cookie("sf_session", token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
    path: "/",
    maxAge: 7 * 24 * 60 * 60 * 1000,
  })
}

export async function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || ""
    const token = header.startsWith("Bearer ") ? header.slice(7) : req.cookies?.sf_session
    if (!token) {
      sendError(res, 401, "Sign in to continue.")
      return
    }
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload.purpose) {
      sendError(res, 401, "Sign in to continue.")
      return
    }
    const user = await User.findById(payload.sub)
    if (!user) {
      sendError(res, 401, "Sign in to continue.")
      return
    }
    req.user = user
    req.permissions = permissionsFor(publicUser(user))
    next()
  } catch {
    sendError(res, 401, "Sign in to continue.")
  }
}
