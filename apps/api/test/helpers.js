import { spawn } from "node:child_process"
import { randomBytes } from "node:crypto"
import fs from "node:fs"
import http from "node:http"
import net from "node:net"
import os from "node:os"
import path from "node:path"

// Shared by the tests. Each test file sets its environment with testEnv() before importing any app code, so nothing
// reaches the real database, bucket or uploads folder, and the real .env is never read.

export const KEY1 = `k1:${randomBytes(32).toString("base64")}`
export const KEY2 = `k2:${randomBytes(32).toString("base64")}`

export function testEnv() {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "synergifund-test-"))
  Object.assign(process.env, {
    UPLOADS_DIR: path.join(scratch, "uploads"),
    BACKUPS_DIR: path.join(scratch, "backups"),
    AWS_REGION: "",
    AWS_S3_BUCKET: "",
    AWS_ACCESS_KEY_ID: "",
    AWS_SECRET_ACCESS_KEY: "",
    AWS_S3_ENDPOINT: "",
    AWS_S3_PREFIX: "synergifund",
    AWS_CONFIG_FILE: path.join(scratch, "aws-config"),
    AWS_SHARED_CREDENTIALS_FILE: path.join(scratch, "aws-credentials"),
    FIELD_ENCRYPTION_KEYS: "",
    MONGODB_URI: "",
  })
  process.once("exit", () => fs.rmSync(scratch, { recursive: true, force: true }))
  return scratch
}

// Files go to the fake S3 server while this is on, and to the scratch uploads folder while it is off.
export function useS3(s3, on = true) {
  Object.assign(process.env, on
    ? { AWS_REGION: "us-east-1", AWS_S3_BUCKET: "test-bucket", AWS_ACCESS_KEY_ID: "test", AWS_SECRET_ACCESS_KEY: "test", AWS_S3_ENDPOINT: s3.url }
    : { AWS_REGION: "", AWS_S3_BUCKET: "", AWS_ACCESS_KEY_ID: "", AWS_SECRET_ACCESS_KEY: "" })
}

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.on("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address()
      server.close(() => resolve(port))
    })
  })
}

function findMongod() {
  if (process.env.MONGOD) return process.env.MONGOD
  const cache = path.join(os.homedir(), ".cache", "mongodb-binaries")
  const cached = fs.existsSync(cache) ? fs.readdirSync(cache).filter((name) => /^mongod-[^.]+(\.\d+)*$/.test(name)).sort().reverse() : []
  return cached.length ? path.join(cache, cached[0]) : "mongod"
}

// A throwaway MongoDB on a free port with its own data folder. Set MONGOD to the binary if it is not on PATH or in
// ~/.cache/mongodb-binaries.
export async function startMongo() {
  const port = await freePort()
  const dbpath = fs.mkdtempSync(path.join(os.tmpdir(), "synergifund-mongo-"))
  const child = spawn(findMongod(), ["--dbpath", dbpath, "--port", String(port), "--bind_ip", "127.0.0.1", "--quiet"], { stdio: ["ignore", "pipe", "pipe"] })
  let output = ""
  child.stdout.on("data", (data) => {
    output += data
  })
  child.stderr.on("data", (data) => {
    output += data
  })
  const exited = new Promise((resolve) => child.once("exit", resolve))
  // A test run that stops early still takes its database down with it.
  const stopOnExit = () => child.kill("SIGTERM")
  process.once("exit", stopOnExit)
  for (let tries = 0; ; tries += 1) {
    if (child.exitCode !== null) throw new Error(`mongod stopped: ${output.slice(-500)}`)
    const ready = await new Promise((resolve) => {
      const socket = net.connect(port, "127.0.0.1", () => {
        socket.end()
        resolve(true)
      })
      socket.on("error", () => resolve(false))
    })
    if (ready) break
    if (tries > 150) throw new Error("mongod did not start in time.")
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  return {
    uri: `mongodb://127.0.0.1:${port}/synergifund-test`,
    async stop() {
      process.off("exit", stopOnExit)
      child.kill("SIGTERM")
      await exited
      fs.rmSync(dbpath, { recursive: true, force: true })
    },
  }
}

function decodeAwsChunked(body) {
  const parts = []
  let at = 0
  while (at < body.length) {
    const lineEnd = body.indexOf("\r\n", at)
    const size = parseInt(body.subarray(at, lineEnd).toString("latin1").split(";")[0], 16)
    at = lineEnd + 2
    if (!size) break
    parts.push(body.subarray(at, at + size))
    at += size + 2
  }
  return Buffer.concat(parts)
}

function xmlError(res, status, code) {
  res.writeHead(status, { "Content-Type": "application/xml" })
  res.end(`<?xml version="1.0" encoding="UTF-8"?><Error><Code>${code}</Code><Message>${code}</Message></Error>`)
}

// Enough of Amazon S3 for the app: put, copy, get (with byte ranges), head, delete and list. `objects` maps
// "bucket/key" to the stored bytes, and `gets` counts reads of each.
export async function startFakeS3() {
  const objects = new Map()
  const gets = new Map()
  const server = http.createServer(async (req, res) => {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    let body = Buffer.concat(chunks)
    const url = new URL(req.url, "http://localhost")
    const [bucket, ...rest] = url.pathname.slice(1).split("/").map(decodeURIComponent)
    const name = `${bucket}/${rest.join("/")}`
    if (req.method === "GET" && url.searchParams.get("list-type") === "2") {
      const prefix = `${bucket}/${url.searchParams.get("prefix") || ""}`
      const items = [...objects.entries()].filter(([key]) => key.startsWith(prefix))
      res.writeHead(200, { "Content-Type": "application/xml" })
      res.end(`<?xml version="1.0" encoding="UTF-8"?><ListBucketResult><IsTruncated>false</IsTruncated>${items.map(([key, value]) => `<Contents><Key>${key.slice(bucket.length + 1)}</Key><Size>${value.length}</Size></Contents>`).join("")}</ListBucketResult>`)
      return
    }
    if (req.method === "PUT") {
      const source = req.headers["x-amz-copy-source"]
      if (source) {
        const from = decodeURIComponent(String(source)).replace(/^\//, "")
        if (!objects.has(from)) return xmlError(res, 404, "NoSuchKey")
        objects.set(name, Buffer.from(objects.get(from)))
        res.writeHead(200, { "Content-Type": "application/xml" })
        res.end(`<?xml version="1.0" encoding="UTF-8"?><CopyObjectResult><ETag>"copy"</ETag><LastModified>${new Date().toISOString()}</LastModified></CopyObjectResult>`)
        return
      }
      if (String(req.headers["content-encoding"] || "").includes("aws-chunked") || String(req.headers["x-amz-content-sha256"] || "").startsWith("STREAMING-")) body = decodeAwsChunked(body)
      objects.set(name, body)
      res.writeHead(200, { ETag: '"put"' })
      res.end()
      return
    }
    if (req.method === "DELETE") {
      objects.delete(name)
      res.writeHead(204)
      res.end()
      return
    }
    const stored = objects.get(name)
    if (req.method === "HEAD") {
      res.writeHead(stored ? 200 : 404, stored ? { "Content-Length": stored.length } : {})
      res.end()
      return
    }
    if (req.method !== "GET") return xmlError(res, 405, "MethodNotAllowed")
    if (!stored) return xmlError(res, 404, "NoSuchKey")
    gets.set(name, (gets.get(name) || 0) + 1)
    const range = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ""))
    if (!range) {
      res.writeHead(200, { "Content-Length": stored.length, "Content-Type": "application/octet-stream" })
      res.end(stored)
      return
    }
    const start = Number(range[1])
    if (start >= stored.length) return xmlError(res, 416, "InvalidRange")
    const end = Math.min(stored.length - 1, range[2] ? Number(range[2]) : stored.length - 1)
    res.writeHead(206, { "Content-Length": end - start + 1, "Content-Range": `bytes ${start}-${end}/${stored.length}`, "Content-Type": "application/octet-stream" })
    res.end(stored.subarray(start, end + 1))
  })
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve))
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    objects,
    gets,
    object: (key) => objects.get(`test-bucket/${key}`),
    stop: () => new Promise((resolve) => server.close(resolve)),
  }
}

export function contains(haystack, needle) {
  return Buffer.from(haystack).includes(Buffer.from(needle))
}
