import mongoose from "mongoose"
import { PERMISSIONS, permissionsFor } from "@synergifund/shared"
import { ChatChannel, ChatMessage, ChatRead, DocumentFile, Property, User } from "../models/index.js"
import { publicUser } from "../lib/serialize.js"

export const MAX_MESSAGE = 8000
const MENTION = /<@([a-f0-9]{24})>/g

export function isGuest(user) {
  return user?.role === "contractor"
}

function readsProperties(user) {
  return permissionsFor(publicUser(user)).includes(PERMISSIONS.propertiesRead)
}

export function usesChat(user) {
  return Boolean(user) && permissionsFor(publicUser(user)).includes(PERMISSIONS.chatUse)
}

export function assignedTo(user, property) {
  return (property?.assignedUserIds || []).some((id) => String(id) === String(user._id))
}

function inPropertyRoom(user, property) {
  if (!property || !readsProperties(user)) return false
  return user.role === "admin" || assignedTo(user, property)
}

function isMember(channel, user) {
  const id = String(user._id)
  return (channel.memberIds || []).some((member) => String(member) === id)
}

export function canSee(user, channel, property) {
  if (!channel || channel.archivedAt || !usesChat(user)) return false
  if (channel.kind === "direct") return isMember(channel, user)
  if (channel.kind === "property") return inPropertyRoom(user, property)
  if (channel.private) return isMember(channel, user)
  return !isGuest(user)
}

export function canManage(user, channel) {
  if (channel.kind === "direct" || channel.kind === "property") return false
  if (user.role === "admin") return true
  return channel.kind === "channel" && String(channel.createdBy) === String(user._id)
}

let generalReady = false

function ignoreDuplicates(error) {
  const codes = [error?.code, ...(error?.writeErrors || []).map((item) => item.code ?? item.err?.code)]
  if (!codes.every((code) => code === 11000)) throw error
}

export async function ensureGeneral() {
  if (generalReady) return
  if (!(await ChatChannel.exists({ kind: "general", name: "general" }))) {
    await ChatChannel.create({ kind: "general", name: "general", topic: "Company-wide announcements and work talk" }).catch(ignoreDuplicates)
  }
  generalReady = true
}

export async function ensurePropertyChannels(properties) {
  if (!properties.length) return
  const existing = await ChatChannel.find({ kind: "property", propertyId: { $in: properties.map((property) => property._id) } }).select("propertyId name")
  const byProperty = new Map(existing.map((channel) => [String(channel.propertyId), channel]))
  const missing = properties.filter((property) => !byProperty.has(String(property._id)))
  const renamed = properties.filter((property) => {
    const channel = byProperty.get(String(property._id))
    return channel && property.address && channel.name !== property.address
  })
  if (missing.length) {
    await ChatChannel.insertMany(
      missing.map((property) => ({ kind: "property", propertyId: property._id, name: property.address || "Property" })),
      { ordered: false },
    ).catch(ignoreDuplicates)
  }
  if (renamed.length) {
    await ChatChannel.bulkWrite(renamed.map((property) => ({ updateOne: { filter: { kind: "property", propertyId: property._id }, update: { $set: { name: property.address } } } })), { ordered: false })
  }
}

export async function propertyFor(channel) {
  if (channel?.kind !== "property" || !channel.propertyId) return null
  return Property.findById(channel.propertyId).select("_id address city assignedUserIds")
}

export async function loadChannel(user, channelId) {
  if (!mongoose.isValidObjectId(channelId)) return null
  const channel = await ChatChannel.findById(channelId)
  if (!channel) return null
  const property = await propertyFor(channel)
  return canSee(user, channel, property) ? { channel, property } : null
}

export async function visibleChannels(user) {
  if (!usesChat(user)) return []
  await ensureGeneral()
  const filter = user.role === "admin" ? {} : { assignedUserIds: user._id }
  const properties = readsProperties(user) ? await Property.find(filter).select("_id address city assignedUserIds") : []
  await ensurePropertyChannels(properties)
  const or = [
    { kind: "direct", memberIds: user._id },
    { kind: "channel", private: true, memberIds: user._id },
  ]
  if (!isGuest(user)) or.push({ kind: "general" }, { kind: "channel", private: false })
  if (properties.length) or.push({ kind: "property", propertyId: { $in: properties.map((property) => property._id) } })
  const channels = await ChatChannel.find({ archivedAt: null, $or: or })
  const byId = new Map(properties.map((property) => [String(property._id), property]))
  return channels.map((channel) => ({ channel, property: channel.propertyId ? byId.get(String(channel.propertyId)) : null }))
}

export async function audience(channel, property) {
  if (channel.kind === "direct" || channel.private) {
    const members = await User.find({ _id: { $in: channel.memberIds || [] } }).select("_id name email role extraPermissions deniedPermissions createdAt")
    return members.filter(usesChat)
  }
  const people = await User.find().select("_id name email role extraPermissions deniedPermissions createdAt")
  const resolved = property === undefined ? await propertyFor(channel) : property
  return people.filter((person) => canSee(person, channel, resolved))
}

export function mentionsIn(text, people) {
  const allowed = new Set(people.map((person) => String(person._id)))
  const ids = new Set()
  for (const match of String(text || "").matchAll(MENTION)) if (allowed.has(match[1])) ids.add(match[1])
  return [...ids]
}

export function presentChannel(channel, property, extra = {}) {
  return {
    id: String(channel._id),
    kind: channel.kind,
    name: channel.kind === "property" ? property?.address || channel.name : channel.name,
    topic: channel.topic || "",
    private: Boolean(channel.private),
    propertyId: channel.propertyId ? String(channel.propertyId) : "",
    city: property?.city || "",
    memberIds: channel.kind === "direct" || channel.private ? (channel.memberIds || []).map(String) : [],
    createdBy: channel.createdBy ? String(channel.createdBy) : "",
    lastMessageAt: channel.lastMessageAt || null,
    createdAt: channel.createdAt,
    ...extra,
  }
}

export function presentMessage(message) {
  const deleted = Boolean(message.deletedAt)
  return {
    id: String(message._id),
    channelId: String(message.channelId),
    userId: message.userId ? String(message.userId) : "",
    userName: message.userName || "",
    kind: message.kind || "message",
    text: deleted ? "" : message.text || "",
    parentId: message.parentId ? String(message.parentId) : "",
    replyCount: message.replyCount || 0,
    replyUserIds: (message.replyUserIds || []).map(String),
    lastReplyAt: message.lastReplyAt || null,
    reactions: deleted ? [] : (message.reactions || []).filter((reaction) => reaction.userIds?.length).map((reaction) => ({ emoji: reaction.emoji, userIds: reaction.userIds.map(String) })),
    attachments: deleted ? [] : (message.attachments || []).map((file) => ({ id: String(file.fileId), name: file.name, mime: file.mime || "", size: file.size || 0, url: `/api/chat/files/${file.fileId}` })),
    mentionIds: (message.mentionIds || []).map(String),
    mentionsChannel: Boolean(message.mentionsChannel),
    editedAt: message.editedAt || null,
    deleted,
    createdAt: message.createdAt,
  }
}

function readStart(user, channel) {
  if (channel.kind === "direct" || channel.private) return new Date(0)
  return user.createdAt || new Date(0)
}

export async function unreadFor(user, entries) {
  const reads = await ChatRead.find({ userId: user._id, channelId: { $in: entries.map((entry) => entry.channel._id) } })
  const readMap = new Map(reads.map((read) => [String(read.channelId), read.lastReadAt]))
  const counts = await Promise.all(entries.map(async ({ channel }) => {
    if (!channel.lastMessageAt) return { unread: 0, mentions: 0, lastReadAt: readMap.get(String(channel._id)) || null }
    const since = readMap.get(String(channel._id)) || readStart(user, channel)
    if (channel.lastMessageAt <= since) return { unread: 0, mentions: 0, lastReadAt: since }
    const base = { channelId: channel._id, createdAt: { $gt: since }, userId: { $ne: user._id }, deletedAt: null }
    const [unread, mentions] = await Promise.all([
      ChatMessage.countDocuments({ ...base, parentId: null }),
      channel.kind === "direct"
        ? ChatMessage.countDocuments(base)
        : ChatMessage.countDocuments({ ...base, $or: [{ mentionIds: user._id }, { mentionsChannel: true }] }),
    ])
    return { unread, mentions, lastReadAt: since }
  }))
  return counts
}

export async function unreadTotal(user) {
  const entries = await visibleChannels(user)
  const counts = await unreadFor(user, entries)
  return counts.reduce((total, count) => total + count.mentions, 0)
}

export async function removePropertyRoom(property) {
  const channel = await ChatChannel.findOne({ kind: "property", propertyId: property._id })
  if (!channel) return { channelId: "", userIds: [], files: [] }
  const people = await audience(channel, property)
  const messages = await ChatMessage.find({ channelId: channel._id }).select("attachments")
  const fileIds = messages.flatMap((message) => (message.attachments || []).map((file) => file.fileId))
  const files = fileIds.length ? await DocumentFile.find({ _id: { $in: fileIds }, kind: "chat" }) : []
  await Promise.all([
    ChatMessage.deleteMany({ channelId: channel._id }),
    ChatRead.deleteMany({ channelId: channel._id }),
    DocumentFile.deleteMany({ _id: { $in: files.map((file) => file._id) } }),
  ])
  await channel.deleteOne()
  return { channelId: String(channel._id), userIds: people.map((person) => String(person._id)), files }
}

export function directKey(ids) {
  return [...new Set(ids.map(String))].sort().join(":")
}

export function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}
