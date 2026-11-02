import { encryptField, encryptionOn, isEncrypted, readField } from "./crypto.js"

// Fields encrypted before they reach the database. A loaded record holds the plain value, so routes read, compare and
// change it as before: it is decrypted when the record is loaded and encrypted again when the record is saved.
// Records saved before encryption still read; the encryption job (services/encryptData.js) encrypts them.
//
// Only save() and create() encrypt. An update query (updateOne, findOneAndUpdate…) that sets one of these fields is
// refused, so a value can't reach the database in plain text by another route.

export function sealedContext(model, field, id) {
  return `${model}.${field}:${id}`
}

export function sealedFields(schema, { model, fields }) {
  function open(doc) {
    if (!doc?._id) return
    for (const field of fields) {
      const stored = doc.get(field)
      if (!isEncrypted(stored)) continue
      doc.set(field, readField(stored, sealedContext(model, field, doc._id)))
      doc.unmarkModified(field)
    }
  }

  function openPlain(record) {
    if (!record?._id) return
    for (const field of fields) {
      if (isEncrypted(record[field])) record[field] = readField(record[field], sealedContext(model, field, record._id))
    }
  }

  schema.post("init", function () {
    open(this)
  })

  schema.pre("save", function () {
    if (!encryptionOn()) return
    for (const field of fields) {
      const value = this.get(field)
      if (typeof value !== "string" || value === "" || isEncrypted(value)) continue
      if (this.isNew || this.isModified(field)) this.set(field, encryptField(value, sealedContext(model, field, this._id)))
    }
  })

  schema.post("save", function () {
    open(this)
  })

  // lean() queries skip the document hooks above.
  schema.post(["find", "findOne", "findOneAndUpdate", "findOneAndReplace", "findOneAndDelete"], function (result) {
    if (!this.mongooseOptions().lean) return
    for (const record of Array.isArray(result) ? result : [result]) openPlain(record)
  })

  schema.pre(["updateOne", "updateMany", "findOneAndUpdate", "replaceOne", "findOneAndReplace"], { document: false, query: true }, function () {
    const update = this.getUpdate() || {}
    const sets = [update, update.$set, update.$setOnInsert].filter(Boolean)
    const touched = fields.filter((field) => sets.some((set) => typeof set[field] === "string" && set[field] !== ""))
    if (touched.length) throw new Error(`${model} ${touched.join(", ")} ${touched.length > 1 ? "are" : "is"} encrypted, so save it through the record (save or create), not an update query.`)
  })

  schema.pre("insertMany", function (next, docs) {
    const list = Array.isArray(docs) ? docs : [docs]
    if (list.some((doc) => fields.some((field) => typeof doc?.[field] === "string" && doc[field] !== ""))) {
      next(new Error(`${model} has encrypted fields, so add it with create, not insertMany.`))
      return
    }
    next()
  })
}
