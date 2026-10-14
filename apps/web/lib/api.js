export async function api(path, options = {}) {
  const body = options.body
  const isForm = typeof FormData !== "undefined" && body instanceof FormData
  const response = await fetch(`/api${path}`, {
    ...options,
    credentials: "include",
    headers: isForm ? options.headers : { "Content-Type": "application/json", ...(options.headers || {}) },
    body: isForm || typeof body === "string" || body == null ? body : JSON.stringify(body),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const error = new Error(data.error || "Request failed")
    error.status = response.status
    throw error
  }
  return data
}

// Uploads a form and reports progress from 0 to 1, for big files such as videos.
export function uploadForm(path, form, onProgress) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    request.open("POST", `/api${path}`)
    request.withCredentials = true
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress?.(event.loaded / event.total)
    }
    request.onload = () => {
      let data = {}
      try {
        data = JSON.parse(request.responseText || "{}")
      } catch {}
      if (request.status >= 200 && request.status < 300) {
        resolve(data)
        return
      }
      const error = new Error(data.error || (request.status === 413 ? "That file is too large to upload." : "The upload failed."))
      error.status = request.status
      reject(error)
    }
    request.onerror = () => reject(new Error("The upload was interrupted. Check the connection and try again."))
    request.send(form)
  })
}
