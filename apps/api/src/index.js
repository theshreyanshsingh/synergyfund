import dotenv from "dotenv"
import path from "node:path"
import { fileURLToPath } from "node:url"
import express from "express"
import cookieParser from "cookie-parser"
import cors from "cors"
import mongoose from "mongoose"
import { authRouter } from "./routes/auth.js"
import { propertiesRouter } from "./routes/properties.js"
import { expensesRouter } from "./routes/expenses.js"
import { drawsRouter } from "./routes/draws.js"
import { documentsRouter } from "./routes/documents.js"
import { workspaceRouter } from "./routes/workspace.js"
import { pushRouter } from "./routes/push.js"
import { requireAuth } from "./middleware/auth.js"
import { seedIfEmpty } from "./services/seed.js"

const repoRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), "../../..")
dotenv.config({ path: path.join(repoRoot, ".env"), quiet: true })

const app = express()
app.use(cors({ origin: process.env.WEB_ORIGIN || "http://localhost:3000", credentials: true }))
app.use(cookieParser())
app.use(express.json({ limit: "2mb" }))

app.get("/health", (req, res) => res.json({ ok: true }))
app.use("/auth", authRouter)

const api = express.Router()
api.use(requireAuth)
api.use("/properties", propertiesRouter)
api.use("/expenses", expensesRouter)
api.use("/draws", drawsRouter)
api.use("/documents", documentsRouter)
api.use("/push", pushRouter)
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
app.listen(port, () => {
  console.log(`SynergiFund API on ${port}`)
})
