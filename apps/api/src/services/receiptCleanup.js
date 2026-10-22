import { DocumentFile, Receipt } from "../models/index.js"
import { deleteStoredFile } from "./files.js"

async function removeReceipts(receipts) {
  const fileIds = receipts.flatMap((receipt) => receipt.fileIds || [])
  const files = fileIds.length ? await DocumentFile.find({ _id: { $in: fileIds }, kind: "receipt-scan" }) : []
  await Promise.all(files.map((file) => deleteStoredFile(file).catch((error) => console.error("Receipt file removal failed", error))))
  if (files.length) await DocumentFile.deleteMany({ _id: { $in: files.map((file) => file._id) } })
  if (receipts.length) await Receipt.deleteMany({ _id: { $in: receipts.map((receipt) => receipt._id) } })
}

// A deleted property leaves the receipts filed on it. A receipt filed only there goes with its costs (its photo
// too); one shared with other properties stays for them.
export async function forgetPropertyOnReceipts(propertyId) {
  const receipts = await Receipt.find({ propertyIds: propertyId }).select("status propertyIds fileIds")
  const only = receipts.filter((receipt) => receipt.status !== "Draft" && (receipt.propertyIds || []).every((id) => String(id) === String(propertyId)))
  await removeReceipts(only)
  const rest = receipts.filter((receipt) => !only.includes(receipt)).map((receipt) => receipt._id)
  if (rest.length) await Receipt.updateMany({ _id: { $in: rest } }, { $pull: { propertyIds: propertyId } })
}

// A member who leaves takes their unfinished receipts with them; the ones they filed stay on the books.
export async function removeDraftReceipts(userId) {
  await removeReceipts(await Receipt.find({ createdBy: userId, status: "Draft" }).select("fileIds"))
}
