import mammoth from "mammoth"
import xlsx from "xlsx"
import { AGENT_DEFAULTS } from "@synergifund/shared"
import { AgentThread, DocumentFile } from "../../models/index.js"
import { deleteStoredFile, readStoredFile, saveUploadedFile } from "../files.js"
import { chat } from "./llm.js"

// Files attached to a question for the Agent: photos, PDFs, Word, Excel, CSV and text. They are kept with the chat
// (kind "agent", visible only to the person who sent them). Before the agent plans, everything in them is turned into
// notes: Word, Excel, CSV and text are read directly; photos and PDFs are read by the decision model (the default one
// when the chosen model cannot see pictures). Every later step works from the notes, so any model can use them.

export const MAX_ATTACHMENTS = 5
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"])
const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const MAX_PDF_BYTES = 15 * 1024 * 1024
const FILE_TEXT_LIMIT = 20000
export const NOTES_LIMIT = 30000
// Attachments that were uploaded but never became part of a chat (or whose chat is gone) are removed after this.
const ORPHAN_AFTER_MS = 24 * 60 * 60 * 1000

const READ_PROMPT = `Someone attached files to a question for the SynergiFund agent. SynergiFund is a real estate investment company: it buys, renovates, rents, refinances and sells houses, and tracks properties, loans, lenders, draws, expenses and payments. The agent cannot see the files; it only gets your notes, so they must hold everything it could need.

For each file write a section that starts with "### " and the file's name. In it:
- Say what the file is (for example a closing statement, a contractor invoice, a loan statement, a photo of a kitchen).
- Copy out every name, company, address, date, dollar amount, loan or account number, percentage and other figure that matters. Keep a table as simple rows, one per line.
- For a photo of a house, a room, damage or work in progress, describe what is visible and its condition plainly.
- For a long document, give its parties, key terms and every figure; leave out boilerplate.
If a file cannot be read, say so in its section. Do not answer the question; it is only there so you know what matters. Write plain text.`

function lower(value) {
  return String(value || "").toLowerCase()
}

export function attachmentKind(file) {
  const mime = lower(file.mimetype || file.mime).split(";")[0].trim()
  const name = lower(file.originalname || file.name)
  if (IMAGE_TYPES.has(mime) || /\.(jpe?g|png|webp|gif)$/.test(name)) return "image"
  if (/^image\/hei[cf]$/.test(mime) || /\.(heic|heif)$/.test(name)) return "heic"
  if (mime === "application/pdf" || name.endsWith(".pdf")) return "pdf"
  if (name.endsWith(".docx")) return "word"
  if (/\.(xlsx|xlsm|xls|csv)$/.test(name)) return "sheet"
  if (/\.(txt|md|json)$/.test(name) || mime === "text/plain") return "text"
  return ""
}

// Why a file is turned away, or "" when it can be attached.
export function attachmentProblem(file) {
  const kind = attachmentKind(file)
  if (kind === "heic") return `${file.originalname} is a HEIC photo, which the agent cannot read. Take it again with the camera here, or send it as a JPEG.`
  if (lower(file.originalname).endsWith(".doc")) return `${file.originalname} is an old Word file. Save it as .docx or PDF and attach it again.`
  if (!kind) return `${file.originalname} is not a file the agent can read. Attach photos, PDFs, Word (.docx), Excel, CSV or text files.`
  return ""
}

export async function saveAttachments(files, user) {
  const saved = []
  try {
    for (const file of files) saved.push(await saveUploadedFile(file, user, { kind: "agent" }))
  } catch (error) {
    await removeFiles(saved)
    throw error
  }
  return saved
}

async function removeFiles(files) {
  for (const file of files) await deleteStoredFile(file).catch(() => {})
  if (files.length) await DocumentFile.deleteMany({ _id: { $in: files.map((file) => file._id) } })
}

function clip(text, limit = FILE_TEXT_LIMIT) {
  const clean = String(text || "").replace(/\r\n/g, "\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim()
  return clean.length > limit ? `${clean.slice(0, limit)}\n… (the rest of this file was cut for length)` : clean
}

async function fileText(file, kind) {
  const buffer = Buffer.from(await readStoredFile(file))
  if (kind === "word") return clip((await mammoth.extractRawText({ buffer })).value)
  if (kind === "sheet") {
    const book = xlsx.read(buffer, { type: "buffer", cellDates: true })
    const sheets = book.SheetNames.map((name) => {
      const rows = xlsx.utils.sheet_to_csv(book.Sheets[name], { blankrows: false }).split("\n").filter((line) => line.replace(/,/g, "").trim())
      return rows.length ? `Sheet "${name}":\n${rows.join("\n")}` : ""
    }).filter(Boolean)
    return clip(sheets.join("\n\n") || "(no data in this workbook)")
  }
  return clip(buffer.toString("utf8"))
}

// Notes on every attached file, for the agent. `question` helps the reader know what matters.
export async function readAttachments({ files, question, settings, tracker }) {
  const sections = []
  const pictures = []
  for (const file of files) {
    const kind = attachmentKind(file)
    try {
      if (kind === "image" || kind === "pdf") {
        if ((file.size || 0) > (kind === "pdf" ? MAX_PDF_BYTES : MAX_IMAGE_BYTES)) {
          sections.push(`### ${file.name}\nThis file is too large for the agent to read.`)
          continue
        }
        const data = Buffer.from(await readStoredFile(file)).toString("base64")
        const mime = kind === "pdf" ? "application/pdf" : lower(file.mime) || "image/jpeg"
        pictures.push({ file, part: kind === "pdf"
          ? { type: "file", file: { filename: String(file.name || "file.pdf").replace(/[^\w.\- ]+/g, "") || "file.pdf", file_data: `data:${mime};base64,${data}` } }
          : { type: "image_url", image_url: { url: `data:${mime};base64,${data}` } } })
      } else if (kind) {
        sections.push(`### ${file.name}\n${await fileText(file, kind)}`)
      } else {
        sections.push(`### ${file.name}\nThis file type cannot be read.`)
      }
    } catch (error) {
      sections.push(`### ${file.name}\nThis file could not be read (${error.message}).`)
    }
  }
  if (pictures.length) {
    const content = [
      { type: "text", text: `The question: ${question || "(no message, only the files)"}\n\nThe ${pictures.length === 1 ? "file" : `${pictures.length} files`}, in order: ${pictures.map((item) => item.file.name).join(", ")}` },
      ...pictures.map((item) => item.part),
    ]
    const models = [...new Set([settings.decisionModel, AGENT_DEFAULTS.decisionModel].filter(Boolean))]
    let read = ""
    let lastError = null
    for (const model of models) {
      try {
        read = (await chat({ model, tracker, temperature: 0, maxTokens: 6000, timeoutMs: 120000, messages: [{ role: "system", content: READ_PROMPT }, { role: "user", content }] })).content.trim()
        if (read) break
      } catch (error) {
        lastError = error
        console.error(`Agent: reading attachments with ${model} failed`, error.message)
      }
    }
    sections.unshift(read || pictures.map((item) => `### ${item.file.name}\nThis file could not be read${lastError ? ` (${lastError.message})` : ""}.`).join("\n\n"))
  }
  return clip(sections.join("\n\n"), NOTES_LIMIT)
}

// The files on these chat messages, for removing them with the chat.
export function threadFileIds(threads) {
  return threads.flatMap((thread) => (thread.messages || []).flatMap((message) => (message.attachments || []).map((item) => item.fileId))).filter(Boolean)
}

export async function removeAttachments(ids) {
  if (!ids.length) return
  await removeFiles(await DocumentFile.find({ _id: { $in: ids }, kind: "agent" }))
}

// Attachments of this person that no chat holds any more (a temporary chat that expired, or an upload whose
// question never went through), once they are a day old.
export async function sweepAttachments(userId) {
  const files = await DocumentFile.find({ kind: "agent", uploadedBy: userId, createdAt: { $lt: new Date(Date.now() - ORPHAN_AFTER_MS) } }).select("_id storage storagePath")
  if (!files.length) return
  const threads = await AgentThread.find({ userId, "messages.attachments.fileId": { $in: files.map((file) => file._id) } }).select("messages.attachments")
  const held = new Set(threadFileIds(threads).map(String))
  await removeFiles(files.filter((file) => !held.has(String(file._id))))
}
