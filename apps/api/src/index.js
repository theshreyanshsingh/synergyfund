import dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"
import http from "node:http"
import express from "express"
import cookieParser from "cookie-parser"
import cors from "cors"
import mongoose from "mongoose"
import { authRouter } from "./routes/auth.js"
import { propertiesRouter } from "./routes/properties.js"
import { companiesRouter } from "./routes/companies.js"
import { expensesRouter } from "./routes/expenses.js"
import { drawsRouter } from "./routes/draws.js"
import { documentsRouter } from "./routes/documents.js"
import { workspaceRouter } from "./routes/workspace.js"
import { nativeDecline, pushRouter } from "./routes/push.js"
import { agentRouter } from "./routes/agent.js"
import { chatRouter } from "./routes/chat.js"
import { allowedOrigins, attachChatSockets } from "./services/chatHub.js"
import { closeStaleCalls } from "./services/calls.js"
import { callsRouter } from "./routes/calls.js"
import { requireAuth } from "./middleware/auth.js"
import { trackActivity } from "./middleware/activity.js"
import { seedIfEmpty } from "./services/seed.js"
import { rememberAppOrigin } from "./services/appUrl.js"
import { recoverNotes } from "./services/callNotes.js"
import { startTeammate } from "./services/siteAgent.js"
import { teammateRouter } from "./routes/teammate.js"
import { backupsRouter } from "./routes/backups.js"
import { receiptsRouter } from "./routes/receipts.js"
import { restoreRunning, startBackupSchedule } from "./services/backup.js"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..")
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true })

const app = express()
app.use(cors({ origin: allowedOrigins(), credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: "2mb" }))

// The web app passes on the address it was opened at, for links in emails (see appUrl.js).
app.use((req, res, next) => {
  rememberAppOrigin(req.headers["x-app-origin"])
  next()
})
app.get("/health", (req, res) => res.json({ ok: true }))
// While a backup is being restored nothing can be changed (it would be lost), and sign-in waits too.
app.use((req, res, next) => {
  if (restoreRunning() && !["GET", "HEAD", "OPTIONS"].includes(req.method)) {
    res.status(503).json({ error: "SynergiFund is restoring a backup. Try again in a minute." })
    return
  }
  next()
})
app.use("/auth", authRouter)
// The Android app declines a call from the lock screen with its own device key (no sign-in cookie there).
app.post("/push/native/decline", nativeDecline)

const api = express.Router()
api.use(requireAuth)
api.use(trackActivity)
api.use("/properties", propertiesRouter)
api.use("/companies", companiesRouter)
api.use("/expenses", expensesRouter)
api.use("/draws", drawsRouter)
api.use("/documents", documentsRouter)
api.use("/push", pushRouter)
api.use("/agent", agentRouter)
api.use("/chat", chatRouter)
api.use("/calls", callsRouter)
api.use("/teammate", teammateRouter)
api.use("/backups", backupsRouter)
api.use("/receipts", receiptsRouter)
api.use(workspaceRouter)
app.use(api)

app.use((error, req, res, next) => {
  if (res.headersSent) {
    next(error)
    return
  }
  const status = error.status || 500
  res.status(status).json({ error: error.message || "Something went wrong." })
})

const port = Number(process.env.PORT || 4000)
await mongoose.connect(process.env.MONGODB_URI)
await seedIfEmpty()
await closeStaleCalls()
await recoverNotes().catch((error) => console.error("Call notes recovery failed", error))
await startTeammate().catch((error) => console.error("AI teammate failed to start", error))
startBackupSchedule()
const server = http.createServer(app)
attachChatSockets(server)
server.listen(port, () => {
  console.log(`SynergiFund API on ${port}`)
})
