const MENTION = /<@([a-f0-9]{24})>/g

export function nameOf(people, id) {
  return people.get(id)?.name || "Someone"
}

export function toEditable(text, people) {
  const mentions = new Map()
  const editable = String(text || "")
    .replace(MENTION, (token, id) => {
      if (!people.get(id)) return token
      const name = nameOf(people, id)
      mentions.set(name, id)
      return `@${name}`
    })
    .replace(/<!channel>/g, "@channel")
  return { text: editable, mentions }
}

export function fromEditable(text, mentions, allowChannel = true) {
  let out = String(text || "")
  const names = [...mentions.keys()].sort((a, b) => b.length - a.length)
  for (const name of names) {
    const pattern = new RegExp(`@${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\w])`, "g")
    out = out.replace(pattern, `<@${mentions.get(name)}>`)
  }
  return allowChannel ? out.replace(/(^|\s)@channel(?![\w])/g, "$1<!channel>") : out
}

export function toMarkdown(text, people) {
  return String(text || "")
    .replace(MENTION, (_, id) => `[@${nameOf(people, id).replace(/[[\]]/g, "")}](mention:${id})`)
    .replace(/<!channel>/g, "[@channel](mention:channel)")
}

export function plain(text, people) {
  return String(text || "")
    .replace(MENTION, (_, id) => `@${nameOf(people, id)}`)
    .replace(/<!channel>/g, "@channel")
}

export function fileSize(bytes) {
  const value = Number(bytes) || 0
  if (value < 1024) return `${value} B`
  if (value < 1024 * 1024) return `${Math.round(value / 1024)} KB`
  return `${(value / 1024 / 1024).toFixed(1)} MB`
}

export function clock(value) {
  return new Date(value).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
}

export function dayLabel(value) {
  const date = new Date(value)
  const today = new Date()
  const start = (day) => new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const diff = Math.round((start(today) - start(date)) / 86400000)
  if (diff === 0) return "Today"
  if (diff === 1) return "Yesterday"
  return date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", ...(date.getFullYear() !== today.getFullYear() ? { year: "numeric" } : {}) })
}

export function sameDay(a, b) {
  const left = new Date(a)
  const right = new Date(b)
  return left.getFullYear() === right.getFullYear() && left.getMonth() === right.getMonth() && left.getDate() === right.getDate()
}

export function channelTitle(channel, people, me) {
  if (!channel) return ""
  if (channel.kind === "direct") {
    const others = channel.memberIds.filter((id) => id !== me)
    if (!others.length) return `${nameOf(people, me)} (you)`
    return others.map((id) => nameOf(people, id)).join(", ")
  }
  return channel.name
}

export const QUICK_EMOJI = ["👍", "❤️", "😂", "🎉", "👀", "✅", "🙏", "🔥"]
export const EMOJI = ["😀", "😃", "😄", "😁", "😅", "😂", "🙂", "😉", "😊", "😍", "🤔", "😎", "😮", "😢", "😡", "🙌", "👏", "🙏", "👍", "👎", "👌", "✌️", "💪", "👀", "🎉", "🔥", "💯", "✅", "❌", "⚠️", "❤️", "💡", "📌", "📎", "🏠", "🔨", "🧱", "💵", "📅", "🚀"]
