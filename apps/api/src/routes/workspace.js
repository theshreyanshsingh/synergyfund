import { Router } from "express"
import { can, ensureTaskPermissions, isRole, permissionOverrides, permissionsFor, PERMISSIONS } from "@synergifund/shared"
import {
  Activity,
  AgentThread,
  Bill,
  ConstructionProject,
  DocumentFile,
  Draw,
  DrawBudget,
  Expense,
  Lender,
  Loan,
  MailMessage,
  Notification,
  PhotoSet,
  Property,
  ReviewItem,
  Task,
  User,
} from "../models/index.js"
import { asyncHandler, requireAnyPermission, requirePermission, sendError } from "../lib/http.js"
import { publicUser } from "../lib/serialize.js"
import { propertyFilter } from "../services/access.js"
import { refreshRehabRemaining } from "./draws.js"
import { answerQuestion } from "../services/agent.js"
import { saveUploadedFile, upload } from "../services/files.js"
import { ensureLenders, lenderForName, presentLender } from "../services/lenders.js"
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
    const monthlyMortgage = loans.reduce((total, loan) => total + Number(loan.payment || 0), 0)
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
    const periods = days / 30
    const projectedMortgage = monthlyMortgage * periods
    const projectedRent = rent * periods
    cards.push({
      id: "Loans and rent",
      title: "Mortgage payments",
      value: currency(projectedMortgage),
      hint: `Scheduled for the next ${days} days`,
      note: `${currency(projectedRent)} rent on file · ${currency(projectedRent - projectedMortgage)} after scheduled mortgage payments. Only recorded monthly schedules are included.`,
      money: true,
      lines: [
        scheduledSeries("Mortgage", monthlyMortgage, projectedMortgage, months),
        scheduledSeries("Rent", rent, projectedRent, months),
      ],
    })
    cards.push(lineCard("Open work", String(openTasks.length), "Tasks added over the last months", `${verify.length} marked Verify · ${properties.filter((property) => property.purchasePrice == null).length} missing a purchase price`, false, [
      series("Tasks", tasks.map((task) => ({ at: task.createdAt, amount: 1 })), months, days),
      series("Verify", tasks.filter((task) => (task.labels || []).includes("Verify")).map((task) => ({ at: task.createdAt, amount: 1 })), months, days),
    ]))
    const bills = req.permissions.includes("expenses.read")
      ? await Bill.find({ $or: [{ propertyId: { $in: ids } }, { propertyId: null }] })
      : []
    const names = new Map(properties.map((property) => [String(property._id), property.address]))
    res.json({
      days,
      labels,
      attention: attentionItems({ properties, budgets, draws, loans, bills, tasks: openTasks, names }),
      projection: expenseProjection(expenses, bills, days),
      order: cleanOverviewOrder(req.user.overviewOrder),
      cards: cards.map((card) => ({ ...card, labels })),
    })
  }),
)

workspaceRouter.patch(
  "/overview/order",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    const order = cleanOverviewOrder(req.body.order)
    req.user.overviewOrder = order
    await req.user.save()
    res.json({ order })
  }),
)

workspaceRouter.get(
  "/tasks",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    await moveOpenReviewsOntoTasks()
    const properties = await Property.find(propertyFilter(req.user)).select("_id")
    const items = await Task.find({ $or: [{ propertyId: { $in: properties.map((property) => property._id) } }, { propertyId: null }] }).sort({ done: 1, due: 1 })
    const people = await assigneeMap(items)
    const includeEmail = req.permissions.includes(PERMISSIONS.tasksAssign)
    res.json({ items: items.map((task) => presentTask(task, people.get(String(task.assigneeId || "")), includeEmail)) })
  }),
)

workspaceRouter.get(
  "/tasks/assignees",
  requirePermission(PERMISSIONS.tasksAssign),
  asyncHandler(async (req, res) => {
    const users = await User.find().select("name email").sort({ name: 1, email: 1 })
    res.json({ items: users.map((user) => ({ id: String(user._id), name: user.name, email: user.email })) })
  }),
)

workspaceRouter.post(
  "/tasks",
  requirePermission(PERMISSIONS.tasksManage),
  asyncHandler(async (req, res) => {
    if (!req.body.title) {
      sendError(res, 400, "Describe what needs to happen.")
      return
    }
    const assignee = await readAssignee(req, res)
    if (!assignee) return
    const task = await Task.create({
      title: req.body.title,
      propertyId: req.body.propertyId || undefined,
      assigneeId: assignee.assignee?._id,
      owner: assignee.assignee?.name || "",
      due: req.body.due || "",
      priority: req.body.priority || "Medium",
      labels: cleanLabels(req.body.labels),
      notes: req.body.notes || "",
    })
    const mail = await mailAssignee({ user: req.user, task, assignee: assignee.assignee })
    res.status(201).json({ task: presentTask(task, assignee.assignee, true), mail })
  }),
)

workspaceRouter.patch(
  "/tasks/:id",
  requireAnyPermission(PERMISSIONS.tasksEdit, PERMISSIONS.tasksManage, PERMISSIONS.tasksAssign),
  asyncHandler(async (req, res) => {
    const task = await Task.findById(req.params.id)
    if (!task) {
      sendError(res, 404, "That task was not found.")
      return
    }
    const editing = ["title", "due", "priority", "labels", "notes", "done"].some((key) => key in req.body)
    if (editing && !req.permissions.includes(PERMISSIONS.tasksEdit) && !req.permissions.includes(PERMISSIONS.tasksManage)) {
      sendError(res, 403, "You do not have permission to edit tasks.")
      return
    }
    const previousAssignee = String(task.assigneeId || "")
    let assignee = null
    if ("assigneeId" in req.body) {
      const next = await readAssignee(req, res)
      if (!next) return
      assignee = next.assignee
      task.assigneeId = assignee ? assignee._id : null
      task.owner = assignee?.name || ""
    }
    if ("done" in req.body) task.done = Boolean(req.body.done)
    if (req.body.title) task.title = req.body.title
    if ("due" in req.body) task.due = req.body.due || ""
    if (req.body.priority) task.priority = req.body.priority
    if ("labels" in req.body) task.labels = cleanLabels(req.body.labels)
    if ("notes" in req.body) task.notes = req.body.notes || ""
    await task.save()
    const changedAssignee = "assigneeId" in req.body && String(task.assigneeId || "") !== previousAssignee
    const mail = changedAssignee ? await mailAssignee({ user: req.user, task, assignee }) : "Skipped"
    res.json({ task: presentTask(task, assignee, req.permissions.includes(PERMISSIONS.tasksAssign)), mail })
  }),
)

workspaceRouter.delete(
  "/tasks/:id",
  requirePermission(PERMISSIONS.tasksManage),
  asyncHandler(async (req, res) => {
    const task = await Task.findById(req.params.id)
    if (!task) {
      sendError(res, 404, "That task was not found.")
      return
    }
    await task.deleteOne()
    res.json({ ok: true })
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
    await ensureLenders()
    const properties = await Property.find(propertyFilter(req.user)).select("_id address city labels")
    const loans = await Loan.find({ propertyId: { $in: properties.map((property) => property._id) } })
    const names = new Map(properties.map((property) => [String(property._id), property]))
    const lenders = await Lender.find({ _id: { $in: loans.map((loan) => loan.lenderId).filter(Boolean) } })
    res.json({
      items: loans.map((loan) => presentLoan(loan, names, lenders)),
      lenders: lenders.map((lender) => presentLender(lender, loans.filter((loan) => String(loan.lenderId) === String(lender._id)))),
    })
  }),
)

workspaceRouter.get(
  "/lenders/:id",
  requirePermission("properties.read"),
  asyncHandler(async (req, res) => {
    await ensureLenders()
    const lender = await Lender.findById(req.params.id)
    if (!lender) {
      sendError(res, 404, "That lender was not found.")
      return
    }
    const properties = await Property.find(propertyFilter(req.user)).select("_id address city labels")
    const loans = await Loan.find({ lenderId: lender._id, propertyId: { $in: properties.map((property) => property._id) } })
    const names = new Map(properties.map((property) => [String(property._id), property]))
    res.json({
      lender: presentLender(lender, loans),
      loans: loans.map((loan) => presentLoan(loan, names, [lender])),
    })
  }),
)

workspaceRouter.post(
  "/lenders",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const name = String(req.body.name || "").trim()
    if (!name) {
      sendError(res, 400, "Enter the lender name.")
      return
    }
    const existing = await Lender.findOne({ name: new RegExp(`^${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") })
    if (existing) {
      sendError(res, 409, "That lender is already on file. Open it to add a property.")
      return
    }
    const lender = await Lender.create({ name, terms: String(req.body.terms || "") })
    await recordActivity({ user: req.user, title: "Lender saved", detail: lender.name })
    res.status(201).json({ lender: presentLender(lender, []) })
  }),
)

workspaceRouter.patch(
  "/lenders/:id",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const lender = await Lender.findById(req.params.id)
    if (!lender) {
      sendError(res, 404, "That lender was not found.")
      return
    }
    if (req.body.name) lender.name = String(req.body.name).trim()
    if ("terms" in req.body) lender.terms = String(req.body.terms || "")
    await lender.save()
    if (req.body.name) await Loan.updateMany({ lenderId: lender._id }, { lender: lender.name })
    const loans = await Loan.find({ lenderId: lender._id })
    await recordActivity({ user: req.user, title: "Lender updated", detail: lender.name })
    res.json({ lender: presentLender(lender, loans) })
  }),
)

workspaceRouter.post(
  "/loans",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const lender = req.body.lenderId ? await Lender.findById(req.body.lenderId) : await lenderForName(req.body.lender)
    if (!lender) {
      sendError(res, 400, "Choose a lender.")
      return
    }
    if (!req.body.propertyId) {
      sendError(res, 400, "Choose the property this loan is on.")
      return
    }
    const property = await Property.findOne({ _id: req.body.propertyId, ...propertyFilter(req.user) })
    if (!property) {
      sendError(res, 404, "That property is not available.")
      return
    }
    const loan = await Loan.create({
      propertyId: property._id,
      lenderId: lender._id,
      lender: lender.name,
      label: cleanLoanLabel(req.body.label),
      terms: String(req.body.terms || "").trim(),
      loanNumber: String(req.body.loanNumber || "").trim(),
      balance: optionalNumber(req.body.balance),
      payment: optionalNumber(req.body.payment),
      originalAmount: optionalNumber(req.body.originalAmount),
      maturity: String(req.body.maturity || ""),
      termsStatus: req.body.termsStatus === "Verified" ? "Verified" : "Needs verification",
    })
    await recordActivity({ user: req.user, title: "Loan recorded", detail: `${lender.name} · ${property.address}`, propertyId: property._id })
    res.status(201).json({ loan: presentLoan(loan, new Map([[String(property._id), property]]), [lender]) })
  }),
)

workspaceRouter.patch(
  "/loans/:id",
  requirePermission("properties.write"),
  asyncHandler(async (req, res) => {
    const loan = await Loan.findById(req.params.id)
    if (!loan) {
      sendError(res, 404, "That loan was not found.")
      return
    }
    const property = await Property.findOne({ _id: loan.propertyId, ...propertyFilter(req.user) })
    if (!property) {
      sendError(res, 404, "That property is not available.")
      return
    }
    if (req.body.lenderId) {
      const lender = await Lender.findById(req.body.lenderId)
      if (!lender) {
        sendError(res, 404, "That lender was not found.")
        return
      }
      loan.lenderId = lender._id
      loan.lender = lender.name
    }
    if ("label" in req.body) loan.label = cleanLoanLabel(req.body.label)
    if ("terms" in req.body) loan.terms = String(req.body.terms || "").trim()
    if ("loanNumber" in req.body) loan.loanNumber = String(req.body.loanNumber || "").trim()
    if ("balance" in req.body) loan.balance = optionalNumber(req.body.balance)
    if ("payment" in req.body) loan.payment = optionalNumber(req.body.payment)
    if ("originalAmount" in req.body) loan.originalAmount = optionalNumber(req.body.originalAmount)
    if ("maturity" in req.body) loan.maturity = String(req.body.maturity || "")
    if ("termsStatus" in req.body) loan.termsStatus = req.body.termsStatus === "Verified" ? "Verified" : "Needs verification"
    if (req.body.propertyId && String(req.body.propertyId) !== String(loan.propertyId)) {
      const next = await Property.findOne({ _id: req.body.propertyId, ...propertyFilter(req.user) })
      if (!next) {
        sendError(res, 404, "That property is not available.")
        return
      }
      loan.propertyId = next._id
    }
    await loan.save()
    const lender = loan.lenderId ? await Lender.findById(loan.lenderId) : null
    const current = await Property.findById(loan.propertyId).select("address city labels")
    res.json({ loan: presentLoan(loan, new Map([[String(current._id), current]]), lender ? [lender] : []) })
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
    if (user.role === "admin" && !req.permissions.includes(PERMISSIONS.superAdmin)) {
      sendError(res, 403, "Only a super admin can change an admin.")
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
    if (user.role === "admin" && !req.permissions.includes(PERMISSIONS.superAdmin)) {
      sendError(res, 403, "Only a super admin can change an admin.")
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
    if (user.role === "admin" && !req.permissions.includes(PERMISSIONS.superAdmin)) {
      sendError(res, 403, "Only a super admin can change an admin.")
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
  if ((role === "admin" || (req.body.permissions || []).includes(PERMISSIONS.superAdmin)) && !req.permissions.includes(PERMISSIONS.superAdmin)) {
    sendError(res, 403, "Only a super admin can grant that access.")
    return null
  }
  if (role === "admin") return { role, extraPermissions: [], deniedPermissions: [] }
  const selected = ensureTaskPermissions(req.body.permissions || permissionsFor({ role }))
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

function presentLoan(loan, names, lenders = []) {
  const property = names.get(String(loan.propertyId || ""))
  const address = typeof property === "string" ? property : property?.address || ""
  const lender = lenders.find((item) => String(item._id) === String(loan.lenderId || ""))
  return {
    id: String(loan._id),
    propertyId: loan.propertyId ? String(loan.propertyId) : "",
    address,
    city: typeof property === "string" ? "" : property?.city || "",
    propertyLabels: typeof property === "string" ? [] : property?.labels || [],
    lenderId: loan.lenderId ? String(loan.lenderId) : "",
    lender: lender?.name || loan.lender || "Not provided",
    lenderTerms: lender?.terms || "",
    label: loan.label || "Financed",
    terms: loan.terms || "",
    loanNumber: loan.loanNumber || "",
    balance: loan.balance ?? null,
    payment: loan.payment ?? null,
    originalAmount: loan.originalAmount ?? null,
    maturity: loan.maturity || "",
    termsStatus: loan.termsStatus,
    importSource: loan.importSource || null,
  }
}

function cleanLoanLabel(value) {
  const label = String(value || "").trim().replace(/\s+/g, " ").slice(0, 40)
  return label || "Financed"
}

function optionalNumber(value) {
  if (value === "" || value == null) return undefined
  const number = Number(value)
  return Number.isFinite(number) ? number : undefined
}

function presentTask(task, person, includeEmail) {
  return {
    id: String(task._id),
    title: task.title,
    owner: person?.name || task.owner || "",
    assigneeId: task.assigneeId ? String(task.assigneeId) : "",
    assigneeName: person?.name || task.owner || "",
    assigneeEmail: includeEmail ? person?.email || "" : "",
    due: task.due || "",
    priority: task.priority,
    labels: task.labels || [],
    done: task.done,
    propertyId: task.propertyId ? String(task.propertyId) : "",
    notes: task.notes || "",
  }
}

async function assigneeMap(tasks) {
  const ids = [...new Set(tasks.map((task) => task.assigneeId).filter(Boolean).map(String))]
  if (!ids.length) return new Map()
  const people = await User.find({ _id: { $in: ids } }).select("name email")
  return new Map(people.map((person) => [String(person._id), person]))
}

async function readAssignee(req, res) {
  if (!("assigneeId" in req.body)) return { assignee: null }
  if (!req.permissions.includes(PERMISSIONS.tasksAssign)) {
    sendError(res, 403, "You do not have permission to assign tasks.")
    return null
  }
  const value = String(req.body.assigneeId || "").trim()
  if (!value) return { assignee: null }
  if (!/^[a-f\d]{24}$/i.test(value)) {
    sendError(res, 400, "Choose an assignee from the list.")
    return null
  }
  const assignee = await User.findById(value).select("name email")
  if (!assignee) {
    sendError(res, 400, "Choose an assignee from the list.")
    return null
  }
  return { assignee }
}

async function mailAssignee({ user, task, assignee }) {
  if (!assignee) return { status: "Skipped" }
  if (!assignee.email) return { status: "Failed", error: "The assignee has no email address." }
  const due = task.due ? ` Due ${task.due}.` : ""
  const labels = task.labels?.length ? ` Labels: ${task.labels.join(", ")}.` : ""
  const notes = task.notes ? ` Note: ${task.notes}` : ""
  return notify({
    userIds: [assignee._id],
    title: `Task assigned: ${task.title}`,
    body: `${user.name} assigned you “${task.title}”.${due}${labels}${notes}`,
    href: "/tasks",
    event: "task.assigned",
  })
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

function attentionItems({ properties, budgets, draws, loans, bills, tasks, names }) {
  const today = todayKey()
  const week = shiftKey(today, 7)
  const twoWeeks = shiftKey(today, 14)
  const month = shiftKey(today, 30)
  const items = []
  for (const draw of draws) {
    const requested = dateKey(draw.requestedDate)
    if (draw.status === "Funded" || !requested) continue
    const arrive = addBusinessDays(requested, 4)
    if (arrive > month) continue
    items.push({
      id: `draw-${draw._id}`,
      kind: "Draw",
      title: draw.title,
      property: names.get(String(draw.propertyId || "")) || "",
      date: arrive,
      amount: draw.amount ?? null,
      tone: arrive < today ? "bad" : "warn",
      detail: arrive < today ? "Funding window has started" : "Funding window opens in 4 business days",
      href: "/draws",
    })
  }
  for (const property of properties) {
    const budget = budgets.find((item) => String(item.propertyId) === String(property._id) && Number(item.budget) > 0)
    if (!budget) continue
    const scheduled = Number(budget.budget)
    const propertyDraws = draws.filter((draw) => String(draw.propertyId) === String(property._id))
    const funded = propertyDraws
      .filter((draw) => draw.status === "Funded")
      .reduce((total, draw) => total + Number(draw.fundedAmount ?? draw.amount ?? 0), 0)
    const remaining = Math.max(0, scheduled - funded)
    const alreadyRequested = propertyDraws.some((draw) => draw.status !== "Funded")
    if (remaining <= 0 || alreadyRequested) continue
    items.push({
      id: `undrawn-${property._id}`,
      kind: "Draw",
      title: "Draw remaining to schedule",
      property: names.get(String(property._id)) || "",
      date: "",
      amount: remaining,
      tone: "warn",
      detail: budget.approvalStatus === "Not confirmed"
        ? "Draw budget needs confirmation and scheduling"
        : "Still undrawn · schedule the next draw",
      href: "/draws",
    })
  }
  for (const loan of loans) {
    if (!(Number(loan.payment) > 0)) continue
    const hasDatedBill = bills.some((bill) => {
      const mortgage = bill.category === "Mortgage" || /mortgage/i.test(bill.title || "")
      const due = dateKey(bill.due)
      return mortgage && bill.status !== "Paid" && due && due <= month && String(bill.propertyId || "") === String(loan.propertyId || "")
    })
    if (hasDatedBill) continue
    items.push({
      id: `loan-payment-${loan._id}`,
      kind: "Mortgage",
      title: loan.lender && loan.lender !== "Not provided" ? `${loan.lender} payment` : "Monthly mortgage payment",
      property: names.get(String(loan.propertyId || "")) || "",
      date: "",
      amount: loan.payment,
      tone: "warn",
      detail: "Due within 30 days · payment date not recorded",
      href: "/loans",
    })
  }
  for (const bill of bills) {
    const due = dateKey(bill.due)
    const mortgage = bill.category === "Mortgage" || /mortgage/i.test(bill.title || "")
    if (!mortgage || bill.status === "Paid" || !due) continue
    if (due > month) continue
    items.push({
      id: `bill-${bill._id}`,
      kind: "Mortgage",
      title: bill.title,
      property: names.get(String(bill.propertyId || "")) || "",
      date: due,
      amount: bill.amount ?? null,
      tone: due < today ? "bad" : "warn",
      detail: due < today ? "Payment overdue" : "Payment due",
      href: "/payments",
    })
  }
  for (const task of tasks) {
    const due = dateKey(task.due)
    if (!due) continue
    const marked = task.priority === "High" || (task.labels || []).includes("Verify")
    const overdue = due < today
    if (!overdue && due > (marked ? twoWeeks : week)) continue
    items.push({
      id: `task-${task._id}`,
      kind: (task.labels || []).includes("Verify") ? "Verify" : "Task",
      title: task.title,
      property: names.get(String(task.propertyId || "")) || "",
      date: due,
      amount: null,
      tone: overdue ? "bad" : "warn",
      detail: overdue ? "Overdue" : "Due soon",
      href: "/tasks",
    })
  }
  items.sort((left, right) => {
    const late = (item) => item.date && item.date < today ? 0 : 1
    const undated = (item) => item.date ? 0 : 1
    return late(left) - late(right) || undated(left) - undated(right) || left.date.localeCompare(right.date)
  })
  return items
}

function addBusinessDays(key, count) {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(year, month - 1, day, 12)
  let added = 0
  while (added < count) {
    date.setDate(date.getDate() + 1)
    const weekday = date.getDay()
    if (weekday !== 0 && weekday !== 6) added += 1
  }
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
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

const OVERVIEW_CARDS = ["Portfolio", "Recorded value", "Draws", "Rehab", "Loans and rent", "Open work"]

function cleanOverviewOrder(value) {
  const order = []
  for (const id of Array.isArray(value) ? value : []) {
    const title = String(id || "")
    if (!OVERVIEW_CARDS.includes(title) || order.includes(title)) continue
    order.push(title)
  }
  return order
}

function lineCard(title, value, hint, note, money, lines) {
  return { id: title, title, value, hint: hint, note: `${note}. ${projectionClause(lines, money)}`, money, lines: lines.map((line) => ({ name: line.name, points: line.points })) }
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

function scheduledSeries(name, monthly, projected, months) {
  const points = months.map(() => 0)
  if (points.length) points[points.length - 1] = monthly
  return { name, points: [...points, projected] }
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
