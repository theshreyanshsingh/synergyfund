import jwt from "jsonwebtoken"
import { permissionsFor } from "@synergifund/shared"
import { User } from "../models/index.js"
import { sendError } from "../lib/http.js"
import { publicUser } from "../lib/serialize.js"
import { restoreRunning } from "../services/backup.js"

// Takes the user (or just an id, for a user who never reset their password).
export function signSession(user) {
  const id = user && typeof user === "object" && "passwordHash" in user ? user._id : user
  return jwt.sign({ sub: String(id), sv: Number(user?.sessionVersion) || 0 }, process.env.JWT_SECRET, { expiresIn: "7d" })
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

// A download link for the phone app: it saves files outside the page, so it has no sign-in cookie. The link works for
// one address, for the person who asked for it, for GET only and for five minutes.
const DOWNLOAD_LINK_MINUTES = 5

export function canonicalTarget(target) {
  const [path, query = ""] = String(target || "").split("?")
  const params = new URLSearchParams(query)
  params.delete("dl")
  const sorted = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const search = new URLSearchParams(sorted).toString()
  return search ? `${path}?${search}` : path
}

export function signDownloadLink(userId, target) {
  return jwt.sign({ sub: String(userId), purpose: "download", target: canonicalTarget(target) }, process.env.JWT_SECRET, { expiresIn: `${DOWNLOAD_LINK_MINUTES}m` })
}

async function downloadLinkUser(req) {
  const token = req.method === "GET" && typeof req.query?.dl === "string" ? req.query.dl : ""
  if (!token) return null
  try {
    const payload = jwt.verify(token, process.env.JWT_SECRET)
    if (payload.purpose !== "download" || payload.target !== canonicalTarget(req.originalUrl)) return null
    return await User.findById(payload.sub)
  } catch {
    return null
  }
}

export async function requireAuth(req, res, next) {
  const linked = await downloadLinkUser(req)
  if (linked) {
    req.user = linked
    req.permissions = permissionsFor(publicUser(linked))
    next()
    return
  }
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
    // A session from before a password reset or change no longer works.
    if (!user || (payload.sv || 0) !== (user.sessionVersion || 0)) {
      // Mid-restore the people are being put back: not signed out yet, just not ready.
      if (restoreRunning()) {
        sendError(res, 503, "SynergiFund is restoring a backup. Try again in a minute.")
        return
      }
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
