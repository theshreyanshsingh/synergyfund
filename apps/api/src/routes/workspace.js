import { Router } from "express"
import { can, isRole, knownPermissions, permissionOverrides, permissionsFor, PERMISSIONS } from "@synergifund/shared"
import {
  Activity,
  AgentThread,
  Bill,
  ConstructionProject,
  DocumentFile,
  Draw,
  DrawBudget,
  Expense,
  Loan,
  MailMessage,
  Notification,
  PhotoSet,
  Property,
  ReviewItem,
  Task,
  User,
} from "../models/index.js"
import { asyncHandler, requirePermission, sendError } from "../lib/http.js"
import { publicUser } from "../lib/serialize.js"
import { propertyFilter } from "../services/access.js"
import { refreshRehabRemaining } from "./draws.js"
import { answerQuestion } from "../services/agent.js"
import { saveUploadedFile, upload } from "../services/files.js"
import { notify, recordActivity } from "../services/notify.js"

export const workspaceRouter = Router()

workspaceRouter.get(
  "/overview",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const properties = await Property.find(propertyFilter(req.user))
    const ids = properties.map((property) => property._id)
    const [loans, budgets, draws, expenses, tasks] = await Promise.all([
      Loan.find({ propertyId: { $in: ids } }),
      req.permissions.includes("draws.read") ? DrawBudget.find({ propertyId: { $in: ids } }) : [],
      req.permissions.includes("draws.read") ? Draw.find({ propertyId: { $in: ids } }) : [],
      req.permissions.includes("expenses.read") ? Expense.find({ propertyId: { $in: ids } }) : [],
      Task.find({ $or: [{ propertyId: { $in: ids } }, { propertyId: null }] }),
    ])
    const purchase = sum(properties, "purchasePrice")
    const arv = sum(properties, "arv")
    const rehab = sum(properties, "rehabBudget")
    const rent = sum(properties, "actualRent")
    const balance = loans.reduce((total, loan) => total + Number(loan.balance || 0), 0)
    const received = draws.filter((draw) => draw.status === "Funded").reduce((total, draw) => total + Number(draw.fundedAmount ?? draw.amount ?? 0), 0)
    const undrawn = properties.reduce((total, property) => {
      const schedule = drawSchedule(property, budgets, draws)
      const funded = draws.filter((draw) => String(draw.propertyId) === String(property._id) && draw.status === "Funded").reduce((sum, draw) => sum + Number(draw.fundedAmount ?? draw.amount ?? 0), 0)
      return schedule == null ? total : total + Math.max(0, schedule - funded)
    }, 0)
    const rehabCosts = expenses.filter((expense) => expense.costTreatment !== "Exclude from construction margin")
    const spent = rehabCosts.reduce((total, expense) => total + Number(expense.amount || 0), 0)
    const stages = countBy(properties, (property) => property.stage || "Stage not set")
    const openTasks = tasks.filter((task) => !task.done)
    const verify = openTasks.filter((task) => (task.labels || []).includes("Verify"))
    const days = allowedDays(req.query.days)
    const months = recentMonths(8)
    const labels = [...months.map(monthLabel), futureLabel(days, months)]
    const cards = [
      lineCard("Portfolio", String(properties.length), "Properties added, running total", stages.map(([label, amount]) => `${amount} ${label.toLowerCase()}`).join(" · "), false, [
        series("Properties", properties.map((property) => ({ at: property.createdAt, amount: 1 })), months, days),
      ]),
      lineCard("Recorded value", currency(purchase), "Purchase price and ARV, only where a number was entered", `${properties.filter((property) => property.purchasePrice == null).length} missing a purchase price · ${properties.filter((property) => property.arv == null).length} missing an ARV`, true, [
        series("Purchase", properties.filter((property) => property.purchasePrice != null).map((property) => ({ at: property.purchaseDate || property.createdAt, amount: Number(property.purchasePrice) })), months, days),
        series("ARV", properties.filter((property) => property.arv != null).map((property) => ({ at: property.arvDate || property.createdAt, amount: Number(property.arv) })), months, days),
      ]),
    ]
    if (req.permissions.includes("draws.read")) {
      cards.push(lineCard("Draws", currency(received), "Lender cash received on the funded date", `${currency(undrawn)} still undrawn`, true, [
        series("Received", draws.filter((draw) => draw.status === "Funded").map((draw) => ({ at: draw.fundedDate || draw.createdAt, amount: Number(draw.fundedAmount ?? draw.amount ?? 0) })), months, days),
      ]))
    }
    cards.push(lineCard("Rehab", currency(Math.max(0, rehab - spent)), "Rehab budget recorded against costs posted", `${currency(rehab)} budget · ${currency(spent)} posted`, true, [
      series("Budget", properties.filter((property) => property.rehabBudget != null).map((property) => ({ at: property.createdAt, amount: Number(property.rehabBudget) })), months, days),
      series("Costs", rehabCosts.map((expense) => ({ at: expense.date || expense.createdAt, amount: Number(expense.amount || 0) })), months, days),
    ]))
    cards.push(lineCard("Loans and rent", currency(balance), "Loan balances and rent as they were recorded", `${currency(rent)} rent on file`, true, [
      series("Loans", loans.map((loan) => ({ at: loan.createdAt, amount: Number(loan.balance || 0) })), months, days),
      series("Rent", properties.filter((property) => property.actualRent != null).map((property) => ({ at: property.createdAt, amount: Number(property.actualRent) })), months, days),
    ]))
    cards.push(lineCard("Open work", String(openTasks.length), "Tasks added over the last months", `${verify.length} marked Verify · ${properties.filter((property) => property.purchasePrice == null).length} missing a purchase price`, false, [
      series("Tasks", tasks.map((task) => ({ at: task.createdAt, amount: 1 })), months, days),
      series("Verify", tasks.filter((task) => (task.labels || []).includes("Verify")).map((task) => ({ at: task.createdAt, amount: 1 })), months, days),
    ]))
    const bills = req.permissions.includes("expenses.read")
      ? await Bill.find({ $or: [{ propertyId: { $in: ids } }, { propertyId: null }] })
      : []
    res.json({
      days,
      labels,
      projection: expenseProjection(expenses, bills, days),
      cards: cards.map((card) => ({ ...card, labels })),
    })
  }),
)

workspaceRouter.get(
  "/tasks",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    await moveOpenReviewsOntoTasks()
    const properties = await Property.find(propertyFilter(req.user)).select("_id")
    const items = await Task.find({ $or: [{ propertyId: { $in: properties.map((property) => property._id) } }, { propertyId: null }] }).sort({ done: 1, due: 1 })
    res.json({ items: items.map(presentTask) })
  }),
)

workspaceRouter.post(
  "/tasks",
  requirePermission("tasks.write"),
  asyncHandler(async (req, res) => {
    if (!req.body.title) {
      sendError(res, 400, "Describe what needs to happen.")
      return
    }
    const task = await Task.create({
      title: req.body.title,
      propertyId: req.body.propertyId || undefined,
      owner: req.body.owner || req.user.name,
      due: req.body.due || "",
      priority: req.body.priority || "Medium",
      labels: cleanLabels(req.body.labels),
      notes: req.body.notes || "",
    })
    res.status(201).json({ task: presentTask(task) })
  }),
)

workspaceRouter.patch(
  "/tasks/:id",
  requirePermission("tasks.write"),
  asyncHandler(async (req, res) => {
    const task = await Task.findById(req.params.id)
    if (!task) {
      sendError(res, 404, "That task was not found.")
      return
    }
    if ("done" in req.body) task.done = Boolean(req.body.done)
    if (req.body.title) task.title = req.body.title
    if ("due" in req.body) task.due = req.body.due || ""
    if (req.body.priority) task.priority = req.body.priority
    if ("labels" in req.body) task.labels = cleanLabels(req.body.labels)
    if ("notes" in req.body) task.notes = req.body.notes || ""
    await task.save()
    res.json({ task: presentTask(task) })
  }),
)

workspaceRouter.get(
  "/bills",
  requirePermission("expenses.read"),
  asyncHandler(async (req, res) => {
    const items = await Bill.find().sort({ due: 1 })
    res.json({ items: items.map(presentBill) })
  }),
)

workspaceRouter.post(
  "/bills",
  requirePermission("expenses.approve"),
  asyncHandler(async (req, res) => {
    const bill = await Bill.create({
      title: req.body.title,
      amount: Number(req.body.amount) || 0,
      category: req.body.category || "Other",
      entity: req.body.entity || "Investment company",
      due: req.body.due,
      propertyId: req.body.propertyId || undefined,
      vendor: req.body.vendor || "",
      recurrence: req.body.recurrence || "One time",
    })
    res.status(201).json({ bill: presentBill(bill) })
  }),
)

workspaceRouter.post(
  "/bills/:id/pay",
  requirePermission("expenses.approve"),
  asyncHandler(async (req, res) => {
    const bill = await Bill.findById(req.params.id)
    if (!bill) {
      sendError(res, 404, "That payment was not found.")
      return
    }
    const paidOn = new Date().toISOString().slice(0, 10)
    bill.paidOn = paidOn
    bill.status = "Paid"
    await bill.save()
    await Expense.create({
      propertyId: bill.propertyId,
      title: bill.title,
      amount: bill.amount,
      category: bill.category === "Mortgage" ? "Financing" : "Other",
      vendor: bill.vendor,
      date: paidOn,
      entity: bill.entity,
      costTreatment: "Exclude from construction margin",
      postedBy: req.user._id,
    })
    await refreshRehabRemaining(bill.propertyId)
    res.json({ bill: presentBill(bill) })
  }),
)

workspaceRouter.get(
  "/loans",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const properties = await Property.find(propertyFilter(req.user)).select("_id address")
    const loans = await Loan.find({ propertyId: { $in: properties.map((property) => property._id) } })
    const names = new Map(properties.map((property) => [String(property._id), property.address]))
    res.json({
      items: loans.map((loan) => ({
        id: String(loan._id),
        propertyId: String(loan.propertyId),
        address: names.get(String(loan.propertyId)) || "",
        lender: loan.lender || "Not provided",
        balance: loan.balance ?? null,
        payment: loan.payment ?? null,
        maturity: loan.maturity || "",
        termsStatus: loan.termsStatus,
        importSource: loan.importSource || null,
      })),
    })
  }),
)

workspaceRouter.get(
  "/construction",
  requirePermission("draws.read"),
  asyncHandler(async (req, res) => {
    const items = await ConstructionProject.find()
    const totals = items.reduce(
      (sum, item) => {
        sum.projected += Number(item.contractAmount || 0) + Number(item.changeOrders || 0) - Number(item.estimatedCost || 0) - Number(item.allocatedOverhead || 0)
        sum.revenue += Number(item.revenueReceived || 0)
        sum.cost += Number(item.estimatedCost || 0)
        return sum
      },
      { projected: 0, revenue: 0, cost: 0 },
    )
    res.json({
      totals: { ...totals, surplus: totals.revenue - totals.cost },
      items: items.map((item) => ({
        id: String(item._id),
        propertyId: item.propertyId ? String(item.propertyId) : "",
        title: item.title,
        status: item.status,
        contractAmount: item.contractAmount ?? null,
        changeOrders: item.changeOrders ?? null,
        estimatedCost: item.estimatedCost ?? null,
        allocatedOverhead: item.allocatedOverhead ?? null,
        revenueReceived: item.revenueReceived ?? 0,
      })),
    })
  }),
)

workspaceRouter.get(
  "/reviews",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const items = await ReviewItem.find({ status: "Open" }).sort({ createdAt: -1 })
    res.json({
      items: items.map((item) => ({
        id: String(item._id),
        title: item.title,
        detail: item.detail || "",
        status: item.status,
        propertyId: item.propertyId ? String(item.propertyId) : "",
        importSource: item.importSource || null,
      })),
    })
  }),
)

workspaceRouter.get(
  "/activity",
  requirePermission("activity.read"),
  asyncHandler(async (req, res) => {
    const items = await Activity.find().sort({ createdAt: -1 }).limit(100)
    res.json({
      items: items.map((item) => ({
        id: String(item._id),
        title: item.title,
        detail: item.detail || "",
        actorName: item.actorName || "",
        propertyId: item.propertyId ? String(item.propertyId) : "",
        createdAt: item.createdAt,
      })),
    })
  }),
)

workspaceRouter.get(
  "/notifications",
  requirePermission("activity.read"),
  asyncHandler(async (req, res) => {
    const [items, mail] = await Promise.all([
      Notification.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(50),
      req.permissions.includes("members.manage") ? MailMessage.find().sort({ createdAt: -1 }).limit(20) : [],
    ])
    res.json({
      unread: items.filter((item) => !item.read).length,
      items: items.map((item) => ({ id: String(item._id), title: item.title, body: item.body, href: item.href || "", read: item.read, createdAt: item.createdAt })),
      mail: mail.map((item) => ({ id: String(item._id), to: item.to, subject: item.subject, status: item.status, createdAt: item.createdAt })),
    })
  }),
)

workspaceRouter.post(
  "/notifications/read",
  requirePermission("activity.read"),
  asyncHandler(async (req, res) => {
    await Notification.updateMany({ userId: req.user._id, read: false }, { read: true })
    res.json({ ok: true })
  }),
)

workspaceRouter.get(
  "/members",
  requirePermission("members.manage"),
  asyncHandler(async (req, res) => {
    const users = await User.find().sort({ name: 1 })
    res.json({ items: users.map(publicUser) })
  }),
)

workspaceRouter.post(
  "/members",
  requirePermission("members.manage"),
  asyncHandler(async (req, res) => {
    const bcrypt = await import("bcryptjs")
    const access = readAccess(req, res)
    if (!access) return
    const name = String(req.body.name || "").trim()
    const email = String(req.body.email || "").trim().toLowerCase()
    const password = String(req.body.password || "")
    if (name.length < 2 || !email.includes("@") || password.length < 8) {
      sendError(res, 400, "Enter a name, email, and a password of at least 8 characters.")
      return
    }
    if (await User.findOne({ email })) {
      sendError(res, 409, "That email is already in the workspace.")
      return
    }
    const user = await User.create({
      name,
      email,
      passwordHash: await bcrypt.default.hash(password, 10),
      role: access.role,
      title: String(req.body.title || "").trim(),
      extraPermissions: access.extraPermissions,
      deniedPermissions: access.deniedPermissions,
    })
    if (access.role === "contractor") await syncAssignments(user, req.body.propertyIds)
    await notify({
      userIds: [user._id],
      title: "You're invited to SynergiFund",
      body: `${req.user.name} created your account. Sign in with ${email} and this password: ${password}. You can change it later in Settings.`,
      href: "/login",
      event: "member.invited",
    })
    await recordActivity({ user: req.user, title: "Member invited", detail: `${user.name} · ${user.role}` })
    res.status(201).json({ user: publicUser(user) })
  }),
)

workspaceRouter.patch(
  "/members/:id",
  requirePermission("members.manage"),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
    if (!user) {
      sendError(res, 404, "That person was not found.")
      return
    }
    const access = readAccess(req, res)
    if (!access) return
    if (String(user._id) === String(req.user._id) && (access.role !== "admin" || access.deniedPermissions.includes(PERMISSIONS.membersManage))) {
      sendError(res, 400, "Keep your own admin access so the workspace still has a manager.")
      return
    }
    if (user.role === "admin" && access.role !== "admin") {
      const others = await User.countDocuments({ role: "admin", _id: { $ne: user._id } })
      if (!others) {
        sendError(res, 400, "Keep at least one admin.")
        return
      }
    }
    user.role = access.role
    user.extraPermissions = access.extraPermissions
    user.deniedPermissions = access.deniedPermissions
    if (typeof req.body.title === "string") user.title = req.body.title.trim()
    await user.save()
    if ("propertyIds" in req.body || access.role !== "contractor") await syncAssignments(user, access.role === "contractor" ? req.body.propertyIds : [])
    await recordActivity({ user: req.user, title: "Member access updated", detail: user.name })
    res.json({ user: publicUser(user) })
  }),
)

workspaceRouter.post(
  "/members/:id/password",
  requirePermission("members.manage"),
  asyncHandler(async (req, res) => {
    const bcrypt = await import("bcryptjs")
    const user = await User.findById(req.params.id)
    const password = String(req.body.password || "")
    if (!user) {
      sendError(res, 404, "That person was not found.")
      return
    }
    if (password.length < 8) {
      sendError(res, 400, "Use a password of at least 8 characters.")
      return
    }
    user.passwordHash = await bcrypt.default.hash(password, 10)
    await user.save()
    await notify({
      userIds: [user._id],
      title: "Your SynergiFund password was reset",
      body: `${req.user.name} set a new password for ${user.email}: ${password}. Sign in with it, then change it in Settings.`,
      href: "/settings",
      event: "member.password",
    })
    await recordActivity({ user: req.user, title: "Member password set", detail: user.name })
    res.json({ user: publicUser(user) })
  }),
)

workspaceRouter.delete(
  "/members/:id",
  requirePermission("members.manage"),
  asyncHandler(async (req, res) => {
    const user = await User.findById(req.params.id)
    if (!user) {
      sendError(res, 404, "That person was not found.")
      return
    }
    if (String(user._id) === String(req.user._id)) {
      sendError(res, 400, "You can't remove your own account.")
      return
    }
    if (user.role === "admin") {
      const others = await User.countDocuments({ role: "admin", _id: { $ne: user._id } })
      if (!others) {
        sendError(res, 400, "Keep at least one admin.")
        return
      }
    }
    await Property.updateMany({ assignedUserIds: user._id }, { $pull: { assignedUserIds: user._id } })
    await user.deleteOne()
    await recordActivity({ user: req.user, title: "Member removed", detail: user.name })
    res.json({ ok: true })
  }),
)

async function syncAssignments(user, propertyIds) {
  const requested = [...new Set((Array.isArray(propertyIds) ? propertyIds : []).map(String).filter(Boolean))]
  const valid = requested.length ? await Property.find({ _id: { $in: requested } }).select("_id") : []
  const keep = valid.map((property) => property._id)
  user.propertyIds = keep
  await user.save()
  await Property.updateMany({ assignedUserIds: user._id }, { $pull: { assignedUserIds: user._id } })
  if (keep.length) await Property.updateMany({ _id: { $in: keep } }, { $addToSet: { assignedUserIds: user._id } })
}

function readAccess(req, res) {
  const role = String(req.body.role || "")
  if (!isRole(role)) {
    sendError(res, 400, "Choose a role.")
    return null
  }
  if (role === "admin") return { role, extraPermissions: [], deniedPermissions: [] }
  const selected = knownPermissions(req.body.permissions || permissionsFor({ role }))
  const actorCan = new Set(req.permissions)
  const blocked = selected.filter((id) => !actorCan.has(id))
  if (blocked.length) {
    sendError(res, 403, "You can only grant access you already have.")
    return null
  }
  return { role, ...permissionOverrides(role, selected) }
}

workspaceRouter.get(
  "/threads",
  requirePermission("agent.ask"),
  asyncHandler(async (req, res) => {
    const items = await AgentThread.find({ userId: req.user._id }).sort({ updatedAt: -1 })
    res.json({
      items: items.map((thread) => ({
        id: String(thread._id),
        title: thread.title || "Conversation",
        messages: thread.messages.map((message) => ({ role: message.role, content: message.content, sources: message.sources || [] })),
      })),
    })
  }),
)

workspaceRouter.post(
  "/threads",
  requirePermission("agent.ask"),
  asyncHandler(async (req, res) => {
    const question = String(req.body.question || "").trim()
    if (!question) {
      sendError(res, 400, "Ask a question about the records you can see.")
      return
    }
    const properties = await Property.find(propertyFilter(req.user))
    const documents = await DocumentFile.find().select("name propertyId")
    const answer = answerQuestion(question, properties, documents)
    const thread = await AgentThread.create({
      userId: req.user._id,
      title: question.slice(0, 80),
      messages: [
        { role: "user", content: question, sources: [] },
        { role: "assistant", content: answer.content, sources: answer.sources },
      ],
    })
    if (can({ role: req.user.role, extraPermissions: req.user.extraPermissions, deniedPermissions: req.user.deniedPermissions }, "internal.pricing") === false && /housebought|assignment/i.test(question)) {
      thread.messages[1].content = "That figure is internal and is not included in this answer."
      thread.messages[1].sources = []
      await thread.save()
    }
    res.status(201).json({
      thread: {
        id: String(thread._id),
        title: thread.title,
        messages: thread.messages,
      },
    })
  }),
)

workspaceRouter.post(
  "/photo-sets",
  requirePermission("photos.write"),
  upload.array("photos", 24),
  asyncHandler(async (req, res) => {
    if (!req.files?.length || !req.body.propertyId || !req.body.weekOf) {
      sendError(res, 400, "Choose a property, a week, and at least one photo.")
      return
    }
    const property = await Property.findOne({ _id: req.body.propertyId, ...propertyFilter(req.user) })
    if (!property) {
      sendError(res, 403, "That property is not assigned to you.")
      return
    }
    const files = []
    for (const file of req.files) {
      files.push(await saveUploadedFile(file, req.user, { propertyId: property._id, kind: "photo" }))
    }
    const set = await PhotoSet.create({
      propertyId: property._id,
      weekOf: req.body.weekOf,
      fileIds: files.map((file) => file._id),
      uploadedBy: req.user._id,
      note: req.body.note || "",
    })
    await recordActivity({ user: req.user, title: "Weekly photos filed", detail: `${property.address} · ${set.weekOf}`, propertyId: property._id })
    res.status(201).json({ id: String(set._id), count: files.length })
  }),
)

workspaceRouter.get(
  "/calendar",
  requirePermission("expenses.read"),
  asyncHandler(async (req, res) => {
    const properties = await Property.find(propertyFilter(req.user)).select("_id address")
    const propertyIds = properties.map((property) => property._id)
    const names = new Map(properties.map((property) => [String(property._id), property.address]))
    const [bills, tasks, expenses, loans] = await Promise.all([
      Bill.find({ $or: [{ propertyId: { $in: propertyIds } }, { propertyId: null }] }),
      Task.find({ done: false, $or: [{ propertyId: { $in: propertyIds } }, { propertyId: null }] }),
      Expense.find({
        costTreatment: { $ne: "Exclude from construction margin" },
        $or: [{ propertyId: { $in: propertyIds } }, { propertyId: null }],
      }),
      Loan.find({ propertyId: { $in: propertyIds } }),
    ])
    const today = todayKey()
    const soon = shiftKey(today, 7)
    const monthOut = shiftKey(today, 30)
    const events = [
      ...bills.filter((bill) => bill.due).map((bill) => {
        const date = dateKey(bill.due)
        const paid = bill.status === "Paid"
        const overdue = !paid && date < today
        const dueSoon = !paid && !overdue && date <= soon
        return {
          id: `bill-${bill._id}`,
          kind: "bill",
          title: bill.title,
          date,
          amount: bill.amount ?? null,
          status: bill.status,
          property: names.get(String(bill.propertyId || "")) || "",
          urgent: overdue || dueSoon,
          tone: overdue ? "bad" : dueSoon ? "warn" : paid ? "good" : "neutral",
          detail: overdue ? "Overdue" : dueSoon ? "Due this week" : paid ? "Paid" : "Scheduled",
        }
      }),
      ...loans.filter((loan) => loan.maturity).map((loan) => {
        const date = dateKey(loan.maturity)
        const passed = date < today
        const dueSoon = !passed && date <= monthOut
        return {
          id: `loan-${loan._id}`,
          kind: "loan",
          title: loan.lender && loan.lender !== "Not provided" ? `${loan.lender} maturity` : "Loan maturity",
          date,
          amount: loan.balance ?? null,
          payment: loan.payment ?? null,
          status: loan.termsStatus || "",
          property: names.get(String(loan.propertyId || "")) || "",
          urgent: passed || dueSoon,
          tone: passed ? "bad" : dueSoon ? "warn" : "neutral",
          detail: passed ? "Maturity passed" : dueSoon ? "Matures within 30 days" : "Maturity",
        }
      }),
      ...tasks.filter((task) => task.due).map((task) => {
        const date = dateKey(task.due)
        const overdue = date < today
        const dueSoon = !overdue && (date <= soon || (task.priority === "High" && date <= shiftKey(today, 3)))
        return {
          id: `task-${task._id}`,
          kind: "task",
          title: task.title,
          date,
          amount: null,
          status: task.priority || "",
          property: names.get(String(task.propertyId || "")) || "",
          urgent: overdue || dueSoon,
          tone: overdue ? "bad" : dueSoon ? "warn" : "neutral",
          detail: overdue ? "Overdue" : dueSoon ? "Due soon" : task.priority || "Task",
        }
      }),
      ...expenses.filter((expense) => expense.date).map((expense) => ({
        id: `expense-${expense._id}`,
        kind: "expense",
        title: expense.title,
        date: dateKey(expense.date),
        amount: expense.amount ?? null,
        status: "Posted",
        property: names.get(String(expense.propertyId || "")) || "",
        urgent: false,
        tone: "neutral",
        detail: "Posted",
      })),
    ].filter((event) => event.date)
    events.sort((left, right) => left.date.localeCompare(right.date) || Number(right.urgent) - Number(left.urgent))
    res.json({ today, events })
  }),
)

workspaceRouter.get(
  "/counts",
  asyncHandler(async (req, res) => {
    const [unread, conversations] = await Promise.all([
      Notification.countDocuments({ userId: req.user._id, read: false }),
      AgentThread.countDocuments({ userId: req.user._id }),
    ])
    res.json({ notifications: unread, conversations })
  }),
)

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function dateKey(value) {
  const text = String(value || "")
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ""
}

function shiftKey(key, days) {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function presentTask(task) {
  return { id: String(task._id), title: task.title, owner: task.owner || "", due: task.due || "", priority: task.priority, labels: task.labels || [], done: task.done, propertyId: task.propertyId ? String(task.propertyId) : "", notes: task.notes || "" }
}

function cleanLabels(value) {
  const list = Array.isArray(value) ? value : String(value || "").split(",")
  const labels = []
  for (const item of list) {
    const label = String(item || "").trim().replace(/\s+/g, " ").slice(0, 32)
    if (!label || labels.some((existing) => existing.toLowerCase() === label.toLowerCase())) continue
    labels.push(label)
    if (labels.length === 8) break
  }
  return labels
}

async function moveOpenReviewsOntoTasks() {
  const open = await ReviewItem.find({ status: "Open" })
  for (const item of open) {
    const already = await Task.findOne({ reviewId: item._id })
    if (!already) {
      await Task.create({
        title: item.title,
        notes: item.detail || "",
        propertyId: item.propertyId,
        labels: ["Verify"],
        priority: "High",
        reviewId: item._id,
      })
    }
    item.status = "Moved"
    await item.save()
  }
}

function presentBill(bill) {
  return { id: String(bill._id), title: bill.title, amount: bill.amount, category: bill.category, entity: bill.entity, due: bill.due || "", status: bill.status, vendor: bill.vendor || "", paidOn: bill.paidOn || "", propertyId: bill.propertyId ? String(bill.propertyId) : "" }
}

function sum(items, key) {
  return items.reduce((total, item) => total + (item[key] == null ? 0 : Number(item[key]) || 0), 0)
}

function countBy(items, labelFor) {
  const counts = new Map()
  for (const item of items) {
    const label = labelFor(item)
    counts.set(label, (counts.get(label) || 0) + 1)
  }
  return [...counts.entries()].sort((left, right) => right[1] - left[1])
}

function drawSchedule(property, budgets, draws) {
  const budget = budgets.find((item) => String(item.propertyId) === String(property._id) && Number(item.budget) > 0)
  if (budget) return Number(budget.budget)
  if (Number(property.rehabBudget) > 0) return Number(property.rehabBudget)
  const lineTotal = draws.filter((draw) => String(draw.propertyId) === String(property._id)).reduce((total, draw) => total + Number(draw.amount || 0), 0)
  return lineTotal > 0 ? lineTotal : null
}

function recentMonths(count) {
  const end = new Date()
  const start = new Date(end.getFullYear(), end.getMonth() - (count - 1), 1)
  const months = []
  const cursor = new Date(start)
  while (cursor <= end) {
    months.push(new Date(cursor))
    cursor.setMonth(cursor.getMonth() + 1)
  }
  return months
}

function monthKey(date) {
  return `${date.getFullYear()}-${date.getMonth()}`
}

function monthLabel(date) {
  return date.toLocaleDateString("en-US", { month: "short" })
}

function asDate(value) {
  if (!value) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

function cumulative(events, months) {
  const points = months.map(() => 0)
  for (const event of events) {
    const at = asDate(event.at)
    if (!at) continue
    const index = months.findIndex((month) => monthKey(month) === monthKey(at))
    if (index >= 0) points[index] += event.amount
    else if (at < months[0]) points[0] += event.amount
  }
  let running = 0
  return points.map((value) => {
    running += value
    return running
  })
}

function lineCard(title, value, hint, note, money, lines) {
  return { title, value, hint: hint, note: `${note}. ${projectionClause(lines, money)}`, money, lines: lines.map((line) => ({ name: line.name, points: line.points })) }
}

function allowedDays(value) {
  const days = Number(value)
  return [30, 60, 90].includes(days) ? days : 30
}

function series(name, events, months, days) {
  const points = cumulative(events, months)
  const added = events.reduce((total, event) => total + (inPastWindow(event.at, days) ? Number(event.amount) || 0 : 0), 0)
  const last = points.length ? points[points.length - 1] : 0
  return { name, points: [...points, last + added], added, days }
}

function projectionClause(lines, money) {
  const days = lines[0]?.days || 30
  const moved = lines.filter((line) => line.added)
  if (!moved.length) return `Nothing dated in the past ${days} days, so the next point stays put.`
  const parts = moved.map((line) => `${line.name} +${money ? currency(line.added) : line.added}`)
  return `Next ${days} days repeats the past ${days} days: ${parts.join(" · ")}.`
}

function futureLabel(days, months) {
  const at = new Date()
  at.setHours(12, 0, 0, 0)
  at.setDate(at.getDate() + days)
  const short = monthLabel(at)
  return months.some((month) => monthLabel(month) === short) ? `${short} ${String(at.getFullYear()).slice(2)}` : short
}

function inPastWindow(value, days) {
  const at = asDay(value)
  if (!at) return false
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  start.setDate(start.getDate() - (days - 1))
  return at >= start && at <= end
}

function inNextWindow(value, days) {
  const at = asDay(value)
  if (!at) return false
  const start = new Date()
  start.setHours(0, 0, 0, 0)
  const end = new Date()
  end.setHours(23, 59, 59, 999)
  end.setDate(end.getDate() + days)
  return at >= start && at <= end
}

function expenseProjection(expenses, bills, days) {
  const totals = new Map()
  for (const expense of expenses) {
    if (!inPastWindow(expense.date || expense.createdAt, days)) continue
    const category = expense.category || "Uncategorized"
    totals.set(category, (totals.get(category) || 0) + Number(expense.amount || 0))
  }
  const categories = [...totals.entries()]
    .map(([category, amount]) => ({ category, amount }))
    .sort((left, right) => right.amount - left.amount)
  const scheduled = bills
    .filter((bill) => bill.status !== "Paid" && inNextWindow(bill.due, days))
    .map((bill) => ({ title: bill.title, amount: Number(bill.amount) || 0, due: bill.due || "", category: bill.category || "" }))
    .sort((left, right) => String(left.due).localeCompare(String(right.due)))
  return {
    days,
    expenses: categories,
    expenseTotal: categories.reduce((total, item) => total + item.amount, 0),
    scheduled,
    scheduledTotal: scheduled.reduce((total, item) => total + item.amount, 0),
  }
}

function asDay(value) {
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) {
    const [year, month, day] = value.slice(0, 10).split("-").map(Number)
    return new Date(year, month - 1, day, 12)
  }
  const date = asDate(value)
  if (!date) return null
  return new Date(date.getFullYear(), date.getMonth(), date.getDate(), 12)
}

function currency(value) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value || 0)
}
