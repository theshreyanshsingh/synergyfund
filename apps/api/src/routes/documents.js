import zlib from "node:zlib"
import { Router } from "express"
import mammoth from "mammoth"
import xlsx from "xlsx"
import { allowedDocument, cleanDocumentLabels, documentType, folderName, folderOf, foldersFor } from "@synergifund/shared"
import { Company, DocumentFile, ImportJob, Loan, Property, Task, User } from "../models/index.js"
import { lenderForName } from "../services/lenders.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { signDownloadLink } from "../middleware/auth.js"
import { propertyFilter } from "../services/access.js"
import { readWorkbook } from "../services/drawImport.js"
import { deleteStoredFile, materializeStoredFile, publicFileUrl, readStoredFile, receiveDocument, receiveFile, saveUploadedFile, sendStoredFile } from "../services/files.js"
import { recordActivity } from "../services/notify.js"

export const documentsRouter = Router()

const HIDDEN_KINDS = ["chat", "comp"]
// Receipts and weekly photos are referenced by expenses and photo sets, and draw workbooks hold draw money,
// so they stay where they were filed.
const PINNED_KINDS = ["receipt", "photo", "import"]

function present(file, names = new Map(), people = new Map(), companies = new Map()) {
  const propertyId = file.propertyId ? String(file.propertyId) : ""
  const companyId = file.companyId ? String(file.companyId) : ""
  return {
    id: String(file._id),
    name: file.name,
    mime: file.mime || "",
    size: file.size || 0,
    propertyId,
    property: propertyId ? names.get(propertyId) || "" : "",
    companyId,
    company: companyId ? companies.get(companyId) || "" : "",
    folder: folderOf(file),
    labels: file.labels || [],
    kind: file.kind,
    version: file.version,
    uploadedBy: file.uploadedBy ? people.get(String(file.uploadedBy)) || "" : "",
    uploadedById: file.uploadedBy ? String(file.uploadedBy) : "",
    createdAt: file.createdAt,
    url: publicFileUrl(file),
  }
}

// Contractors never see companies, so their copies leave the company out.
async function presentMany(files, user = null) {
  const propertyIds = [...new Set(files.map((file) => file.propertyId && String(file.propertyId)).filter(Boolean))]
  const userIds = [...new Set(files.map((file) => file.uploadedBy && String(file.uploadedBy)).filter(Boolean))]
  const companyIds = [...new Set(files.map((file) => file.companyId && String(file.companyId)).filter(Boolean))]
  const [properties, users, companies] = await Promise.all([
    propertyIds.length ? Property.find({ _id: { $in: propertyIds } }).select("address companyId") : [],
    userIds.length ? User.find({ _id: { $in: userIds } }).select("name") : [],
    companyIds.length && user?.role !== "contractor" ? Company.find({ _id: { $in: companyIds } }).select("name") : [],
  ])
  const names = new Map(properties.map((property) => [String(property._id), property.address]))
  // A property's documents are kept inside its company's Documents, so links to them need the company.
  const owners = new Map(properties.map((property) => [String(property._id), property.companyId ? String(property.companyId) : ""]))
  const people = new Map(users.map((user) => [String(user._id), user.name]))
  const companyNames = new Map(companies.map((company) => [String(company._id), company.name]))
  return files.map((file) => {
    const shown = present(file, names, people, companyNames)
    shown.propertyCompanyId = shown.propertyId ? owners.get(shown.propertyId) || "" : ""
    if (user?.role === "contractor") {
      shown.companyId = ""
      shown.company = ""
      shown.propertyCompanyId = ""
    }
    return shown
  })
}

// Contractors only reach files on their own properties, or files they uploaded.
async function visibleFile(req, id) {
  const file = await DocumentFile.findById(id).catch(() => null)
  if (!file || file.kind === "chat") return null
  if (req.user.role !== "contractor") return file
  if (file.uploadedBy && String(file.uploadedBy) === String(req.user._id)) return file
  if (!file.propertyId) return null
  const allowed = await Property.exists({ _id: file.propertyId, ...propertyFilter(req.user) })
  return allowed ? file : null
}

// "" or "none" clears the company; anything else must be an existing company. Staff only.
async function readCompanyChoice(req, value) {
  const id = String(value ?? "").trim()
  if (!id || id === "none") return { companyId: null }
  if (req.user.role === "contractor" || !/^[a-f0-9]{24}$/i.test(id)) return { error: "That company is not available." }
  const company = await Company.findById(id).select("_id name")
  return company ? { companyId: company._id, company } : { error: "That company is not available." }
}

function placeOf(file) {
  return file.propertyId ? "property" : file.companyId ? "company" : ""
}

function typeProblem(name, place) {
  if (allowedDocument(name, place)) return ""
  if (documentType(name) === "video") return "Videos can only be added to a property."
  return place === "property" ? "Upload a PDF, Word, Excel, image or video file." : "Upload a PDF, Word, Excel or image file."
}

// A folder sent by the app must be one of that place's folders. Nothing sent: the file is placed by what it is.
function readFolder(value, place) {
  const wanted = String(value ?? "").trim()
  if (!wanted) return { folder: "" }
  if (!foldersFor(place).some((folder) => folder.id === wanted)) return { error: place ? `Choose one of this ${place}'s folders.` : "Link the file to a property or a company before choosing a folder." }
  return { folder: wanted }
}

// "" or "none" clears the property; anything else must be a property this person can see.
async function readPropertyChoice(req, value) {
  const id = String(value ?? "").trim()
  if (!id || id === "none") return { propertyId: null }
  if (!/^[a-f0-9]{24}$/i.test(id)) return { error: "That property is not available." }
  const property = await Property.findOne({ _id: id, ...propertyFilter(req.user) }).select("_id address")
  return property ? { propertyId: property._id, property } : { error: "That property is not available." }
}

documentsRouter.get(
  "/",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const filter = { kind: { $nin: HIDDEN_KINDS } }
    if (req.user.role === "contractor") {
      const properties = await Property.find(propertyFilter(req.user)).select("_id")
      filter.propertyId = { $in: properties.map((property) => property._id) }
    }
    if (req.query.propertyId) {
      const wanted = String(req.query.propertyId)
      if (wanted === "none") {
        if (req.user.role === "contractor") filter.propertyId = { $in: [] }
        else filter.propertyId = null
      } else if (/^[a-f0-9]{24}$/i.test(wanted) && (req.user.role !== "contractor" || filter.propertyId.$in.some((id) => String(id) === wanted))) {
        filter.propertyId = wanted
      } else {
        sendError(res, 404, "That property is not available.")
        return
      }
    }
    if (req.query.companyId) {
      const wanted = String(req.query.companyId)
      if (req.user.role === "contractor" || !/^[a-f0-9]{24}$/i.test(wanted)) {
        sendError(res, 404, "That company is not available.")
        return
      }
      if (req.query.properties === "1") {
        // The company's own papers and the documents of every property it owns, for the company's Documents tab.
        const owned = await Property.find({ companyId: wanted }).select("_id")
        filter.$or = [{ companyId: wanted }, { propertyId: { $in: owned.map((property) => property._id) } }]
      } else {
        filter.companyId = wanted
      }
    }
    if (req.query.q) filter.name = new RegExp(String(req.query.q).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i")
    const items = await DocumentFile.find(filter).sort({ createdAt: -1 })
    res.json({ items: await presentMany(items, req.user) })
  }),
)

documentsRouter.post(
  "/",
  requirePermission("documents.write"),
  receiveDocument("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      sendError(res, 400, "Choose a file to upload.")
      return
    }
    const choice = await readPropertyChoice(req, req.body.propertyId)
    if (choice.error) {
      sendError(res, 404, choice.error)
      return
    }
    if (req.user.role === "contractor" && !choice.propertyId) {
      sendError(res, 400, "Choose the property this file belongs to.")
      return
    }
    const owner = await readCompanyChoice(req, req.body.companyId)
    if (owner.error) {
      sendError(res, 404, owner.error)
      return
    }
    if (choice.propertyId && owner.companyId) {
      sendError(res, 400, "File it under a property or a company, not both.")
      return
    }
    const place = choice.propertyId ? "property" : owner.companyId ? "company" : ""
    const problem = typeProblem(req.file.originalname, place)
    if (problem) {
      sendError(res, 400, problem)
      return
    }
    const picked = readFolder(req.body.folder, place)
    if (picked.error) {
      sendError(res, 400, picked.error)
      return
    }
    const labels = cleanDocumentLabels(req.body.labels)
    const where = { propertyId: choice.propertyId || undefined, companyId: owner.companyId || undefined }
    const folder = picked.folder || folderOf({ ...where, labels, kind: "file", name: req.file.originalname, mime: req.file.mimetype })
    const file = await saveUploadedFile(req.file, req.user, {
      ...where,
      folder: folder || undefined,
      kind: "file",
      labels,
    })
    await recordActivity({ user: req.user, title: "File uploaded", detail: [file.name, choice.property?.address, owner.company?.name, folderName(place, folder), labels.join(", ")].filter(Boolean).join(" · "), propertyId: file.propertyId })
    const [presented] = await presentMany([file], req.user)
    res.status(201).json({ file: presented })
  }),
)

documentsRouter.patch(
  "/:id",
  requirePermission("documents.write"),
  asyncHandler(async (req, res) => {
    const file = await visibleFile(req, req.params.id)
    if (!file || HIDDEN_KINDS.includes(file.kind)) {
      sendError(res, 404, "That file is not available.")
      return
    }
    if (req.user.role === "contractor" && String(file.uploadedBy || "") !== String(req.user._id)) {
      sendError(res, 403, "Only the person who uploaded this file can change it.")
      return
    }
    const movesProperty = "propertyId" in req.body && String(req.body.propertyId || "") !== (file.propertyId ? String(file.propertyId) : "")
    // Contractors cannot see companies, so they never move a file into or out of one.
    const movesCompany = req.user.role !== "contractor" && "companyId" in req.body && String(req.body.companyId || "") !== (file.companyId ? String(file.companyId) : "")
    if ((movesProperty || movesCompany) && PINNED_KINDS.includes(file.kind)) {
      sendError(res, 400, "This file belongs to an expense, photo set or draw import, so it stays on its property.")
      return
    }
    const before = { labels: [...(file.labels || [])], propertyId: file.propertyId ? String(file.propertyId) : "", companyId: file.companyId ? String(file.companyId) : "", folder: folderOf(file) }
    if ("labels" in req.body) file.labels = cleanDocumentLabels(req.body.labels)
    let property = null
    if (movesProperty) {
      const choice = await readPropertyChoice(req, req.body.propertyId)
      if (choice.error) {
        sendError(res, 404, choice.error)
        return
      }
      if (req.user.role === "contractor" && !choice.propertyId) {
        sendError(res, 400, "Choose the property this file belongs to.")
        return
      }
      file.propertyId = choice.propertyId || undefined
      property = choice.property || null
    }
    let company = null
    if (movesCompany) {
      const owner = await readCompanyChoice(req, req.body.companyId)
      if (owner.error) {
        sendError(res, 404, owner.error)
        return
      }
      file.companyId = owner.companyId || undefined
      company = owner.company || null
    }
    if (file.propertyId && file.companyId) {
      sendError(res, 400, "File it under a property or a company, not both.")
      return
    }
    const place = placeOf(file)
    if ((movesProperty || movesCompany) && file.kind === "file") {
      const problem = typeProblem(file.name, place)
      if (problem) {
        sendError(res, 400, problem === "Videos can only be added to a property." ? "Videos can only be kept on a property." : problem)
        return
      }
    }
    if ("folder" in req.body) {
      const picked = readFolder(req.body.folder, place)
      if (picked.error) {
        sendError(res, 400, picked.error)
        return
      }
      file.folder = picked.folder || undefined
    }
    // Moved to another property or company without a folder: keep the folder if it exists there, otherwise place it again.
    file.folder = folderOf({ propertyId: file.propertyId, companyId: file.companyId, folder: file.folder, labels: file.labels, kind: file.kind, name: file.name, mime: file.mime }) || undefined
    if ("name" in req.body) {
      const name = String(req.body.name || "").trim().slice(0, 200)
      if (!name) {
        sendError(res, 400, "Give the file a name.")
        return
      }
      file.name = name
    }
    await file.save()
    const changes = []
    if (before.labels.join("|") !== (file.labels || []).join("|")) changes.push(file.labels.length ? `Labels: ${file.labels.join(", ")}` : "Labels cleared")
    if (before.propertyId !== (file.propertyId ? String(file.propertyId) : "")) changes.push(property ? `Linked to ${property.address}` : "No longer linked to a property")
    if (before.companyId !== (file.companyId ? String(file.companyId) : "")) changes.push(company ? `Filed under ${company.name}` : "No longer filed under a company")
    if (file.folder && before.folder !== file.folder) changes.push(`In ${folderName(place, file.folder)}`)
    await recordActivity({ user: req.user, title: "File updated", detail: [file.name, ...changes].join(" · "), propertyId: file.propertyId })
    const [presented] = await presentMany([file], req.user)
    res.json({ file: presented })
  }),
)

const ZIP_MAX_FILES = 150
const ZIP_MAX_BYTES = 1500 * 1024 * 1024

function zipSafe(text) {
  return String(text || "").replace(/[\\/:*?"<>|\u0000-\u001f]/g, "_").trim()
}

function placeIdOf(file) {
  return file.propertyId ? `p${file.propertyId}` : file.companyId ? `c${file.companyId}` : ""
}

// The path inside the zip: the property or company first when the zip mixes several, then the folder.
function zipEntryName(file, used, { withPlace, withFolder, placeNames, placeInName }) {
  // A flat zip with files from several houses or companies starts each name with where it is from.
  const base = `${placeInName ? `${zipSafe(placeNames.get(placeIdOf(file)) || "Not filed")} - ` : ""}${zipSafe(file.name) || "file"}`
  const folder = [
    withPlace ? zipSafe(placeNames.get(placeIdOf(file)) || "Not filed") : "",
    withFolder ? zipSafe(folderName(placeOf(file), folderOf(file))) : "",
  ].filter(Boolean).join("/")
  let name = folder ? `${folder}/${base}` : base
  if (used.has(name.toLowerCase())) {
    const dot = base.lastIndexOf(".")
    const stem = dot > 0 ? base.slice(0, dot) : base
    const ext = dot > 0 ? base.slice(dot) : ""
    let count = 2
    while (used.has(`${folder ? `${folder}/` : ""}${stem} (${count})${ext}`.toLowerCase())) count += 1
    name = `${folder ? `${folder}/` : ""}${stem} (${count})${ext}`
  }
  used.add(name.toLowerCase())
  return name
}

function dosTime(value) {
  const date = new Date(value || Date.now())
  const year = Math.min(2107, Math.max(1980, date.getFullYear()))
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    day: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  }
}

// Writes a zip (files stored as they are; PDFs, Office files, photos and videos are already compressed).
// flat: every file sits directly in the zip (the Agent's bundles); otherwise files from several places or folders
// are grouped into folders named after them.
async function writeZip(res, files, placeNames = new Map(), { flat = false } = {}) {
  let closed = false
  res.on("close", () => { closed = true })
  const write = (buffer) => new Promise((resolve) => {
    if (closed || res.write(buffer)) resolve()
    else {
      const done = () => { res.off("drain", done); res.off("close", done); resolve() }
      res.on("drain", done)
      res.on("close", done)
    }
  })
  const used = new Set()
  const manyPlaces = new Set(files.map(placeIdOf)).size > 1
  const withPlace = !flat && manyPlaces
  const placeInName = flat && manyPlaces
  const withFolder = !flat && (withPlace || new Set(files.map((file) => `${placeOf(file)}:${folderOf(file)}`)).size > 1)
  const entries = []
  let offset = 0
  for (const file of files) {
    if (closed) return
    let data
    try {
      data = await readStoredFile(file)
    } catch {
      continue
    }
    const name = Buffer.from(zipEntryName(file, used, { withPlace, withFolder, placeNames, placeInName }), "utf8")
    const crc = zlib.crc32(data) >>> 0
    const { time, day } = dosTime(file.createdAt)
    const header = Buffer.alloc(30)
    header.writeUInt32LE(0x04034b50, 0)
    header.writeUInt16LE(20, 4)
    header.writeUInt16LE(0x0800, 6)
    header.writeUInt16LE(0, 8)
    header.writeUInt16LE(time, 10)
    header.writeUInt16LE(day, 12)
    header.writeUInt32LE(crc, 14)
    header.writeUInt32LE(data.length, 18)
    header.writeUInt32LE(data.length, 22)
    header.writeUInt16LE(name.length, 26)
    header.writeUInt16LE(0, 28)
    await write(header)
    await write(name)
    await write(data)
    entries.push({ name, crc, size: data.length, time, day, offset })
    offset += 30 + name.length + data.length
  }
  const start = offset
  for (const entry of entries) {
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(0, 10)
    central.writeUInt16LE(entry.time, 12)
    central.writeUInt16LE(entry.day, 14)
    central.writeUInt32LE(entry.crc, 16)
    central.writeUInt32LE(entry.size, 20)
    central.writeUInt32LE(entry.size, 24)
    central.writeUInt16LE(entry.name.length, 28)
    central.writeUInt32LE(entry.offset, 42)
    await write(central)
    await write(entry.name)
    offset += 46 + entry.name.length
  }
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(offset - start, 12)
  end.writeUInt32LE(start, 16)
  await write(end)
  res.end()
}

// Several files in one download: /documents/zip?ids=a,b,c&name=Contracts
documentsRouter.get(
  "/zip",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const ids = [...new Set(String(req.query.ids || "").split(",").map((id) => id.trim()).filter((id) => /^[a-f0-9]{24}$/i.test(id)))]
    if (!ids.length) return sendError(res, 400, "Choose at least one file.")
    if (ids.length > ZIP_MAX_FILES) return sendError(res, 400, `Download up to ${ZIP_MAX_FILES} files at a time.`)
    const files = []
    for (const id of ids) {
      const file = await visibleFile(req, id)
      if (file && !HIDDEN_KINDS.includes(file.kind)) files.push(file)
    }
    if (!files.length) return sendError(res, 404, "Those files are not available.")
    const total = files.reduce((sum, file) => sum + (Number(file.size) || 0), 0)
    if (total > ZIP_MAX_BYTES) return sendError(res, 400, "That is too much to download at once. Choose fewer files.")
    const name = String(req.query.name || "SynergiFund documents").replace(/[\\/:*?"<>|\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 100) || "SynergiFund documents"
    res.setHeader("Content-Type", "application/zip")
    res.setHeader("Content-Disposition", `attachment; filename="${name.replace(/[^\x20-\x7e]/g, "_")}.zip"; filename*=UTF-8''${encodeURIComponent(name)}.zip`)
    res.setHeader("X-Content-Type-Options", "nosniff")
    const propertyIds = [...new Set(files.map((file) => file.propertyId && String(file.propertyId)).filter(Boolean))]
    const companyIds = [...new Set(files.map((file) => file.companyId && String(file.companyId)).filter(Boolean))]
    const [properties, companies] = await Promise.all([
      propertyIds.length ? Property.find({ _id: { $in: propertyIds } }).select("address") : [],
      companyIds.length && req.user.role !== "contractor" ? Company.find({ _id: { $in: companyIds } }).select("name") : [],
    ])
    const placeNames = new Map([
      ...properties.map((property) => [`p${property._id}`, property.address]),
      ...companies.map((company) => [`c${company._id}`, company.name]),
    ])
    await writeZip(res, files, placeNames, { flat: req.query.flat === "1" })
  }),
)

// The phone app asks for a short-lived link to save a file outside the page (Save to Files, AirDrop, Mail). Any
// download the person can open: a document, a zip, a chat file, an export.
documentsRouter.post(
  "/download-link",
  asyncHandler(async (req, res) => {
    const target = String(req.body?.path || "")
    if (!target.startsWith("/") || target.startsWith("//") || target.length > 4000) return sendError(res, 400, "That is not a download in this app.")
    const token = signDownloadLink(req.user._id, target)
    res.json({ path: `${target}${target.includes("?") ? "&" : "?"}dl=${encodeURIComponent(token)}` })
  }),
)

documentsRouter.get(
  "/:id/download",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const file = await visibleFile(req, req.params.id)
    if (!file) {
      sendError(res, 404, "That file is not available.")
      return
    }
    await sendStoredFile(res, file, { download: true })
  }),
)

documentsRouter.get(
  "/:id/preview",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const file = await visibleFile(req, req.params.id)
    if (!file) {
      sendError(res, 404, "That file is not available.")
      return
    }
    const lower = file.name.toLowerCase()
    const [presented] = await presentMany([file], req.user)
    const type = documentType(file.name) || (file.mime?.startsWith("image/") ? "image" : file.mime?.startsWith("video/") ? "video" : "")
    if (type === "pdf" || file.mime === "application/pdf") {
      res.json({ kind: "pdf", file: presented, url: `/api/documents/${file._id}/raw` })
      return
    }
    if (type === "video") {
      res.json({ kind: "video", file: presented, url: `/api/documents/${file._id}/raw` })
      return
    }
    if (/\.(xlsx|xlsm|xls|csv|docx)$/.test(lower)) {
      const stored = await materializeStoredFile(file)
      try {
        if (lower.endsWith(".docx")) {
          const result = await mammoth.convertToHtml({ path: stored.path })
          res.json({ kind: "document", file: (await presentMany([file], req.user))[0], html: result.value })
          return
        }
        const book = xlsx.readFile(stored.path)
        const sheets = book.SheetNames.map((name) => ({
          name,
          rows: xlsx.utils.sheet_to_json(book.Sheets[name], { header: 1, raw: false, defval: "" }).slice(0, 80),
        }))
        res.json({ kind: "sheet", file: (await presentMany([file], req.user))[0], sheets })
      } finally {
        await stored.cleanup()
      }
      return
    }
    if (file.mime?.startsWith("image/")) {
      res.json({ kind: "image", file: presented, url: publicFileUrl(file) || `/api/documents/${file._id}/raw` })
      return
    }
    res.json({ kind: "file", file: presented })
  }),
)

documentsRouter.get(
  "/:id/raw",
  requirePermission("documents.read"),
  asyncHandler(async (req, res) => {
    const file = await visibleFile(req, req.params.id)
    if (!file) {
      sendError(res, 404, "That file is not available.")
      return
    }
    const direct = publicFileUrl(file)
    if (direct) {
      res.redirect(direct)
      return
    }
    await sendStoredFile(res, file, { range: req.headers.range })
  }),
)

documentsRouter.delete(
  "/:id",
  requirePermission("documents.delete"),
  asyncHandler(async (req, res) => {
    const file = await visibleFile(req, req.params.id)
    if (!file || HIDDEN_KINDS.includes(file.kind)) {
      sendError(res, 404, "That file is not available.")
      return
    }
    if (file.kind === "receipt" || file.kind === "photo") {
      sendError(res, 400, "This file belongs to an expense or weekly photo set. Remove it from there instead.")
      return
    }
    await deleteStoredFile(file)
    await file.deleteOne()
    await recordActivity({ user: req.user, title: "File removed from the library", detail: file.name, propertyId: file.propertyId, href: !file.propertyId && file.companyId ? `/companies/${file.companyId}?tab=documents` : "" })
    res.json({ ok: true })
  }),
)

const PROPERTY_FIELDS = [
  ["address", ["address", "property address", "street", "property"], "text"],
  ["city", ["city", "location"], "text"],
  ["stage", ["stage", "property status"], "text"],
  ["strategy", ["strategy"], "text"],
  ["purchasePrice", ["purchase price", "purchase", "price"], "number"],
  ["purchaseDate", ["purchase date", "acquisition date", "acquired"], "date"],
  ["arv", ["arv", "after repair value"], "number"],
  ["rehabBudget", ["rehab budget", "rehab"], "number"],
  ["actualRent", ["actual rent", "rent"], "number"],
  ["marketRent", ["market rent"], "number"],
  ["ownerEntity", ["owner entity", "owner"], "text"],
  ["dealSource", ["deal source", "source"], "text"],
  ["nextAction", ["next action", "next step"], "text"],
  ["rentStatus", ["rent status"], "text"],
  ["rentMarket", ["rent market"], "text"],
  ["accessInfo", ["access info", "access"], "text"],
]

const LOAN_FIELDS = [
  ["lender", ["lender"], "text"],
  ["loanNumber", ["loan number", "loan #", "loan no"], "text"],
  ["balance", ["loan balance", "current balance", "balance"], "number"],
  ["payment", ["monthly payment", "mortgage payment", "payment"], "number"],
  ["maturity", ["maturity date", "maturity"], "date"],
  ["originalAmount", ["original loan amount", "original amount", "loan amount"], "number"],
]

const PORTFOLIO_ALIASES = [...PROPERTY_FIELDS, ...LOAN_FIELDS].flatMap((entry) => entry[1])

documentsRouter.post(
  "/import",
  requirePermission("imports.run"),
  receiveFile("file"),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      sendError(res, 400, "Upload an Excel workbook.")
      return
    }
    const lower = req.file.originalname.toLowerCase()
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      sendError(res, 400, "Import a .xls or .xlsx workbook.")
      return
    }
    const saved = await saveUploadedFile(req.file, req.user, { kind: "import" })
    await recordActivity({ user: req.user, title: "Property workbook uploaded", detail: `${saved.name} · waiting for review` })
    const stored = await materializeStoredFile(saved)
    let tables = []
    try {
      tables = readWorkbook(stored.path, PORTFOLIO_ALIASES)
    } catch {
      sendError(res, 400, "That workbook could not be read. Use an .xls or .xlsx file.")
      return
    } finally {
      await stored.cleanup()
    }
    const rows = tables.flatMap((table) => table.rows.map((source) => ({
      sheet: source.sheet,
      row: source.row,
      cells: sanitizeKeys(source.cells),
      mapped: mapPortfolioRow(source.cells),
    })))
    if (!rows.length) {
      sendError(res, 400, "That workbook has no rows to read.")
      return
    }
    const job = await ImportJob.create({
      fileId: saved._id,
      type: req.body.type || "portfolio",
      sheet: tables.map((table) => table.sheet).join(", "),
      headers: [...new Set(tables.flatMap((table) => table.headers))],
      rows: [],
      createdBy: req.user._id,
    })
    res.status(201).json({
      import: { id: String(job._id), sheet: job.sheet, count: rows.length, fileId: String(saved._id) },
      preview: rows.slice(0, 8).map((row) => row.mapped),
    })
  }),
)

documentsRouter.post(
  "/import/:id/confirm",
  requirePermission("imports.run"),
  asyncHandler(async (req, res) => {
    const job = await ImportJob.findById(req.params.id)
    if (!job || job.status !== "Draft") {
      sendError(res, 404, "That import is not waiting for confirmation.")
      return
    }
    if (job.type === "draws") {
      sendError(res, 400, "Confirm a draw workbook from Draws. This import does not change existing records.")
      return
    }
    const file = await DocumentFile.findById(job.fileId)
    const rows = await portfolioRows(file, job)
    let created = 0
    let updated = 0
    let skipped = 0
    for (const source of rows) {
      const mapped = source.mapped || mapPortfolioRow(source.cells || source)
      const address = String(mapped.address || "").trim()
      const sourceRef = { file: file?.name, sheet: source.sheet || job.sheet, row: source.row }
      if (!address) {
        skipped += 1
        if (Object.values(mapped).some((value) => value != null && value !== "")) {
          await Task.create({ title: "Import row skipped", notes: "No address in the source row, so no property was created.", labels: ["Verify"], priority: "High" })
        }
        continue
      }
      let property = await Property.findOne({ address: new RegExp(`^${escapeRegex(address)}$`, "i") })
      let changed = false
      if (!property) {
        property = await Property.create({
          address,
          city: mapped.city || "",
          stage: mapped.stage || "Under contract",
          strategy: mapped.strategy || "",
          purchasePrice: mapped.purchasePrice,
          purchaseDate: mapped.purchaseDate || "",
          arv: mapped.arv,
          rehabBudget: mapped.rehabBudget,
          actualRent: mapped.actualRent,
          marketRent: mapped.marketRent,
          ownerEntity: mapped.ownerEntity || "",
          dealSource: mapped.dealSource || "",
          nextAction: mapped.nextAction || "",
          rentStatus: mapped.rentStatus || "",
          rentMarket: mapped.rentMarket || "",
          accessInfo: mapped.accessInfo || "",
          importSource: sourceRef,
          updatedBy: req.user.name,
        })
        await saveImportedLoan(property, mapped, sourceRef)
        created += 1
      } else {
        if (fillProperty(property, mapped)) {
          property.updatedBy = req.user.name
          if (!property.importSource?.file) property.importSource = sourceRef
          await property.save()
          changed = true
        }
        if (await saveImportedLoan(property, mapped, sourceRef)) changed = true
        if (changed) updated += 1
      }
      if (mapped.purchasePrice == null && columnPresent(source.cells, "purchasePrice")) {
        await Task.create({ propertyId: property._id, title: "Purchase price not in source", notes: "Left blank. No price was invented.", labels: ["Verify"], priority: "High" })
      }
      if (mapped.arv == null && columnPresent(source.cells, "arv")) {
        await Task.create({ propertyId: property._id, title: "ARV not in source", notes: "Left blank. No value was invented.", labels: ["Verify"], priority: "High" })
      }
    }
    job.status = "Confirmed"
    job.counts = { pending: 0, added: created, duplicate: updated, skipped }
    await job.save()
    await recordActivity({ user: req.user, title: "Workbook imported", detail: `${created} new properties, ${updated} updated, from ${file?.name}` })
    res.json({ created, updated, skipped })
  }),
)

async function portfolioRows(file, job) {
  if (!file) return job.rows || []
  const stored = await materializeStoredFile(file)
  try {
    const tables = readWorkbook(stored.path, PORTFOLIO_ALIASES)
    if (!tables.length) return job.rows || []
    return tables.flatMap((table) => table.rows.map((source) => ({
      sheet: source.sheet,
      row: source.row,
      cells: sanitizeKeys(source.cells),
      mapped: mapPortfolioRow(source.cells),
    })))
  } finally {
    await stored.cleanup()
  }
}

function mapPortfolioRow(cells = {}) {
  return Object.fromEntries([...PROPERTY_FIELDS, ...LOAN_FIELDS].map(([key, , kind]) => [key, readCell(cells, key, kind)]))
}

function readCell(cells, key, kind) {
  const fields = key in Object.fromEntries(LOAN_FIELDS) ? LOAN_FIELDS : PROPERTY_FIELDS
  const aliases = fields.find((entry) => entry[0] === key)?.[1] || []
  const header = Object.keys(cells).find((item) => aliases.includes(String(item).trim().toLowerCase()))
  if (!header) return undefined
  const value = cells[header]
  if (kind === "number") return numberOrEmpty(value)
  if (kind === "date") return asDate(value)
  const text = String(value || "").trim()
  return text || undefined
}

function columnPresent(cells = {}, key) {
  const fields = [...PROPERTY_FIELDS, ...LOAN_FIELDS]
  const aliases = fields.find((entry) => entry[0] === key)?.[1] || []
  return Object.keys(cells).some((item) => aliases.includes(String(item).trim().toLowerCase()))
}

function fillProperty(property, mapped) {
  const thin = property.purchasePrice == null && property.arv == null
  let changed = false
  if (thin && mapped.stage && property.stage === "Under contract" && mapped.stage !== property.stage) {
    property.stage = mapped.stage
    changed = true
  }
  for (const key of ["city", "strategy", "purchasePrice", "purchaseDate", "arv", "rehabBudget", "actualRent", "marketRent", "ownerEntity", "dealSource", "nextAction", "rentStatus", "rentMarket", "accessInfo"]) {
    if (fillBlank(property, key, mapped[key])) changed = true
  }
  return changed
}

function fillBlank(record, key, value) {
  if (value == null || value === "") return false
  if (record[key] != null && record[key] !== "") return false
  record[key] = value
  return true
}

async function saveImportedLoan(property, mapped, sourceRef) {
  const hasLoan = mapped.lender || mapped.loanNumber || mapped.balance != null || mapped.payment != null || mapped.maturity || mapped.originalAmount != null
  if (!hasLoan) return false
  const query = { propertyId: property._id }
  if (mapped.loanNumber) query.loanNumber = mapped.loanNumber
  else if (mapped.lender) query.lender = mapped.lender
  let loan = await Loan.findOne(query)
  if (!loan) {
    const lender = mapped.lender ? await lenderForName(mapped.lender) : null
    await Loan.create({
      propertyId: property._id,
      lenderId: lender?._id,
      lender: lender?.name || mapped.lender || "",
      label: "Financed",
      loanNumber: mapped.loanNumber || "",
      balance: mapped.balance,
      payment: mapped.payment,
      maturity: mapped.maturity || "",
      originalAmount: mapped.originalAmount,
      termsStatus: "Needs verification",
      importSource: sourceRef,
    })
    return true
  }
  let changed = false
  for (const key of ["lender", "loanNumber", "balance", "payment", "maturity", "originalAmount"]) {
    if (fillBlank(loan, key, mapped[key])) changed = true
  }
  if (changed) await loan.save()
  return changed
}

function sanitizeKeys(cells) {
  return Object.fromEntries(Object.entries(cells).map(([key, value]) => [key.replace(/[.$]/g, " "), value]))
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function numberOrEmpty(value) {
  if (value === "" || value == null) return undefined
  const number = Number(String(value).replace(/[$,]/g, ""))
  return Number.isFinite(number) ? number : undefined
}

function asDate(value) {
  const text = String(value || "").trim()
  if (!text) return undefined
  if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10)
  const parts = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/)
  if (!parts) return text
  const year = parts[3].length === 2 ? `20${parts[3]}` : parts[3]
  return `${year}-${parts[1].padStart(2, "0")}-${parts[2].padStart(2, "0")}`
}
