import { AgentMemory, AgentThread } from "../../models/index.js"
import { chat, createMeter } from "./llm.js"

// What the Agent remembers about each person (Memory on the Agent page): short notes it learns from what they write in
// their chats, or that they add themselves. Only that person's chats use them, and only they see or change them. It
// learns from the person's own words only, never from documents, web pages or records it read (they could carry
// instructions), and never keeps figures from the records (they change) or secrets.

export const MAX_MEMORIES = 100
export const MAX_MEMORY_CHARS = 300
const PROMPT_CHARS = 4000
const MAX_NEW = 5
const EARLIER_QUESTIONS = 3
const QUESTION_CHARS = 1500
// Never kept, whatever the model says: passwords, logins, keys and tokens, PINs, account, routing, card and Social
// Security numbers. (A phone number is fine: it is how to reach someone.)
const SECRET_WORDS = /\b(?:pass(?:word|code|phrase)s?|log ?ins?|log-ins?|user ?names?|credentials?|api[ _-]?keys?|secret[ _-]?keys?|access[ _-]?keys?|tokens?|pins?(?: code| number|#|:| is)|ssns?|social security|routing (?:number|no)|account (?:number|no|#)|acct(?: no| #|\.)?)\b/i
const SECRET_SHAPES = /\b\d{3}-\d{2}-\d{4}\b|\d{12,}|\b(?:\d[ -]?){13,19}\b|\b(?:sk|pk|rk)[-_][A-Za-z0-9_-]{8,}|\bAKIA[0-9A-Z]{16}\b|\bgh[pousr]_[A-Za-z0-9]{20,}/i

export function memoryText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, MAX_MEMORY_CHARS)
}

export function secretIn(text) {
  const value = String(text || "")
  return SECRET_WORDS.test(value) || SECRET_SHAPES.test(value)
}

export function presentMemory(memory) {
  return {
    id: String(memory._id),
    text: memory.text,
    source: memory.source === "added" ? "added" : "auto",
    chatId: memory.threadId ? String(memory.threadId) : "",
    createdAt: memory.createdAt,
    updatedAt: memory.updatedAt,
  }
}

export function memoriesFor(userId) {
  return AgentMemory.find({ userId }).sort({ createdAt: 1 }).lean()
}

// The Agent may use memory in this chat: not a temporary one, and not when the person turned memory off.
export function memoryOn(user, thread) {
  return !user.agentMemoryOff && !thread?.temporary
}

// The notes for the Agent's prompts ("" when there are none): the ones the person wrote first, then the newest it
// learned (by when each was last changed), while they fit.
export function memoryPrompt(user, memories) {
  if (!memories.length) return ""
  const recent = (left, right) => new Date(right.updatedAt || right.createdAt || 0) - new Date(left.updatedAt || left.createdAt || 0)
  const ordered = [...memories.filter((memory) => memory.source === "added").sort(recent), ...memories.filter((memory) => memory.source !== "added").sort(recent)]
  const lines = []
  let size = 0
  for (const memory of ordered) {
    const line = `- ${memory.text}`
    if (size + line.length > PROMPT_CHARS) continue
    lines.push(line)
    size += line.length + 1
  }
  return `What you remember about ${user.name} from earlier chats. Treat it as what they told you, and use it when it helps (how they like answers, who people are and how to reach them, what they call things). What they say in this chat comes first: if they ask you to forget something here, don't use it. It never replaces looking up the records:\n${lines.join("\n")}`
}

// How the Agent answers "remember that…" or "forget…" in this chat.
export function memoryRule(user, thread) {
  if (thread?.temporary) return "- If the person asks you to remember or forget something, say that nothing from a temporary chat is remembered, and do not call a tool."
  if (user.agentMemoryOff) return "- If the person asks you to remember or forget something, say that memory is turned off for them and that they can turn it on under Memory on the Agent page, and do not call a tool."
  return "- If the person asks you to remember something, or to forget something you remember, and asks nothing else, reply in one short sentence that you will (it is saved as you answer; they can see and change it under Memory on the Agent page), and do not call a tool. If they also ask a question, answer it as usual."
}

// A memory's words go from the "Memory updated" notes of the person's chats once it is deleted or changed.
export async function forgetNotes(userId, texts, words = ["Saved", "Updated", "Forgot"]) {
  const notes = texts.flatMap((text) => words.map((word) => `${word}: ${text}`))
  if (!notes.length) return
  await AgentThread.updateMany({ userId, "messages.memoryNotes": { $in: notes } }, { $pull: { "messages.$[].memoryNotes": { $in: notes } } }, { timestamps: false })
}

// Room for `wanted` more notes under MAX_MEMORIES: the oldest the Agent learned make way (never ones the person wrote).
// Returns how many fit.
export async function makeRoom(userId, wanted) {
  const count = await AgentMemory.countDocuments({ userId })
  const over = count + wanted - MAX_MEMORIES
  if (over > 0) {
    const oldest = await AgentMemory.find({ userId, source: { $ne: "added" } }).sort({ updatedAt: 1, createdAt: 1 }).limit(over).select("_id").lean()
    if (oldest.length) await AgentMemory.deleteMany({ _id: { $in: oldest.map((memory) => memory._id) }, userId })
  }
  return Math.max(0, MAX_MEMORIES - (await AgentMemory.countDocuments({ userId })))
}

const LEARN_PROMPT = `You keep the SynergiFund Agent's memory of one person on a real estate investment team: short notes that help it answer them better in later chats. You see the notes kept now, each with its id, and the person's own messages, the newest last. Learn only from the newest message; the earlier ones are there to understand it.

Reply with only a JSON object: {"add": ["..."], "update": [{"id": "...", "text": "..."}], "remove": ["..."]}

Keep only what will still be true and useful in later chats:
- who they are and what they look after (their role, their company, the houses, lenders or contractors they handle);
- how they want answers (short or detailed, tables, what to always include or leave out);
- people they name and how to reach them, and the names they use for houses, companies or lenders ("the Bayshore flip" is 2418 Bayshore Blvd);
- standing instructions ("always…", "never…", "from now on…");
- anything they ask you to remember.

Never keep:
- questions or tasks for this chat only;
- figures, balances, dates or statuses from the company's records (they change; the Agent looks them up);
- anything they pasted or quoted from a document, email, web page or file;
- passwords, logins, keys or tokens, PINs, account, routing, card or Social Security numbers, or any other secret;
- guesses about them.

When they ask you to forget something, or say a note is wrong, remove that note, or update it when they gave the new fact. When a new fact replaces a note, update the note instead of adding one. Never add a note that says what a kept note already says.
Write each note as one short plain sentence in the third person, under 200 characters, for example "Prefers answers as a short table." or "Jane Smith (jane@kiavi.com) is their loan officer at Kiavi."
Most messages have nothing to keep: then reply {"add": [], "update": [], "remove": []}.`

function jsonOf(content) {
  const text = String(content || "")
  const start = text.indexOf("{")
  const end = text.lastIndexOf("}")
  if (start === -1 || end <= start) return null
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    return null
  }
}

// Learns from the person's newest message: notes added, changed or removed. Returns what changed, as "Saved: …",
// "Updated: …" and "Forgot: …", for the answer's "Memory updated". Nothing changes when the model's reply can't be
// read or the call fails (the answer goes on without it).
export async function learnFromMessage({ user, thread, prompt, settings, memories }) {
  const asked = thread.messages.filter((message) => message.role === "user" && message.content).map((message) => message.content)
  const latest = String(prompt || "").trim()
  if (!latest) return []
  const earlier = asked.slice(0, -1).slice(-EARLIER_QUESTIONS)
  const kept = new Map(memories.map((memory) => [String(memory._id), memory]))
  const content = `Notes kept now:\n${memories.length ? memories.map((memory) => `- [${memory._id}] ${memory.text}`).join("\n") : "(none)"}\n\nTheir messages, oldest first:\n${[...earlier, latest].map((text, index) => `${index + 1}. ${String(text).slice(0, QUESTION_CHARS)}`).join("\n")}`
  let reply = null
  try {
    // One quick try: the answer doesn't wait long for it.
    const response = await chat({ model: settings.taskModel, temperature: 0, maxTokens: 700, timeoutMs: 20000, attempts: 1, meter: createMeter("memory", user._id), messages: [{ role: "system", content: LEARN_PROMPT }, { role: "user", content }] })
    reply = jsonOf(response.content)
  } catch (error) {
    if (!error.budgetReached) console.error("Agent memory: learning failed", error.message)
    return []
  }
  if (!reply) return []
  const notes = []
  const known = new Set(memories.map((memory) => memory.text.toLowerCase()))
  const removed = [...new Set((Array.isArray(reply.remove) ? reply.remove : []).map(String))].filter((id) => kept.has(id))
  if (removed.length) {
    await AgentMemory.deleteMany({ _id: { $in: removed }, userId: user._id })
    for (const id of removed) notes.push(`Forgot: ${kept.get(id).text}`)
    await forgetNotes(user._id, removed.map((id) => kept.get(id).text))
  }
  for (const item of Array.isArray(reply.update) ? reply.update : []) {
    const id = String(item?.id || "")
    const text = memoryText(item?.text)
    if (!kept.has(id) || removed.includes(id) || !text || secretIn(text) || text === kept.get(id).text) continue
    await AgentMemory.updateOne({ _id: id, userId: user._id }, { $set: { text, threadId: thread._id } })
    notes.push(`Updated: ${text}`)
  }
  const added = []
  for (const value of Array.isArray(reply.add) ? reply.add : []) {
    const text = memoryText(value)
    if (!text || secretIn(text) || known.has(text.toLowerCase()) || added.length >= MAX_NEW) continue
    known.add(text.toLowerCase())
    added.push(text)
  }
  const fits = added.length ? await makeRoom(user._id, added.length) : 0
  const saved = added.slice(0, fits)
  if (saved.length) {
    await AgentMemory.insertMany(saved.map((text) => ({ userId: user._id, text, source: "auto", threadId: thread._id })))
    for (const text of saved) notes.push(`Saved: ${text}`)
  }
  return notes
}
