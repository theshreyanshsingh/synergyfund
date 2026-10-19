import { Directory, File, Paths } from "expo-file-system"
import * as Sharing from "expo-sharing"

// A file name the phone can save (no slashes or odd characters).
function safeName(name) {
  return String(name || "").replace(/[\\/:*?"<>|\u0000-\u001f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 120)
}

// Downloads a file the website handed over (a short-lived link) and opens the share sheet: Save to Files, AirDrop,
// Mail, Outlook… onProgress gets 0 to 1 while it downloads, or null when the size is not known.
export async function downloadAndShare(url, name, onProgress) {
  const folder = new Directory(Paths.cache, "downloads")
  folder.create({ idempotent: true, intermediates: true })
  const cleaned = safeName(name)
  let destination = folder
  if (cleaned) {
    destination = new File(folder, cleaned)
    if (destination.exists) destination.delete()
  }
  const task = File.createDownloadTask(url, destination, {
    onProgress: ({ bytesWritten, totalBytes }) => onProgress?.(totalBytes > 0 ? Math.min(1, bytesWritten / totalBytes) : null),
  })
  const file = await task.downloadAsync()
  if (!file) throw new Error("The download stopped before it finished.")
  // A refused download (an expired link, no access) comes back as a short error message, not the file.
  if (Number(file.size) > 0 && Number(file.size) < 4096) {
    const text = await file.text().catch(() => "")
    if (/^\s*\{\s*"error"/.test(text)) {
      file.delete()
      let message = "The file could not be downloaded."
      try {
        message = JSON.parse(text).error || message
      } catch {}
      throw new Error(message)
    }
  }
  if (!(await Sharing.isAvailableAsync())) throw new Error("This phone cannot open the share sheet.")
  await Sharing.shareAsync(file.uri)
  return file
}
