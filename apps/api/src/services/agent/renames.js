import { AgentRename } from "../../models/index.js"
import { recordActivity } from "../notify.js"

// Renaming a document through the Agent. Like a change to a property's figures, the Agent saves nothing itself: the
// person sees the old and new name on a card in the chat, and only their Confirm renames the file, with their own
// permissions and under their own name.

export const RENAME_TOOL = "rename_document"

const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

// A new name for a file that keeps its type: "Purchase Contract - 88 Demo Rd" for a .pdf is "… 88 Demo Rd.pdf".
// Characters a file name can't hold on a computer (/ \ : * ? " < > |) become spaces. "" when nothing is left.
export function renamedFile(name, current) {
  const clean = String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 200)
  if (!clean) return ""
  const extension = (String(current || "").match(/\.[a-z0-9]{1,8}$/i) || [""])[0]
  return extension && !clean.toLowerCase().endsWith(extension.toLowerCase()) ? `${clean}${extension}` : clean
}

export function presentRename(rename) {
  const expired = rename.status === "pending" && rename.expiresAt && rename.expiresAt.getTime() < Date.now()
  return {
    id: String(rename._id),
    documentId: String(rename.documentId),
    from: rename.from,
    to: rename.to,
    place: rename.place || "",
    status: expired ? "expired" : rename.status,
  }
}

// One card per file and new name, however many times the model asks for it in a run.
export async function createRename({ context, file, name, place }) {
  context.cache.renames ||= new Map()
  const key = `${file._id}:${name}`
  if (context.cache.renames.has(key)) return context.cache.renames.get(key)
  const rename = await AgentRename.create({
    userId: context.user._id,
    threadId: context.threadId,
    documentId: file._id,
    from: file.name,
    to: name,
    place,
    expiresAt: new Date(Date.now() + LIFETIME_MS),
  })
  const shown = presentRename(rename)
  context.cache.renames.set(key, shown)
  return shown
}

// Saved chats keep the card as it was made, so a reopened chat shows where each rename stands now.
export async function freshRenames(messages) {
  const calls = messages.flatMap((message) => message.toolCalls || []).filter((call) => call.tool === RENAME_TOOL && call.result?.rename?.id)
  if (!calls.length) return
  const found = await AgentRename.find({ _id: { $in: calls.map((call) => call.result.rename.id) } })
  const current = new Map(found.map((rename) => [String(rename._id), presentRename(rename)]))
  for (const call of calls) call.result = { ...call.result, rename: current.get(call.result.rename.id) || { ...call.result.rename, status: "expired" } }
}

// Renames the file, as renaming it in Documents does (its Modified date moves; it keeps its folder and labels).
export async function applyRename(rename, file, user) {
  const before = file.name
  file.name = rename.to
  await file.save()
  await recordActivity({ user, title: "File renamed", detail: `${before} → ${file.name} · Through the Agent`, propertyId: file.propertyId })
}
