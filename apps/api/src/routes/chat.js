import { Router } from "express"
import mongoose from "mongoose"
import { ChatChannel, ChatMessage, ChatRead, DocumentFile, User } from "../models/index.js"
import { asyncHandler, sendError } from "../lib/http.js"
import {
  MAX_MESSAGE,
  audience,
  canManage,
  directKey,
  escapeRegex,
  hasMemberList,
  isGuest,
  isMember,
  loadChannel,
  mentionsIn,
  presentChannel,
  presentMessage,
  unreadFor,
  usesChat,
  visibleChannels,
} from "../services/chat.js"
import { emitToUsers, isOnline, onlineIds, screenEndpoints, socketToken } from "../services/chatHub.js"
import { pushToUsers } from "../services/push.js"
import { recheckCalls } from "../services/calls.js"
import { receiveFile, saveUploadedFile, sendStoredFile } from "../services/files.js"
import { notify, recordActivity } from "../services/notify.js"
import { bus } from "../services/events.js"

export const chatRouter = Router()

// Posts a message as `author` (used by the AI teammate), exactly as if they had sent it: everyone in the
// conversation sees it live, and people it mentions are notified.
export async function postChatMessage({ channel, property, author, text }) {
  const people = await audience(channel, property)
  const message = await ChatMessage.create({
    channelId: channel._id,
    userId: author._id,
    userName: author.name,
    text: String(text || "").trim().slice(0, MAX_MESSAGE),
    mentionIds: mentionsIn(text, people),
  })
  await ChatChannel.updateOne({ _id: channel._id }, { $max: { lastMessageAt: message.createdAt } })
  emitToUsers(ids(people), "message:new", { message: presentMessage(message), channel: presentChannel(channel, property) })
  alertPeople({ channel, property, message, author, people, parent: null }).catch((error) => console.error("Chat notification failed", error))
  return message
}

chatRouter.use((req, res, next) => {
  if (usesChat(req.user)) return next()
  sendError(res, 403, "Chat is turned off for your account. Ask an admin to turn it on.")
})

const PAGE = 50
const QUICK_REACTIONS = 40
const NOTIFY_GAP = 15 * 60 * 1000
const notified = new Map()

function ids(list) {
  return list.map((item) => String(item._id || item))
}

function cleanName(value) {
  return String(value || "").trim().toLowerCase().replace(/^#/, "").replace(/[^a-z0-9_-]+/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 60)
}

function plainText(text, people) {
  const names = new Map(people.map((person) => [String(person._id), person.name]))
  return String(text || "")
    .replace(/<@([a-f0-9]{24})>/g, (_, id) => `@${names.get(id) || "someone"}`)
    .replace(/<!channel>/g, "@channel")
    .replace(/\s+/g, " ")
    .trim()
}

function channelLabel(channel, property, viewer, people) {
  if (channel.kind === "direct") {
    const others = people.filter((person) => String(person._id) !== String(viewer._id))
    return others.map((person) => person.name).join(", ") || "Direct message"
  }
  if (channel.kind === "property") return property?.address || channel.name
  return `#${channel.name}`
}

function guestContacts(entries) {
  const ids = new Set()
  for (const { channel, property } of entries) {
    for (const id of channel.memberIds || []) ids.add(String(id))
    for (const id of property?.assignedUserIds || []) ids.add(String(id))
  }
  return ids
}

// Direct messages have their own page; channels and property rooms are on Channels.
function chatHref(channel, parentId) {
  return `${channel.kind === "direct" ? "/messages" : "/chat"}?c=${channel._id}${parentId ? `&t=${parentId}` : ""}`
}

async function broadcastChannel(channel, property, event = "channel:update", extra = {}) {
  const people = await audience(channel, property)
  emitToUsers(ids(people), event, { channel: presentChannel(channel, property), ...extra })
  return people
}

async function alertPeople({ channel, property, message, author, people, parent }) {
  const recipients = new Set()
  const direct = channel.kind === "direct"
  const followers = new Set(parent ? [parent.userId, ...(parent.replyUserIds || [])].filter(Boolean).map(String) : [])
  for (const person of people) {
    const id = String(person._id)
    if (id === String(author._id)) continue
    const mentioned = message.mentionIds.some((mention) => String(mention) === id) || message.mentionsChannel
    if (direct || mentioned || followers.has(id)) recipients.add(id)
  }
  if (!recipients.size) return
  const where = channelLabel(channel, property, author, people)
  const preview = plainText(message.text, people) || (message.attachments.length ? `Shared ${message.attachments.length === 1 ? "a file" : `${message.attachments.length} files`}` : "")
  const body = preview.length > 280 ? `${preview.slice(0, 280)}…` : preview
  const href = chatHref(channel, message.parentId)
  const groupDirect = direct && (channel.memberIds || []).length > 2
  // Every message notifies every device of the people it is for, like the Settings notification does,
  // except a device that has this very conversation open on screen right now.
  // One notification per conversation is kept and updated, so a burst of messages does not pile up.
  const away = [...recipients]
  const watching = await screenEndpoints(away, String(channel._id))
  if (away.length) {
    pushToUsers(away, {
      kind: "message",
      tag: `chat-${channel._id}`,
      title: direct ? (groupDirect ? `${author.name} · ${where}` : author.name) : message.parentId && !message.mentionsChannel ? `${author.name} replied in ${where}` : `${author.name} mentioned you in ${where}`,
      body,
      href,
    }, { TTL: 24 * 3600, urgency: "high" }, watching).catch((error) => console.error("Chat push failed", error))
  }
  // The Notifications list and email stay calm: people who are fully offline, at most once per conversation every 15 minutes.
  const offline = [...recipients].filter((id) => {
    if (isOnline(id)) return false
    const key = `${id}:${channel._id}`
    const last = notified.get(key) || 0
    if (Date.now() - last < NOTIFY_GAP) return false
    notified.set(key, Date.now())
    return true
  })
  if (!offline.length) return
  await notify({
    userIds: offline,
    title: direct ? `New message from ${author.name}` : message.parentId && !message.mentionsChannel ? `${author.name} replied in ${where}` : `${author.name} mentioned you in ${where}`,
    body,
    details: [["From", author.name], ["Conversation", direct ? "Direct message" : where]],
    href,
    event: direct ? "chat.direct" : "chat.mention",
    push: false,
  })
}

async function findMessage(user, messageId) {
  if (!mongoose.isValidObjectId(messageId)) return null
  const message = await ChatMessage.findById(messageId)
  if (!message) return null
  const found = await loadChannel(user, message.channelId)
  return found ? { message, ...found } : null
}

async function markRead(user, channel, at = new Date()) {
  const read = await ChatRead.findOneAndUpdate(
    { userId: user._id, channelId: channel._id },
    { $max: { lastReadAt: at } },
    { upsert: true, new: true },
  )
  emitToUsers([String(user._id)], "read", { channelId: String(channel._id), lastReadAt: read.lastReadAt })
  return read
}

chatRouter.get(
  "/socket-token",
  asyncHandler(async (req, res) => {
    res.json({ token: socketToken(req.user), url: process.env.SOCKET_PUBLIC_URL || "" })
  }),
)

chatRouter.get(
  "/bootstrap",
  asyncHandler(async (req, res) => {
    const entries = await visibleChannels(req.user)
    const counts = await unreadFor(req.user, entries)
    const guest = isGuest(req.user)
    const people = await User.find().select("_id name email role extraPermissions deniedPermissions bot")
    const sharedIds = guestContacts(entries)
    const visiblePeople = people.filter((person) => usesChat(person) && (!guest || sharedIds.has(String(person._id)) || String(person._id) === String(req.user._id) || person.role === "admin" || person.bot))
    res.json({
      me: String(req.user._id),
      canCreateChannels: !guest,
      channels: entries.map(({ channel, property }, index) => presentChannel(channel, property, {
        unread: counts[index].unread,
        mentions: counts[index].mentions,
        lastReadAt: counts[index].lastReadAt,
        canManage: canManage(req.user, channel),
      })),
      // The AI teammate is listed (so it can be @mentioned and named) but marked, so it is not offered for calls or DMs.
      people: visiblePeople.map((person) => ({ id: String(person._id), name: person.name, email: person.email, role: person.role, online: isOnline(person._id), ...(person.bot ? { bot: true } : {}) })),
      online: onlineIds(),
    })
  }),
)

chatRouter.get(
  "/unread",
  asyncHandler(async (req, res) => {
    const entries = await visibleChannels(req.user)
    const counts = await unreadFor(req.user, entries)
    const mentions = (kind) => counts.reduce((total, count, index) => total + ((entries[index].channel.kind === "direct") === (kind === "direct") ? count.mentions : 0), 0)
    res.json({
      mentions: counts.reduce((total, count) => total + count.mentions, 0),
      unread: counts.reduce((total, count) => total + count.unread, 0),
      channels: mentions("channels"),
      direct: mentions("direct"),
    })
  }),
)

chatRouter.get(
  "/channels/:id/members",
  asyncHandler(async (req, res) => {
    const found = await loadChannel(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That conversation was not found.")
    const people = await audience(found.channel, found.property)
    res.json({ items: people.map((person) => ({ id: String(person._id), name: person.name, email: person.bot ? "" : person.email, role: person.role, bot: Boolean(person.bot), online: isOnline(person._id) })) })
  }),
)

chatRouter.post(
  "/channels",
  asyncHandler(async (req, res) => {
    if (isGuest(req.user)) return sendError(res, 403, "Ask an admin to create a channel.")
    const name = cleanName(req.body.name)
    if (!name) return sendError(res, 400, "Give the channel a name.")
    if (name === "general") return sendError(res, 400, "#general already exists.")
    const taken = await ChatChannel.findOne({ kind: "channel", name, archivedAt: null })
    if (taken) return sendError(res, 409, `#${name} already exists.`)
    const isPrivate = Boolean(req.body.private)
    // A new channel starts with its creator (the channel admin) and only the people they picked. Others on the
    // team join a public channel from Browse; a private one needs an invite.
    const wanted = Array.isArray(req.body.memberIds) ? req.body.memberIds.filter((id) => mongoose.isValidObjectId(id)) : []
    const picked = (await User.find({ _id: { $in: wanted } }).select("_id role bot extraPermissions deniedPermissions")).filter((person) => usesChat(person) && !person.bot)
    const channel = await ChatChannel.create({
      kind: "channel",
      name,
      topic: String(req.body.topic || "").trim().slice(0, 250),
      private: isPrivate,
      memberList: true,
      memberIds: [req.user._id, ...picked.map((person) => person._id).filter((id) => String(id) !== String(req.user._id))],
      createdBy: req.user._id,
    })
    await recordActivity({ user: req.user, title: "Chat channel created", detail: `${isPrivate ? "Private" : "Public"} channel #${name}` })
    await broadcastChannel(channel, null, "channel:new")
    res.status(201).json({ channel: presentChannel(channel, null, { unread: 0, mentions: 0, canManage: true }) })
  }),
)

chatRouter.patch(
  "/channels/:id",
  asyncHandler(async (req, res) => {
    const found = await loadChannel(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That conversation was not found.")
    const { channel, property } = found
    const changes = []
    if ("topic" in req.body) {
      if (channel.kind === "direct") return sendError(res, 400, "Direct messages have no topic.")
      if (channel.kind !== "property" && !canManage(req.user, channel) && channel.kind !== "general") return sendError(res, 403, "Only the channel owner or an admin can change this.")
      channel.topic = String(req.body.topic || "").trim().slice(0, 250)
      changes.push(`topic set to "${channel.topic || "blank"}"`)
    }
    if ("name" in req.body) {
      if (!canManage(req.user, channel) || channel.kind !== "channel") return sendError(res, 403, "Only the channel owner or an admin can rename it.")
      const name = cleanName(req.body.name)
      if (!name || name === "general") return sendError(res, 400, "Choose another name.")
      const taken = await ChatChannel.findOne({ kind: "channel", name, archivedAt: null, _id: { $ne: channel._id } })
      if (taken) return sendError(res, 409, `#${name} already exists.`)
      changes.push(`renamed from #${channel.name} to #${name}`)
      channel.name = name
    }
    const before = await audience(channel, property)
    if (Array.isArray(req.body.addMemberIds) || Array.isArray(req.body.removeMemberIds)) {
      if (channel.kind !== "channel" || !hasMemberList(channel)) return sendError(res, 400, "Everyone on the team is in this channel.")
      const add = (Array.isArray(req.body.addMemberIds) ? req.body.addMemberIds : []).filter((id) => mongoose.isValidObjectId(id))
      const remove = new Set((Array.isArray(req.body.removeMemberIds) ? req.body.removeMemberIds : []).map(String))
      if (remove.size && !canManage(req.user, channel)) return sendError(res, 403, "Only the channel owner or an admin can remove people.")
      const valid = (await User.find({ _id: { $in: add } }).select("_id name role extraPermissions deniedPermissions")).filter(usesChat)
      const next = new Map((channel.memberIds || []).map((id) => [String(id), id]))
      for (const person of valid) next.set(String(person._id), person._id)
      for (const id of remove) next.delete(id)
      channel.memberIds = [...next.values()]
      if (valid.length) changes.push(`added ${valid.map((person) => person.name).join(", ")}`)
      if (remove.size) changes.push(`removed ${remove.size} ${remove.size === 1 ? "person" : "people"}`)
    }
    await channel.save()
    if (changes.length) await recordActivity({ user: req.user, title: "Chat channel updated", detail: `${channelLabel(channel, property, req.user, [])}: ${changes.join("; ")}` })
    const after = await broadcastChannel(channel, property)
    const kept = new Set(ids(after))
    emitToUsers(ids(before).filter((id) => !kept.has(id)), "channel:remove", { id: String(channel._id) })
    emitToUsers(ids(after).filter((id) => !before.some((person) => String(person._id) === id)), "channel:new", { channel: presentChannel(channel, property) })
    recheckCalls(String(channel._id)).catch((error) => console.error("Call check failed", error))
    res.json({ channel: presentChannel(channel, property, { canManage: canManage(req.user, channel) }) })
  }),
)

// Public channels the person has not joined yet, for Browse.
chatRouter.get(
  "/channels/browse",
  asyncHandler(async (req, res) => {
    if (isGuest(req.user)) return res.json({ items: [] })
    const channels = await ChatChannel.find({ kind: "channel", private: false, memberList: true, archivedAt: null, memberIds: { $ne: req.user._id } }).sort({ name: 1 }).limit(200)
    res.json({ items: channels.map((channel) => presentChannel(channel, null, { memberCount: (channel.memberIds || []).length })) })
  }),
)

chatRouter.post(
  "/channels/:id/join",
  asyncHandler(async (req, res) => {
    if (isGuest(req.user) || !mongoose.isValidObjectId(req.params.id)) return sendError(res, 404, "That channel was not found.")
    const channel = await ChatChannel.findOne({ _id: req.params.id, kind: "channel", private: false, memberList: true, archivedAt: null })
    if (!channel) return sendError(res, 404, "That channel was not found.")
    if (!isMember(channel, req.user)) {
      channel.memberIds = [...(channel.memberIds || []), req.user._id]
      await channel.save()
      await recordActivity({ user: req.user, title: "Joined chat channel", detail: `#${channel.name}` })
      await broadcastChannel(channel, null)
    }
    const presented = presentChannel(channel, null, { unread: 0, mentions: 0, canManage: canManage(req.user, channel) })
    emitToUsers([String(req.user._id)], "channel:new", { channel: presented })
    res.json({ channel: presented })
  }),
)

chatRouter.post(
  "/channels/:id/leave",
  asyncHandler(async (req, res) => {
    const found = await loadChannel(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That conversation was not found.")
    const { channel } = found
    if (channel.kind !== "channel" || !hasMemberList(channel)) return sendError(res, 400, "Everyone on the team is in this channel.")
    channel.memberIds = (channel.memberIds || []).filter((id) => String(id) !== String(req.user._id))
    await channel.save()
    await recordActivity({ user: req.user, title: "Left chat channel", detail: `#${channel.name}` })
    emitToUsers([String(req.user._id)], "channel:remove", { id: String(channel._id) })
    await broadcastChannel(channel, null)
    recheckCalls(String(channel._id)).catch((error) => console.error("Call check failed", error))
    res.json({ ok: true })
  }),
)

chatRouter.delete(
  "/channels/:id",
  asyncHandler(async (req, res) => {
    const found = await loadChannel(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That conversation was not found.")
    const { channel, property } = found
    if (!canManage(req.user, channel) || channel.kind !== "channel") return sendError(res, 403, "Only the channel owner or an admin can archive it.")
    const people = await audience(channel, property)
    channel.archivedAt = new Date()
    await channel.save()
    await recordActivity({ user: req.user, title: "Chat channel archived", detail: `#${channel.name}` })
    emitToUsers(ids(people), "channel:remove", { id: String(channel._id) })
    recheckCalls(String(channel._id)).catch((error) => console.error("Call check failed", error))
    res.json({ ok: true })
  }),
)

chatRouter.post(
  "/direct",
  asyncHandler(async (req, res) => {
    const wanted = (Array.isArray(req.body.userIds) ? req.body.userIds : []).filter((id) => mongoose.isValidObjectId(id))
    const people = await User.find({ _id: { $in: [...wanted, req.user._id] } }).select("_id name role bot extraPermissions deniedPermissions")
    if (people.some((person) => person.bot)) return sendError(res, 400, "The AI teammate answers in property chats, not direct messages.")
    if (people.length < 1 || people.length > 9) return sendError(res, 400, "Pick between one and eight people.")
    const off = people.filter((person) => !usesChat(person))
    if (off.length) return sendError(res, 400, `${off.map((person) => person.name).join(", ")} ${off.length === 1 ? "has" : "have"} chat turned off.`)
    if (isGuest(req.user)) {
      const shared = guestContacts(await visibleChannels(req.user))
      if (people.some((person) => String(person._id) !== String(req.user._id) && !shared.has(String(person._id)) && person.role !== "admin")) {
        return sendError(res, 403, "You can message admins and people you already talk to.")
      }
    }
    const key = directKey(people.map((person) => person._id))
    let channel = await ChatChannel.findOne({ kind: "direct", directKey: key })
    if (!channel) {
      try {
        channel = await ChatChannel.create({ kind: "direct", directKey: key, memberIds: people.map((person) => person._id), createdBy: req.user._id })
      } catch (error) {
        if (error.code !== 11000) throw error
        channel = await ChatChannel.findOne({ kind: "direct", directKey: key })
      }
    }
    res.json({ channel: presentChannel(channel, null, { unread: 0, mentions: 0, canManage: false }) })
  }),
)

chatRouter.get(
  "/channels/:id/messages",
  asyncHandler(async (req, res) => {
    const found = await loadChannel(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That conversation was not found.")
    const filter = { channelId: found.channel._id, parentId: null }
    const before = req.query.before ? new Date(String(req.query.before)) : null
    if (before && !Number.isNaN(before.getTime())) filter.createdAt = { $lt: before }
    const items = await ChatMessage.find(filter).sort({ createdAt: -1 }).limit(PAGE + 1)
    const more = items.length > PAGE
    res.json({ items: items.slice(0, PAGE).reverse().map(presentMessage), more })
  }),
)

chatRouter.get(
  "/messages/:id/thread",
  asyncHandler(async (req, res) => {
    const found = await findMessage(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That message was not found.")
    const parent = found.message.parentId ? await ChatMessage.findById(found.message.parentId) : found.message
    const replies = await ChatMessage.find({ parentId: parent._id }).sort({ createdAt: 1 }).limit(500)
    res.json({ parent: presentMessage(parent), replies: replies.map(presentMessage) })
  }),
)

chatRouter.post(
  "/channels/:id/files",
  receiveFile("file"),
  asyncHandler(async (req, res) => {
    const found = await loadChannel(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That conversation was not found.")
    if (!req.file) return sendError(res, 400, "Choose a file to share.")
    const file = await saveUploadedFile(req.file, req.user, { kind: "chat" })
    res.status(201).json({ file: { id: String(file._id), name: file.name, mime: file.mime || "", size: file.size || 0 } })
  }),
)

chatRouter.post(
  "/channels/:id/messages",
  asyncHandler(async (req, res) => {
    const found = await loadChannel(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That conversation was not found.")
    const { channel, property } = found
    const text = String(req.body.text || "").replace(/\r\n/g, "\n").trim()
    if (text.length > MAX_MESSAGE) return sendError(res, 400, `Keep messages under ${MAX_MESSAGE.toLocaleString("en-US")} characters.`)
    const fileIds = (Array.isArray(req.body.fileIds) ? req.body.fileIds : []).filter((id) => mongoose.isValidObjectId(id)).slice(0, 10)
    const used = fileIds.length ? await ChatMessage.find({ "attachments.fileId": { $in: fileIds } }).select("attachments.fileId") : []
    const taken = new Set(used.flatMap((item) => item.attachments.map((file) => String(file.fileId))))
    const fresh = fileIds.filter((id) => !taken.has(String(id)))
    const files = fresh.length ? await DocumentFile.find({ _id: { $in: fresh }, kind: "chat", uploadedBy: req.user._id }) : []
    if (!text && !files.length) return sendError(res, 400, "Write a message or attach a file.")
    let parent = null
    if (req.body.parentId) {
      parent = mongoose.isValidObjectId(req.body.parentId) ? await ChatMessage.findOne({ _id: req.body.parentId, channelId: channel._id }) : null
      if (!parent || parent.parentId) return sendError(res, 400, "That thread was not found.")
    }
    const people = await audience(channel, property)
    const message = await ChatMessage.create({
      channelId: channel._id,
      userId: req.user._id,
      userName: req.user.name,
      text,
      parentId: parent?._id,
      mentionIds: mentionsIn(text, people),
      mentionsChannel: channel.kind !== "direct" && !parent && /<!channel>/.test(text),
      attachments: files.map((file) => ({ fileId: file._id, name: file.name, mime: file.mime, size: file.size })),
    })
    if (parent) {
      parent = await ChatMessage.findByIdAndUpdate(
        parent._id,
        { $inc: { replyCount: 1 }, $max: { lastReplyAt: message.createdAt }, $addToSet: { replyUserIds: req.user._id } },
        { new: true },
      )
    }
    await ChatChannel.updateOne({ _id: channel._id }, { $max: { lastMessageAt: message.createdAt } })
    channel.lastMessageAt = message.createdAt
    await markRead(req.user, channel, message.createdAt)
    const payload = presentMessage(message)
    emitToUsers(ids(people), "message:new", { message: payload, channel: presentChannel(channel, property) })
    if (parent) emitToUsers(ids(people), "message:update", { message: presentMessage(parent) })
    alertPeople({ channel, property, message, author: req.user, people, parent }).catch((error) => console.error("Chat notification failed", error))
    bus.emit("chat:message", { channel, property, message, author: req.user })
    res.status(201).json({ message: payload })
  }),
)

chatRouter.patch(
  "/messages/:id",
  asyncHandler(async (req, res) => {
    const found = await findMessage(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That message was not found.")
    const { message, channel, property } = found
    if (String(message.userId) !== String(req.user._id) || message.deletedAt) return sendError(res, 403, "You can only edit your own messages.")
    if (message.kind === "call" || message.kind === "notes") return sendError(res, 400, "Call notes cannot be edited.")
    const text = String(req.body.text || "").replace(/\r\n/g, "\n").trim()
    if (!text && !message.attachments?.length) return sendError(res, 400, "A message cannot be empty. Delete it instead.")
    if (text.length > MAX_MESSAGE) return sendError(res, 400, `Keep messages under ${MAX_MESSAGE.toLocaleString("en-US")} characters.`)
    const people = await audience(channel, property)
    const edited = await ChatMessage.findOneAndUpdate(
      { _id: message._id, deletedAt: null },
      { $set: { text, mentionIds: mentionsIn(text, people), mentionsChannel: channel.kind !== "direct" && !message.parentId && /<!channel>/.test(text), editedAt: new Date() } },
      { new: true },
    )
    if (!edited) return sendError(res, 404, "That message was deleted.")
    const payload = presentMessage(edited)
    emitToUsers(ids(people), "message:update", { message: payload })
    res.json({ message: payload })
  }),
)

chatRouter.delete(
  "/messages/:id",
  asyncHandler(async (req, res) => {
    const found = await findMessage(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That message was not found.")
    const { message, channel, property } = found
    if (String(message.userId) !== String(req.user._id) && req.user.role !== "admin") return sendError(res, 403, "You can only delete your own messages.")
    await ChatMessage.updateOne({ _id: message._id }, { $set: { deletedAt: new Date() } })
    message.deletedAt = new Date()
    if (String(message.userId) !== String(req.user._id)) {
      await recordActivity({ user: req.user, title: "Chat message removed", detail: `A message by ${message.userName} in ${channelLabel(channel, property, req.user, [])}` })
    }
    const people = await audience(channel, property)
    emitToUsers(ids(people), "message:update", { message: presentMessage(message) })
    res.json({ ok: true })
  }),
)

chatRouter.post(
  "/messages/:id/reactions",
  asyncHandler(async (req, res) => {
    const found = await findMessage(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That message was not found.")
    const { message, channel, property } = found
    const emoji = String(req.body.emoji || "").trim()
    if (!emoji || emoji.length > 16 || message.deletedAt) return sendError(res, 400, "Pick a reaction.")
    const me = req.user._id
    const existing = (message.reactions || []).find((item) => item.emoji === emoji)
    const reacted = existing?.userIds?.some((id) => String(id) === String(me))
    if (reacted) {
      await ChatMessage.updateOne({ _id: message._id, "reactions.emoji": emoji }, { $pull: { "reactions.$.userIds": me } })
      await ChatMessage.updateOne({ _id: message._id }, { $pull: { reactions: { userIds: { $size: 0 } } } })
    } else {
      const added = await ChatMessage.updateOne({ _id: message._id, "reactions.emoji": emoji }, { $addToSet: { "reactions.$.userIds": me } })
      if (!added.matchedCount) {
        if ((message.reactions || []).length >= QUICK_REACTIONS) return sendError(res, 400, "This message has too many reactions.")
        const pushed = await ChatMessage.updateOne({ _id: message._id, "reactions.emoji": { $ne: emoji } }, { $push: { reactions: { emoji, userIds: [me] } } })
        if (!pushed.matchedCount) await ChatMessage.updateOne({ _id: message._id, "reactions.emoji": emoji }, { $addToSet: { "reactions.$.userIds": me } })
      }
    }
    const payload = presentMessage(await ChatMessage.findById(message._id))
    const people = await audience(channel, property)
    emitToUsers(ids(people), "message:update", { message: payload })
    res.json({ message: payload })
  }),
)

chatRouter.post(
  "/channels/:id/read",
  asyncHandler(async (req, res) => {
    const found = await loadChannel(req.user, req.params.id)
    if (!found) return sendError(res, 404, "That conversation was not found.")
    const at = req.body.at ? new Date(req.body.at) : new Date()
    const read = await markRead(req.user, found.channel, Number.isNaN(at.getTime()) ? new Date() : new Date(Math.min(at.getTime(), Date.now())))
    res.json({ lastReadAt: read.lastReadAt })
  }),
)

chatRouter.get(
  "/search",
  asyncHandler(async (req, res) => {
    const query = String(req.query.q || "").trim()
    if (query.length < 2) return res.json({ items: [] })
    const entries = await visibleChannels(req.user)
    const items = await ChatMessage.find({
      channelId: { $in: entries.map((entry) => entry.channel._id) },
      deletedAt: null,
      text: new RegExp(escapeRegex(query), "i"),
    }).sort({ createdAt: -1 }).limit(40)
    res.json({ items: items.map(presentMessage) })
  }),
)

chatRouter.get(
  "/files/:id",
  asyncHandler(async (req, res) => {
    if (!mongoose.isValidObjectId(req.params.id)) return sendError(res, 404, "That file was not found.")
    const file = await DocumentFile.findOne({ _id: req.params.id, kind: "chat" })
    if (!file) return sendError(res, 404, "That file was not found.")
    const message = await ChatMessage.findOne({ "attachments.fileId": file._id, deletedAt: null })
    const allowed = message ? Boolean(await loadChannel(req.user, message.channelId)) : String(file.uploadedBy) === String(req.user._id)
    if (!allowed) return sendError(res, 404, "That file was not found.")
    await sendStoredFile(res, file, { download: req.query.download === "1" })
  }),
)

