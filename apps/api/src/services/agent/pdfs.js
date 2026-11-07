import { saveUploadedFile } from "../files.js"
import { renderPdf } from "./memo.js"

// PDFs the Agent makes when someone asks for one: the answer writes the document in a fenced block with the language
// pdf ("Title: …" on its first line, then markdown), and each block becomes a PDF saved for that person (an Agent file:
// only they can open it, and it goes with the chat) and, in the answer, its download link.

const MAX_PDFS = 3
// What the chat keeps of a PDF's words, so a later "change the PDF" can rewrite it.
const SOURCE_CHARS = 20000

function sizeText(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

// "Q3 investor update.pdf", with characters a file name can't hold taken out.
export function pdfFileName(title) {
  const clean = String(title || "").replace(/\.pdf$/i, "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
  return `${clean || "Document"}.pdf`
}

// The ```pdf blocks of an answer, in order: { start, end (line numbers), title, markdown }.
export function pdfBlocks(text) {
  const lines = String(text || "").split("\n")
  const blocks = []
  for (let index = 0; index < lines.length; index += 1) {
    if (!/^\s*```\s*pdf\s*$/i.test(lines[index])) continue
    let end = index + 1
    while (end < lines.length && !/^\s*```\s*$/.test(lines[end])) end += 1
    const body = lines.slice(index + 1, end)
    while (body.length && !body[0].trim()) body.shift()
    const named = /^\s*title:\s*(.+)$/i.exec(body[0] || "")
    if (named) body.shift()
    const markdown = body.join("\n").trim()
    const heading = /^#{1,3}\s+(.+)$/m.exec(markdown)
    blocks.push({ start: index, end: Math.min(end, lines.length - 1), title: (named?.[1] || heading?.[1] || "Document").replace(/[*_`#]/g, "").trim(), markdown })
    index = end
  }
  return blocks
}

// Each block of the answer as a PDF for `user`: the answer with the blocks as download links, and the files made
// ({ fileId, name, mime, size, source }) for the chat message. A PDF that can't be made leaves its words in the answer.
export async function makePdfs(answer, { user, at = new Date() }) {
  const blocks = pdfBlocks(answer).slice(0, MAX_PDFS)
  if (!blocks.length) return { text: answer, files: [] }
  const lines = String(answer).split("\n")
  const files = []
  // From the last block back, so the line numbers of the ones before stay right.
  for (const block of [...blocks].reverse()) {
    let replacement
    try {
      if (!block.markdown) throw new Error("it was empty")
      const name = pdfFileName(block.title)
      const { buffer, pages } = await renderPdf({ title: block.title, markdown: block.markdown, name: user.name, at })
      const file = await saveUploadedFile({ originalname: name, mimetype: "application/pdf", size: buffer.length, buffer }, user, { kind: "agent" })
      files.unshift({ fileId: file._id, name, mime: "application/pdf", size: buffer.length, source: `Title: ${block.title}\n\n${block.markdown}`.slice(0, SOURCE_CHARS) })
      replacement = [`[Download ${name.replace(/[[\]]/g, "")} (${pages} ${pages === 1 ? "page" : "pages"}, ${sizeText(buffer.length)})](/api/documents/${file._id}/download)`]
    } catch (error) {
      console.error("Agent: making a PDF failed", error.message)
      replacement = [block.markdown, "", `(The PDF could not be made: ${error.message}. Ask again to try once more.)`]
    }
    lines.splice(block.start, block.end - block.start + 1, ...replacement)
  }
  return { text: lines.join("\n").replace(/\n{3,}/g, "\n\n").trim(), files }
}

// An answer as the model sees it again later: with the words of the PDFs it made, so it can change one.
export function withPdfSources(content, files = []) {
  const made = files.filter((file) => file.source)
  if (!made.length) return content
  return `${content}\n\n${made.map((file) => `(The PDF ${file.name} said:)\n\`\`\`pdf\n${file.source}\n\`\`\``).join("\n\n")}`
}
