// Encrypts records and files saved before encryption was switched on, and moves them to the newest key after a
// rotation. Run it after the new build is serving: the build before encryption can't read encrypted records.
// Safe to run again. From the repository root: npm run db:encrypt
import path from "node:path"
import { fileURLToPath } from "node:url"
import dotenv from "dotenv"
import mongoose from "mongoose"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..")
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true })

// Loaded after .env, so they see its settings.
const { currentKeyId, encryptionOn } = await import("../src/lib/crypto.js")
const { encryptStoredData } = await import("../src/services/encryptData.js")

try {
  if (!encryptionOn()) throw new Error("FIELD_ENCRYPTION_KEYS is not set in .env, so there is nothing to encrypt with.")
  await mongoose.connect(process.env.MONGODB_URI)
  const done = await encryptStoredData()
  console.log(`Encrypted with key ${currentKeyId()}: ${done.companies} companies, ${done.properties} properties, ${done.logEntries} activity entries and alerts, ${done.files} files, ${done.fileCopies} backup copies of files.`)
  if (done.missing) console.log(`${done.missing} files or copies couldn't be read. Look at the errors above, then run this again.`)
} catch (error) {
  console.error(error instanceof Error ? error.message : error)
  process.exitCode = 1
} finally {
  await mongoose.disconnect()
}
