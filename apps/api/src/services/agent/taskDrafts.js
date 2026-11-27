import { AgentTaskDraft } from "../../models/index.js"

// Creating a task through the Agent. Like its other cards, the Agent saves nothing itself: the person sees the task
// (what, where, who, when) on a card in the chat, and only their Confirm creates it, with their own permissions, through
// the same code as the Tasks page (createTask in routes/tasks.js).

export const TASK_TOOL = "propose_task"

const LIFETIME_MS = 7 * 24 * 60 * 60 * 1000

export function presentTaskDraft(draft) {
  const expired = draft.status === "pending" && draft.expiresAt && draft.expiresAt.getTime() < Date.now()
  return {
    id: String(draft._id),
    title: draft.title,
    propertyId: draft.propertyId ? String(draft.propertyId) : "",
    address: draft.address || "",
    assigneeId: draft.assigneeId ? String(draft.assigneeId) : "",
    assigneeName: draft.assigneeName || "",
    due: draft.due || "",
    priority: draft.priority || "Medium",
    notes: draft.notes || "",
    taskId: draft.taskId ? String(draft.taskId) : "",
    status: expired ? "expired" : draft.status,
  }
}

// One card per task in a run, however many times the model asks for the same one.
export async function createTaskDraft({ context, fields }) {
  context.cache.taskDrafts ||= new Map()
  const key = JSON.stringify([fields.title, String(fields.propertyId || ""), String(fields.assigneeId || ""), fields.due || ""])
  if (context.cache.taskDrafts.has(key)) return context.cache.taskDrafts.get(key)
  const draft = await AgentTaskDraft.create({
    userId: context.user._id,
    threadId: context.threadId,
    ...fields,
    expiresAt: new Date(Date.now() + LIFETIME_MS),
  })
  const shown = presentTaskDraft(draft)
  context.cache.taskDrafts.set(key, shown)
  return shown
}

// Saved chats keep the card as it was made, so a reopened chat shows where each task stands now.
export async function freshTaskDrafts(messages) {
  const calls = messages.flatMap((message) => message.toolCalls || []).filter((call) => call.tool === TASK_TOOL && call.result?.task?.id)
  if (!calls.length) return
  const found = await AgentTaskDraft.find({ _id: { $in: calls.map((call) => call.result.task.id) } })
  const current = new Map(found.map((draft) => [String(draft._id), presentTaskDraft(draft)]))
  for (const call of calls) call.result = { ...call.result, task: current.get(call.result.task.id) || { ...call.result.task, status: "expired" } }
}
