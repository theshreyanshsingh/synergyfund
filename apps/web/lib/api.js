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
