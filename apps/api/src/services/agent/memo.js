import PDFDocument from "pdfkit"
import { teamTimezone, teamZoneName } from "../../lib/dates.js"
import { appOrigin } from "../appUrl.js"

// An answer as a PDF memo to keep or send on (Download as PDF under an answer): the chat's name, who asked and when,
// the question, the answer with its headings, lists and tables, what the Agent looked at, and on every page a reminder
// that the Agent wrote it from the records.

const PAGE = { size: "LETTER", margin: 54 }
const COLORS = { text: "#111827", muted: "#5b6270", line: "#d9dce1", fill: "#f3f4f6", link: "#1a73e8" }
const BODY = 10.5
const GAP = 2.5

// The PDF's built-in fonts have no arrows, check marks or emoji: arrows become plain marks, a check mark on its own
// (a table's cell) Yes or No, and anything else they can't draw is left out.
const SWAPS = { "→": "->", "←": "<-", "⇒": "=>", "↑": "up", "↓": "down", "≈": "~", "≥": ">=", "≤": "<=", "≠": "!=", "\u00a0": " ", "\u2009": " ", "\u202f": " " }
const MARKS = { "✓": "Yes", "✔": "Yes", "✅": "Yes", "☑": "Yes", "✗": "No", "✘": "No", "❌": "No", "✖": "No" }
const WIN_ANSI = "€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ"

export function pdfText(value) {
  const text = String(value ?? "")
  const alone = text.replace(/\ufe0f/g, "").trim()
  if (alone in MARKS) return MARKS[alone]
  let dropped = false
  const kept = [...text].map((character) => {
    if (character in SWAPS) return SWAPS[character]
    const code = character.codePointAt(0)
    if (character === "\n" || (code >= 0x20 && code < 0x7f) || (code >= 0xa0 && code < 0x100) || WIN_ANSI.includes(character)) return character
    dropped = true
    return ""
  }).join("")
  // Where something was left out, no gap is left behind ("letter ✅." is "letter.").
  return dropped ? kept.replace(/ {2,}/g, " ").replace(/ +([.,;:!?)])/g, "$1") : kept
}

// "Weekly brief · Nov 9 - Agent memo.pdf", with characters a file name can't hold taken out.
export function memoFileName(title) {
  const clean = String(title || "Agent answer").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
  return `${clean || "Agent answer"} - Agent memo.pdf`
}

/* ---------- the answer's markdown, as blocks and runs ---------- */

function cellsOf(row) {
  return row.trim().replace(/^\|/, "").replace(/(?<!\\)\|$/, "").split(/(?<!\\)\|/).map((cell) => cell.replace(/\\\|/g, "|").trim())
}

// The line under a table's header: "|---|---:|", or as short as "|-|:-:|".
const TABLE_RULE = /^\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?$/

// Headings, paragraphs, list items (with their depth), tables, quotes, code and rules.
export function blocksOf(markdown) {
  const lines = String(markdown || "").replace(/\r\n?/g, "\n").split("\n")
  const blocks = []
  let paragraph = []
  const flush = () => {
    if (paragraph.length) blocks.push({ type: "paragraph", text: paragraph.join(" ") })
    paragraph = []
  }
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]
    const trimmed = line.trim()
    if (trimmed.startsWith("```")) {
      flush()
      const code = []
      for (index += 1; index < lines.length && !lines[index].trim().startsWith("```"); index += 1) code.push(lines[index])
      blocks.push({ type: "code", text: code.join("\n") })
      continue
    }
    if (!trimmed) {
      flush()
      continue
    }
    const heading = /^(#{1,6})\s+(.+?)\s*#*$/.exec(trimmed)
    if (heading) {
      flush()
      blocks.push({ type: "heading", level: heading[1].length, text: heading[2] })
      continue
    }
    if (/^([-*_])(\s*\1){2,}$/.test(trimmed)) {
      flush()
      blocks.push({ type: "rule" })
      continue
    }
    if (trimmed.startsWith("|") && TABLE_RULE.test(lines[index + 1]?.trim() || "")) {
      flush()
      const align = cellsOf(lines[index + 1]).map((rule) => (/^:-+:$/.test(rule) ? "center" : /-:$/.test(rule) ? "right" : "left"))
      const rows = [cellsOf(trimmed)]
      for (index += 2; index < lines.length && lines[index].trim().startsWith("|"); index += 1) rows.push(cellsOf(lines[index]))
      index -= 1
      blocks.push({ type: "table", rows, align })
      continue
    }
    const item = /^(\s*)([-*+•]|\d{1,3}[.)])\s+(.*)$/.exec(line)
    if (item) {
      flush()
      const depth = Math.min(3, Math.floor(item[1].replace(/\t/g, "  ").length / 2))
      blocks.push({ type: "item", depth, marker: /\d/.test(item[2]) ? `${parseInt(item[2], 10)}.` : "•", text: item[3] })
      continue
    }
    const quote = /^>\s?(.*)$/.exec(trimmed)
    if (quote) {
      flush()
      blocks.push({ type: "quote", text: quote[1] })
      continue
    }
    // An indented line right under a list item carries on that item.
    if (/^\s{2,}\S/.test(line) && !paragraph.length && blocks.at(-1)?.type === "item") {
      blocks.at(-1).text += ` ${trimmed}`
      continue
    }
    paragraph.push(trimmed)
  }
  flush()
  return blocks
}

// A link in the app (/properties/…, /documents/…) opens the app; a web address opens as it is.
function linkTarget(href) {
  const value = String(href || "").trim()
  if (/^https?:\/\//i.test(value)) return value
  if (value.startsWith("/") && !value.startsWith("//")) return `${appOrigin()}${value}`
  return ""
}

// **bold**, *italic*, `code` and [links](…) as runs of text.
export function runsOf(text) {
  const runs = []
  const pattern = /(\*\*|__)(.+?)\1|(?<![\w*])\*(?![\s*])(.+?)(?<![\s*])\*(?![\w*])|`([^`]+)`|\[([^\]]+)\]\(([^)\s]+)\)/g
  let last = 0
  const plain = (value) => pdfText(String(value).replace(/\[([^\]]+)\]\([^)\s]+\)/g, "$1").replace(/\*\*|__/g, "").replace(/\\([\\`*_[\]()#|>-])/g, "$1"))
  for (const match of String(text || "").matchAll(pattern)) {
    if (match.index > last) runs.push({ text: plain(text.slice(last, match.index)) })
    if (match[2] != null) runs.push({ text: plain(match[2]), bold: true })
    else if (match[3] != null) runs.push({ text: plain(match[3]), italic: true })
    else if (match[4] != null) runs.push({ text: pdfText(match[4]), code: true })
    else runs.push({ text: plain(match[5]), link: linkTarget(match[6]) })
    last = match.index + match[0].length
  }
  if (last < String(text || "").length) runs.push({ text: plain(text.slice(last)) })
  return runs.filter((run) => run.text)
}

function plainOf(text) {
  return runsOf(text).map((run) => run.text).join("")
}

/* ---------- writing the memo ---------- */

function face(run) {
  return run.code ? "Courier" : run.bold ? "Helvetica-Bold" : run.italic ? "Helvetica-Oblique" : "Helvetica"
}

function contentWidth(doc) {
  return doc.page.width - doc.page.margins.left - doc.page.margins.right
}

function bottom(doc) {
  return doc.page.height - doc.page.margins.bottom
}

// Room for `height` more points on this page, or a new page.
function room(doc, height) {
  if (doc.y + height > bottom(doc)) doc.addPage()
}

function writeRuns(doc, runs, { x, width, size = BODY, color = COLORS.text, bold = false }) {
  if (!runs.length) return
  doc.x = x
  runs.forEach((run, index) => {
    doc.font(bold && !run.code ? "Helvetica-Bold" : face(run)).fontSize(run.code ? size - 1 : size).fillColor(run.link ? COLORS.link : color)
    doc.text(run.text, { width, lineGap: GAP, continued: index < runs.length - 1, link: run.link || null, underline: Boolean(run.link) })
  })
  doc.x = doc.page.margins.left
}

function writeTable(doc, rows, align = []) {
  const left = doc.page.margins.left
  const width = contentWidth(doc)
  const columns = Math.max(...rows.map((row) => row.length))
  const texts = rows.map((row) => Array.from({ length: columns }, (_, column) => plainOf(row[column] || "")))
  // The header, and a cell written all in bold (a Total), are bold.
  const bolds = rows.map((row, at) => Array.from({ length: columns }, (_, column) => at === 0 || /^(\*\*|__).+\1$/.test(row[column] || "")))
  const size = columns > 5 ? 8.5 : 9.5
  const pad = 5
  // Each column as wide as its longest line wants, shared out when they don't all fit.
  // Narrow columns all get a fair share when a table is very wide.
  const least = Math.min(36, width / columns)
  const wants = Array.from({ length: columns }, (_, column) => Math.max(least, ...texts.map((row, at) => doc.font(bolds[at][column] ? "Helvetica-Bold" : "Helvetica").fontSize(size).widthOfString(row[column] || "") + pad * 2)))
  const total = wants.reduce((sum, value) => sum + value, 0)
  const shares = wants.map((value) => Math.max(least, (value / total) * width))
  const scale = width / shares.reduce((sum, value) => sum + value, 0)
  const sized = shares.map((value) => value * scale)
  const fontOf = (at, column) => (bolds[at][column] ? "Helvetica-Bold" : "Helvetica")
  const heightOf = (at) => Math.max(...texts[at].map((cell, column) => doc.font(fontOf(at, column)).fontSize(size).heightOfString(cell || " ", { width: sized[column] - pad * 2, lineGap: 1 }))) + pad * 2
  // A row that doesn't fit starts the next page, under the header again.
  const drawRow = (at) => {
    const height = heightOf(at)
    // (Not from a page just started: a row taller than a page goes where it is.)
    if (doc.y + height > bottom(doc) && doc.y > doc.page.margins.top + 1) {
      doc.addPage()
      if (at > 0) drawRow(0)
    }
    const top = doc.y
    if (at === 0) doc.rect(left, top, width, height).fill(COLORS.fill)
    let x = left
    texts[at].forEach((cell, column) => {
      doc.font(fontOf(at, column)).fontSize(size).fillColor(COLORS.text)
      doc.text(cell || "", x + pad, top + pad, { width: sized[column] - pad * 2, lineGap: 1, align: align[column] || "left" })
      x += sized[column]
    })
    doc.moveTo(left, top + height).lineTo(left + width, top + height).lineWidth(0.6).strokeColor(COLORS.line).stroke()
    doc.x = left
    doc.y = top + height
  }
  room(doc, heightOf(0) + (texts[1] ? heightOf(1) : 0))
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.6).strokeColor(COLORS.line).stroke()
  texts.forEach((_, at) => drawRow(at))
  doc.moveDown(0.6)
}

function writeBlocks(doc, blocks) {
  const left = doc.page.margins.left
  const width = contentWidth(doc)
  blocks.forEach((block, index) => {
    const next = blocks[index + 1]
    if (block.type === "heading") {
      const size = block.level === 1 ? 15 : block.level === 2 ? 13 : 11.5
      // A heading isn't left alone at the foot of a page.
      room(doc, size + 40)
      if (index > 0) doc.moveDown(0.5)
      writeRuns(doc, runsOf(block.text), { x: left, width, size, bold: true })
      doc.moveDown(0.25)
    } else if (block.type === "paragraph") {
      writeRuns(doc, runsOf(block.text), { x: left, width })
      doc.moveDown(0.55)
    } else if (block.type === "item") {
      const indent = block.depth * 14
      const markerWidth = block.marker === "•" ? 12 : 18
      room(doc, BODY + GAP + 4)
      const top = doc.y
      doc.font("Helvetica").fontSize(BODY).fillColor(COLORS.text).text(block.marker, left + indent, top, { width: markerWidth, lineGap: GAP })
      doc.y = top
      writeRuns(doc, runsOf(block.text), { x: left + indent + markerWidth, width: width - indent - markerWidth })
      doc.moveDown(next?.type === "item" ? 0.2 : 0.55)
    } else if (block.type === "quote") {
      const top = doc.y
      writeRuns(doc, runsOf(block.text), { x: left + 12, width: width - 12, color: COLORS.muted })
      // (Its bar only when it ended on the page it started on.)
      if (doc.y > top) doc.rect(left, top, 2.5, doc.y - top).fill(COLORS.line)
      doc.moveDown(0.55)
    } else if (block.type === "code") {
      doc.font("Courier").fontSize(9).fillColor(COLORS.text).text(pdfText(block.text), left + 8, doc.y, { width: width - 16, lineGap: 1.5 })
      doc.x = left
      doc.moveDown(0.55)
    } else if (block.type === "rule") {
      room(doc, 12)
      doc.moveDown(0.2)
      doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.6).strokeColor(COLORS.line).stroke()
      doc.moveDown(0.6)
    } else if (block.type === "table") {
      writeTable(doc, block.rows, block.align)
    }
  })
}

function when(date) {
  const value = new Date(date || Date.now())
  const shown = value.toLocaleString("en-US", { timeZone: teamTimezone(), month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
  return `${shown} ${teamZoneName(value)}`
}

function day(date) {
  return new Date(date || Date.now()).toLocaleDateString("en-US", { timeZone: teamTimezone(), month: "short", day: "numeric", year: "numeric" })
}

// Writes the memo to `out` (the response): { title, name (who asked), at (when answered), question, answer,
// looked (what the Agent looked at) }.
export function writeMemo(out, { title, name, at, question, answer, looked = [] }) {
  const doc = new PDFDocument({ size: PAGE.size, margin: PAGE.margin, bufferPages: true, info: { Title: pdfText(title), Author: "SynergiFund Agent", Creator: "SynergiFund" } })
  doc.pipe(out)
  const left = doc.page.margins.left
  const width = contentWidth(doc)

  doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.muted).text("SYNERGIFUND", left, doc.y, { characterSpacing: 1.2, continued: true }).font("Helvetica").text("   Agent memo", { characterSpacing: 0 })
  doc.moveDown(0.8)
  doc.font("Helvetica-Bold").fontSize(18).fillColor(COLORS.text).text(pdfText(title || "Agent answer"), left, doc.y, { width })
  doc.moveDown(0.25)
  doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.muted).text(pdfText(`For ${name || "you"} · ${when(at)}`), { width })
  doc.moveDown(1)
  if (question) {
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.muted).text("QUESTION", { characterSpacing: 0.8 })
    doc.moveDown(0.2)
    doc.font("Helvetica").fontSize(BODY).fillColor(COLORS.text).text(pdfText(question), { width, lineGap: GAP, characterSpacing: 0 })
    doc.moveDown(0.8)
  }
  doc.moveTo(left, doc.y).lineTo(left + width, doc.y).lineWidth(0.8).strokeColor(COLORS.line).stroke()
  doc.moveDown(0.9)

  writeBlocks(doc, blocksOf(answer))

  const seen = [...new Set(looked.map((item) => pdfText(item).trim()).filter(Boolean))]
  if (seen.length) {
    room(doc, 60)
    doc.moveDown(0.6)
    doc.font("Helvetica-Bold").fontSize(8.5).fillColor(COLORS.muted).text("WHAT THE AGENT LOOKED AT", left, doc.y, { characterSpacing: 0.8 })
    doc.moveDown(0.3)
    doc.font("Helvetica").fontSize(9.5).fillColor(COLORS.muted).text(seen.join(" · "), left, doc.y, { width, lineGap: 1.5, characterSpacing: 0 })
  }

  // Every page: who wrote it and that the figures want checking, and the page number.
  const pages = doc.bufferedPageRange()
  for (let index = 0; index < pages.count; index += 1) {
    doc.switchToPage(pages.start + index)
    const keep = doc.page.margins.bottom
    doc.page.margins.bottom = 0
    const y = doc.page.height - 36
    doc.font("Helvetica").fontSize(7.5).fillColor(COLORS.muted)
    doc.text(`Written by the SynergiFund Agent from the records on ${day(at)}. Check the figures before relying on them.`, left, y, { width: width - 60, lineBreak: false })
    doc.text(`${index + 1} of ${pages.count}`, left + width - 60, y, { width: 60, align: "right", lineBreak: false })
    doc.page.margins.bottom = keep
  }
  doc.end()
}
