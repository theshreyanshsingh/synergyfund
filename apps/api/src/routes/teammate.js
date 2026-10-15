import { Router } from "express"
import mongoose from "mongoose"
import { TEAMMATE_DEFAULTS } from "@synergifund/shared"
import { AgentSetting, Property, SiteWatch } from "../models/index.js"
import { asyncHandler, sendError } from "../lib/http.js"
import { modelKey } from "../services/agent/llm.js"
import { recordActivity } from "../services/notify.js"
import { ensureTeammate, followUpSweep, forgetTeammateSettings, reviewProperty, teammateSettings, workingHours } from "../services/siteAgent.js"
import { setAlwaysOnline } from "../services/chatHub.js"

// The AI teammate's settings (admins) and "run it now" buttons for one house.
export const teammateRouter = Router()

function admin(req, res) {
  if (req.user.role === "admin") return true
  sendError(res, 403, "Only an admin can manage the AI teammate.")
  return false
}

async function present() {
  const settings = await teammateSettings({ fresh: true })
  const watching = await SiteWatch.countDocuments({ lastReviewedAt: { $ne: null } })
  return {
    on: settings.on,
    name: settings.name,
    userId: settings.userId,
    followUpDays: settings.followUpDays,
    drawEmail: settings.drawEmail,
    modelConnected: Boolean(modelKey()),
    model: settings.decisionModel,
    workingHoursNow: workingHours(),
    housesReviewed: watching,
    defaults: TEAMMATE_DEFAULTS,
  }
}

teammateRouter.get(
  "/",
  asyncHandler(async (req, res) => {
    if (!admin(req, res)) return
    res.json({ teammate: await present() })
  }),
)

teammateRouter.patch(
  "/",
  asyncHandler(async (req, res) => {
    if (!admin(req, res)) return
    const body = req.body || {}
    const update = {}
    if ("on" in body) update.teammateOn = body.on === true
    if ("name" in body) {
      const name = String(body.name || "").trim().replace(/\s+/g, " ")
      if (name.length < 2 || name.length > 60) return sendError(res, 400, "Give the teammate a name of 2 to 60 characters.")
      update.teammateName = name
    }
    if ("followUpDays" in body) {
      const days = Number(body.followUpDays)
      if (!Number.isInteger(days) || days < 1 || days > 30) return sendError(res, 400, "Check-ins can wait 1 to 30 days.")
      update.followUpDays = days
    }
    if ("drawEmail" in body) {
      const email = String(body.drawEmail || "").trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return sendError(res, 400, "Enter the email address draw requests go to.")
      update.drawEmail = email
    }
    if (update.teammateOn && !modelKey()) return sendError(res, 400, "The AI teammate needs an AI model. Add OPENROUTER_API_KEY to the server settings first.")
    await AgentSetting.updateOne({ key: "org" }, { $set: { ...update, updatedBy: req.user.name } }, { upsert: true })
    forgetTeammateSettings()
    const settings = await teammateSettings({ fresh: true })
    if (settings.on) await ensureTeammate(settings)
    else setAlwaysOnline([])
    await recordActivity({ user: req.user, title: "AI teammate settings changed", detail: [settings.on ? `On as ${settings.name}` : "Off", `check-ins after ${settings.followUpDays} days`, `draws to ${settings.drawEmail}`].join(" · ") })
    res.json({ teammate: await present() })
  }),
)

async function houseFor(req, res) {
  if (!mongoose.isValidObjectId(req.params.propertyId)) {
    sendError(res, 404, "That property was not found.")
    return null
  }
  const property = await Property.findById(req.params.propertyId).select("_id address")
  if (!property) sendError(res, 404, "That property was not found.")
  return property
}

// Read this house's chat and photos now, instead of waiting for the next message.
teammateRouter.post(
  "/review/:propertyId",
  asyncHandler(async (req, res) => {
    if (!admin(req, res)) return
    const property = await houseFor(req, res)
    if (!property) return
    const settings = await teammateSettings({ fresh: true })
    if (!settings.on) return sendError(res, 400, "Turn the AI teammate on first.")
    try {
      res.json({ result: await reviewProperty(String(property._id), { force: true }) })
    } catch (error) {
      sendError(res, 502, error.message || "The AI model did not answer. Try again.")
    }
  }),
)

// Check in with this house's contractors now.
teammateRouter.post(
  "/check-in/:propertyId",
  asyncHandler(async (req, res) => {
    if (!admin(req, res)) return
    const property = await houseFor(req, res)
    if (!property) return
    const settings = await teammateSettings({ fresh: true })
    if (!settings.on) return sendError(res, 400, "Turn the AI teammate on first.")
    try {
      const sent = await followUpSweep({ force: true, propertyId: String(property._id) })
      if (!sent.length) return sendError(res, 400, "There is no contractor assigned to this house to check in with.")
      res.json({ sent })
    } catch (error) {
      sendError(res, 502, error.message || "The AI model did not answer. Try again.")
    }
  }),
)
