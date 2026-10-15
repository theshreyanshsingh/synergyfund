import { AGENT_DEFAULTS } from "@synergifund/shared"
import { AgentSetting, CallNote, ChatChannel, ChatMessage, Property } from "../models/index.js"
import { chat, modelKey } from "./agent/llm.js"
import { audience, presentChannel, presentMessage, propertyFor } from "./chat.js"
import { emitToUsers } from "./chatHub.js"
import { notify } from "./notify.js"

// AI notes on calls. While someone has them turned on, each person's app sends short recordings of their own
// microphone (only when they speak). Each one is transcribed straight away and thrown away; only the words are kept.
// When notes are turned off, or the call ends, the transcript is written up as notes and posted in the conversation.

const TRANSCRIBE_DEFAULT = "google/gemini-3.6-flash"
// The longest piece of audio accepted at once; the app sends a piece at each pause, and at least every 25 seconds.
export const MAX_PIECE_MS = 40000
export const MAX_PIECE_BYTES = 4 * 1024 * 1024
// After notes are turned off, the last pieces still on their way are accepted for this long.
const LATE_MS = 20000
// Notes are written once nothing is left to transcribe, but no sooner than this after they were turned off.
const SETTLE_MS = 6000
const SETTLE_MAX_MS = 120000
const HINTS_MS = 10 * 60 * 1000

// Per note, while it is being taken or written: pieces being transcribed now, cached word hints, and whether its
// notes are being written. Removed once the notes are written.
const jobs = new Map()

function job(noteId) {
  const id = String(noteId)
  if (!jobs.has(id)) jobs.set(id, { pending: 0, hints: null, hintsAt: 0, writing: false, closed: false })
  return jobs.get(id)
}

// Marks notes failed when writing them broke unexpectedly, so they never stay "being written" for ever.
async function markFailed(noteId, error) {
  console.error("Call notes: writing failed", error)
  await CallNote.updateOne({ _id: noteId, status: "writing" }, { $set: { status: "failed", error: "Something went wrong writing the notes. Try again." } }).catch(() => {})
}

export function transcribeModel() {
  return String(process.env.NOTES_TRANSCRIBE_MODEL || "").trim() || TRANSCRIBE_DEFAULT
}

export function notesAvailable() {
  return Boolean(modelKey())
}

export async function startNotes({ callId, channelId, media, user, participants }) {
  const note = await CallNote.create({
    callId,
    channelId,
    media,
    startedBy: user._id,
    startedByName: user.name,
    participants: dedupe(participants),
    transcribeModel: transcribeModel(),
  })
  job(note._id)
  return note
}

function dedupe(people) {
  const seen = new Set()
  return people.filter((person) => {
    const id = String(person.userId)
    if (!person.userId || seen.has(id)) return false
    seen.add(id)
    return true
  }).map((person) => ({ userId: person.userId, name: person.name || "" }))
}

// Someone who joins while notes are on is part of these notes too.
export async function addNoteParticipant(noteId, user) {
  await CallNote.updateOne(
    { _id: noteId, "participants.userId": { $ne: user._id } },
    { $push: { participants: { userId: user._id, name: user.name } } },
  ).catch((error) => console.error("Call notes: adding a person failed", error))
}

// Turned off (by someone, or because the call ended): the notes are written once the last pieces are in.
export async function stopNotes(noteId, user = null) {
  const update = { status: "writing", offAt: new Date() }
  if (user) Object.assign(update, { stoppedBy: user._id, stoppedByName: user.name })
  const result = await CallNote.updateOne({ _id: noteId, status: "recording" }, { $set: update })
  if (result.modifiedCount) settleThenWrite(noteId)
}

// One piece of someone's speech. `endedAgoMs` is how long ago it finished on their device, so it is placed in time
// by this server's clock, never theirs. Anyone who was on these notes is heard, including the last words of someone
// who just hung up (their piece arrives a moment after they left).
export async function acceptPiece({ user, noteId, audio, durationMs, endedAgoMs }) {
  const note = await CallNote.findById(noteId).select("status onAt offAt participants callId")
  if (!note) return { status: 404, error: "Those call notes were not found." }
  if (!note.participants.some((person) => String(person.userId) === String(user._id))) return { status: 403, error: "You are not in this call." }
  const now = Date.now()
  const existing = jobs.get(String(note._id))
  const late = note.status === "writing" && note.offAt && now - note.offAt.getTime() <= LATE_MS && existing && !existing.closed
  if (note.status !== "recording" && !late) return { status: 409, error: "AI notes are off." }
  const work = existing || job(note._id)
  const duration = Math.min(MAX_PIECE_MS, Math.max(0, Number(durationMs) || 0))
  const ago = Math.min(LATE_MS, Math.max(0, Number(endedAgoMs) || 0))
  const at = new Date(Math.max(note.onAt.getTime(), now - ago - duration))
  if (note.offAt && at.getTime() > note.offAt.getTime() + 1000) return { status: 409, error: "AI notes were already off." }
  work.pending += 1
  transcribePiece(note, user, audio, at, duration)
    .catch((error) => {
      console.error("Call notes: transcription failed", error.message)
      return CallNote.updateOne({ _id: note._id }, { $inc: { failedChunks: 1 } }).catch(() => {})
    })
    .finally(() => {
      work.pending -= 1
    })
  return { status: 202 }
}

async function wordHints(note) {
  const work = job(note._id)
  if (work.hints !== null && Date.now() - work.hintsAt < HINTS_MS) return work.hints
  const properties = await Property.find().select("address").sort({ updatedAt: -1 }).limit(80).catch(() => [])
  const places = properties.map((property) => property.address).filter(Boolean)
  const people = note.participants.map((person) => person.name).filter(Boolean)
  work.hints = [
    places.length ? `Property addresses that may come up: ${places.join("; ")}.` : "",
    people.length ? `People on the call: ${[...new Set(people)].join(", ")}.` : "",
  ].filter(Boolean).join("\n")
  work.hintsAt = Date.now()
  return work.hints
}

const NO_SPEECH = /^\s*\[?\s*no speech\s*\]?\s*\.?\s*$/i

async function transcribePiece(note, user, audio, at, durationMs) {
  const hints = await wordHints(note)
  const messages = [
    {
      role: "system",
      content: [
        "You transcribe one person speaking on a business call for a real estate team (buying, renovating and renting houses: draws, lenders, contractors, budgets).",
        "Write exactly the words spoken, in the language spoken, with normal punctuation. Write numbers and addresses as digits where natural.",
        "Return only the transcript, nothing else. If there is no clear speech (silence, noise, music, breathing), return exactly: [no speech]",
        hints,
      ].filter(Boolean).join("\n"),
    },
    { role: "user", content: [{ type: "text", text: "Transcribe this audio." }, { type: "input_audio", input_audio: { data: audio.toString("base64"), format: "wav" } }] },
  ]
  const model = transcribeModel()
  let reply
  try {
    reply = await chat({ model, messages, temperature: 0, maxTokens: 1500, extra: { reasoning: { effort: "low" } }, timeoutMs: 60000 })
  } catch (error) {
    // Some models do not take a thinking setting; ask again without it.
    if (!/reasoning/i.test(error.message || "")) throw error
    reply = await chat({ model, messages, temperature: 0, maxTokens: 1500, timeoutMs: 60000 })
  }
  const text = String(reply.content || "").trim().replace(/^["“]|["”]$/g, "").trim()
  if (!text || NO_SPEECH.test(text)) return
  await CallNote.updateOne({ _id: note._id }, { $push: { segments: { userId: user._id, name: user.name, at, durationMs, text: text.slice(0, 8000) } } })
}

function settleThenWrite(noteId) {
  const work = job(noteId)
  if (work.writing) return
  work.writing = true
  const since = Date.now()
  const tick = () => {
    const waited = Date.now() - since
    if ((work.pending > 0 || waited < SETTLE_MS) && waited < SETTLE_MAX_MS) {
      setTimeout(tick, 1000)
      return
    }
    work.closed = true
    writeNotes(noteId)
      .catch((error) => markFailed(noteId, error))
      .finally(() => jobs.delete(String(noteId)))
  }
  setTimeout(tick, 1000)
}

function clock(ms) {
  const total = Math.max(0, Math.round(ms / 1000))
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, "0")
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${seconds}` : `${minutes}:${seconds}`
}

export function transcriptText(note) {
  return [...note.segments]
    .sort((a, b) => a.at - b.at)
    .map((segment) => `[${clock(segment.at - note.onAt)}] ${segment.name}: ${segment.text}`)
    .join("\n")
}

// The model's notes, read leniently: JSON, possibly inside a code block.
function readNotes(content) {
  const text = String(content || "")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start < 0 || end <= start) return null
  try {
    const data = JSON.parse(text.slice(start, end + 1))
    const list = (value) => (Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean).slice(0, 30) : [])
    return {
      title: String(data.title || "").trim().slice(0, 120),
      summary: String(data.summary || "").trim().slice(0, 4000),
      keyPoints: list(data.keyPoints),
      decisions: list(data.decisions),
      actionItems: (Array.isArray(data.actionItems) ? data.actionItems : [])
        .map((item) => (typeof item === "string" ? { task: item } : item || {}))
        .map((item) => ({ task: String(item.task || "").trim().slice(0, 300), owner: String(item.owner || "").trim().slice(0, 80), due: String(item.due || "").trim().slice(0, 80) }))
        .filter((item) => item.task)
        .slice(0, 30),
    }
  } catch {
    return null
  }
}

async function notesModel() {
  const stored = await AgentSetting.findOne({ key: "org" }).catch(() => null)
  return stored?.decisionModel || AGENT_DEFAULTS.decisionModel
}

export async function writeNotes(noteId) {
  const note = await CallNote.findById(noteId)
  if (!note || note.status !== "writing") return
  if (!note.segments.length) {
    note.status = "empty"
    note.error = note.failedChunks ? "The speech could not be transcribed. Check that the AI model is connected, then try again on the next call." : "Nobody was heard while AI notes were on."
    await note.save()
    await notify({ userIds: [note.startedBy], title: "AI notes: nothing to write up", body: note.error, href: `/calls/notes/${note._id}`, event: "call.notes", email: false })
    return
  }
  const model = await notesModel()
  const names = [...new Set(note.participants.map((person) => person.name).filter(Boolean))]
  const when = note.onAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
  const messages = [
    {
      role: "system",
      content: "You write meeting notes for SynergiFund, a real estate team that buys, renovates and rents houses (draws, lenders, contractors, budgets). From the call transcript, return JSON only, no other text: {\"title\": \"at most 8 words\", \"summary\": \"2 to 5 plain sentences\", \"keyPoints\": [\"...\"], \"decisions\": [\"...\"], \"actionItems\": [{\"task\": \"...\", \"owner\": \"name or empty\", \"due\": \"when, as said, or empty\"}]}. Use only what was said; never invent facts, numbers or owners. Keep addresses and amounts exactly as said. Empty lists are fine.",
    },
    { role: "user", content: `${note.media === "video" ? "Video" : "Voice"} call on ${when} with ${names.join(", ") || "the team"}.\n\nTranscript:\n${transcriptText(note)}` },
  ]
  let notes = null
  try {
    for (let attempt = 0; attempt < 2 && !notes; attempt += 1) {
      const reply = await chat({ model, messages, temperature: 0.2, maxTokens: 3000, timeoutMs: 120000 })
      notes = readNotes(reply.content)
    }
  } catch (error) {
    note.status = "failed"
    note.error = error.message || "The notes could not be written."
    note.notesModel = model
    await note.save()
    await notify({ userIds: [note.startedBy], title: "AI notes could not be written", body: `${note.error} Open the notes to try again.`, href: `/calls/notes/${note._id}`, event: "call.notes", email: false })
    return
  }
  if (!notes || (!notes.summary && !notes.keyPoints.length && !notes.actionItems.length)) {
    note.status = "failed"
    note.error = "The AI model's answer could not be read."
    note.notesModel = model
    await note.save()
    await notify({ userIds: [note.startedBy], title: "AI notes could not be written", body: "Open the notes to try again.", href: `/calls/notes/${note._id}`, event: "call.notes", email: false })
    return
  }
  Object.assign(note, notes, { title: notes.title || "Call notes", status: "ready", error: "", notesModel: model })
  await note.save()
  await postNotes(note).catch((error) => console.error("Call notes: posting failed", error))
  await notify({
    userIds: note.participants.map((person) => person.userId),
    title: `AI notes ready: ${note.title}`,
    body: note.summary.split(/(?<=[.!?])\s/)[0].slice(0, 200),
    href: `/calls/notes/${note._id}`,
    event: "call.notes",
    email: false,
  })
}

// Posts the notes in the conversation the call was in, where everyone in it can open them.
async function postNotes(note) {
  if (note.messageId) return
  const channel = await ChatChannel.findById(note.channelId)
  if (!channel || channel.archivedAt) return
  const property = await propertyFor(channel)
  const message = await ChatMessage.create({
    channelId: channel._id,
    userId: note.startedBy,
    userName: note.startedByName,
    kind: "notes",
    noteId: note._id,
    text: `AI notes: ${note.title}\n${note.summary}`,
  })
  await ChatChannel.updateOne({ _id: channel._id }, { $max: { lastMessageAt: message.createdAt } })
  note.messageId = message._id
  await note.save()
  const people = await audience(channel, property).catch(() => [])
  const ids = people.map((person) => String(person._id))
  emitToUsers(ids, "message:new", { message: presentMessage(message), channel: presentChannel(channel, property) })
}

// Try writing failed notes again. The writing happens in the background (it can take a minute); the notes page
// shows "Writing the notes…" and checks back until they are done.
export async function retryNotes(noteId) {
  const result = await CallNote.updateOne({ _id: noteId, status: "failed", "segments.0": { $exists: true } }, { $set: { status: "writing", error: "" } })
  if (!result.modifiedCount) return false
  writeNotes(noteId).catch((error) => markFailed(noteId, error))
  return true
}

// After a restart, calls are gone: notes that were still on or being written are written up now.
export async function recoverNotes() {
  const open = await CallNote.find({ status: { $in: ["recording", "writing"] } }).select("_id status offAt updatedAt")
  for (const note of open) {
    if (note.status === "recording") await CallNote.updateOne({ _id: note._id }, { $set: { status: "writing", offAt: note.updatedAt || new Date() } })
    settleThenWrite(note._id)
  }
}

export function presentNote(note, { full = false } = {}) {
  const base = {
    id: String(note._id),
    callId: String(note.callId),
    channelId: String(note.channelId),
    media: note.media === "video" ? "video" : "audio",
    status: note.status,
    error: note.error || "",
    title: note.title || "",
    startedByName: note.startedByName || "",
    stoppedByName: note.stoppedByName || "",
    onAt: note.onAt,
    offAt: note.offAt || null,
    participants: note.participants.map((person) => ({ id: String(person.userId), name: person.name || "" })),
  }
  if (!full) return base
  return {
    ...base,
    summary: note.summary || "",
    keyPoints: note.keyPoints || [],
    decisions: note.decisions || [],
    actionItems: (note.actionItems || []).map((item) => ({ task: item.task, owner: item.owner || "", due: item.due || "" })),
    transcript: [...note.segments].sort((a, b) => a.at - b.at).map((segment) => ({ userId: String(segment.userId), name: segment.name, at: segment.at, offset: clock(segment.at - note.onAt), text: segment.text })),
  }
}
