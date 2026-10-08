import { PERMISSIONS } from "@synergifund/shared"
import { Bill, DocumentFile, Draw, DrawBudget, Expense, ExpenseRequest, Lender, Loan, Property, Task, User } from "../../models/index.js"
import { presentProperty } from "../../lib/serialize.js"
import { propertyFilter } from "../access.js"
import { presentContractorDraw, presentDraw } from "../../routes/draws.js"
import { matchScore, rank } from "./match.js"
import { loanPaymentDates } from "../schedule.js"

const MODEL_RESULT_LIMIT = 12000
const OPEN_REQUEST_STATUSES = ["Submitted", "Needs information", "Needs second approval"]
const PAYMENT_TASK_LABELS = ["EMD", "Mortgage payment", "Insurance", "Taxes", "Closing", "Draw"]
const FIRECRAWL_URL = "https://api.firecrawl.dev/v2"
const FIRECRAWL_CACHE_MS = 60 * 60 * 1000
const PROPERTY_MATCH = 0.85
const SEARCH_MATCH = 0.82
const RECENCY = { day: "qdr:d", week: "qdr:w", month: "qdr:m", year: "qdr:y" }

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function todayKey() {
  const now = new Date()
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`
}

function shiftKey(key, days) {
  const [year, month, day] = key.split("-").map(Number)
  const date = new Date(year, month - 1, day)
  date.setDate(date.getDate() + days)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function dateKey(value) {
  const text = String(value || "")
  return /^\d{4}-\d{2}-\d{2}/.test(text) ? text.slice(0, 10) : ""
}

function clampLimit(value, fallback, max) {
  const number = Number(value)
  if (!Number.isFinite(number) || number <= 0) return fallback
  return Math.min(Math.floor(number), max)
}

function plural(count, word, many = `${word}s`) {
  return `${count} ${count === 1 ? word : many}`
}

function sum(items, read) {
  return items.reduce((total, item) => total + (Number(read(item)) || 0), 0)
}

async function scopedProperties(context) {
  if (!context.cache.properties) context.cache.properties = await Property.find(propertyFilter(context.user)).sort({ address: 1 })
  return context.cache.properties
}

function compactProperty(property, user) {
  const view = presentProperty(property, user)
  delete view.importSource
  delete view.assignedUserIds
  delete view.updatedBy
  if (Array.isArray(view.scopeLines)) {
    view.scopeLines = view.scopeLines.map((line) => ({ title: line.title, budget: line.budget ?? null, status: line.status || "Not started" }))
  }
  return view
}

async function findProperty(context, reference) {
  const properties = await scopedProperties(context)
  const text = String(reference || "").trim()
  if (!text) return { matches: [] }
  const byId = properties.find((property) => String(property._id) === text)
  if (byId) return { property: byId }
  const needle = text.toLowerCase()
  const exact = properties.filter((property) => property.address.toLowerCase() === needle)
  if (exact.length === 1) return { property: exact[0] }
  const words = needle.split(/\s+/).filter(Boolean)
  const matches = properties.filter((property) => {
    const haystack = `${property.address} ${property.city || ""}`.toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
  if (matches.length === 1) return { property: matches[0] }
  if (matches.length) return { matches }
  const fuzzy = rank(properties, text, (property) => `${property.address} ${property.city || ""}`, PROPERTY_MATCH)
  if (fuzzy.length === 1 || (fuzzy.length > 1 && fuzzy[0].score - fuzzy[1].score >= 0.05)) return { property: fuzzy[0].item, corrected: true }
  return { matches: fuzzy.map((entry) => entry.item) }
}

function notFound(reference, matches) {
  if (!matches.length) return { success: false, error: `No property you can see matches "${reference}".` }
  return {
    success: false,
    error: `"${reference}" matches ${matches.length} properties. Ask again with one of these addresses.`,
    candidates: matches.slice(0, 10).map((property) => ({ id: String(property._id), address: property.address, city: property.city || "" })),
  }
}

function presentLoanRow(loan, names, lenders) {
  const lender = lenders.find((item) => String(item._id) === String(loan.lenderId || ""))
  return {
    id: String(loan._id),
    property: names.get(String(loan.propertyId || "")) || "",
    lender: lender?.name || loan.lender || "Not provided",
    label: loan.label || "Financed",
    loanNumber: loan.loanNumber || "",
    balance: loan.balance ?? null,
    monthlyPayment: loan.payment ?? null,
    paymentDayOfMonth: loan.paymentDay ?? null,
    originalAmount: loan.originalAmount ?? null,
    maturity: loan.maturity || "",
    termsStatus: loan.termsStatus || "",
    terms: loan.terms || "",
    lenderTerms: lender?.terms || "",
  }
}

function drawView(context, draw) {
  return context.user.role === "contractor" ? presentContractorDraw(draw) : presentDraw(draw)
}

function drawSummary(context, property, budgets, draws) {
  const rows = draws.map((draw) => drawView(context, draw))
  const budget = budgets.find((item) => String(item.propertyId) === String(property._id))
  const scheduled = sum(rows, (row) => row.amount)
  const received = sum(rows, (row) => row.pulled)
  const total = property.rehabBudget ?? budget?.budget ?? null
  return {
    property: property.address,
    rehabBudget: total,
    lenderFundingLimit: budget?.fundingLimit ?? null,
    scheduled,
    received,
    remainingToDraw: total == null ? null : Math.max(0, Number(total) - scheduled),
    draws: rows.map((row) => ({
      title: row.title,
      status: row.status,
      amount: row.amount,
      received: row.pulled,
      remaining: row.remaining,
      forecastDate: row.requestedDate || "",
      fundedDate: row.fundedDate || "",
    })),
  }
}

async function firecrawl(path, body) {
  const key = String(process.env.FIRECRAWL_API_KEY || "").trim()
  if (!key) return { success: false, error: "Web search is not connected. Add FIRECRAWL_API_KEY to the server .env file." }
  let last = null
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 75000)
    try {
      const response = await fetch(`${(process.env.FIRECRAWL_BASE_URL || FIRECRAWL_URL).replace(/\/+$/, "")}${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      })
      const data = await response.json().catch(() => ({}))
      if (response.ok && data.success !== false) return { success: true, data: data.data }
      last = { success: false, error: data.error || `Firecrawl answered ${response.status}.` }
      if (response.status !== 429 && response.status < 500) return last
    } catch (error) {
      last = { success: false, error: error.name === "AbortError" ? "The web request timed out." : error.message }
    } finally {
      clearTimeout(timer)
    }
    if (attempt < 2) await new Promise((resolve) => setTimeout(resolve, 1500))
  }
  return last
}

function cleanMarkdown(text, limit) {
  return String(text || "")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]*)\]\((?:javascript|data):[^)]*\)/g, "$1")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, limit)
}

function cleanDomains(value) {
  const list = Array.isArray(value) ? value : value ? [value] : []
  return [...new Set(list.map((item) => String(item).trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "")).filter((item) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(item)))].slice(0, 6)
}

function webAllowed(context) {
  return Boolean(String(process.env.FIRECRAWL_API_KEY || "").trim())
}

export const TOOLS = [
  {
    name: "todo_write",
    label: "Planning Next Moves",
    description: "Write or update your step-by-step plan for this question. Send the whole list each time with each step's status. Use it before gathering data when the question needs more than one lookup, and mark steps completed as you finish them.",
    parameters: {
      type: "object",
      properties: {
        todos: {
          type: "array",
          items: {
            type: "object",
            properties: {
              id: { type: "string", description: "Short stable id such as \"1\"." },
              content: { type: "string", description: "What this step finds out." },
              status: { type: "string", enum: ["pending", "in_progress", "completed", "cancelled"] },
            },
            required: ["content", "status"],
          },
        },
      },
      required: ["todos"],
    },
    run: async (args, context) => {
      const incoming = Array.isArray(args.todos) ? args.todos : []
      for (const [index, item] of incoming.entries()) {
        const content = String(item?.content || "").trim()
        if (!content) continue
        const status = ["pending", "in_progress", "completed", "cancelled"].includes(item.status) ? item.status : "pending"
        const existing = context.todos.find((todo) => (item.id && todo.id === String(item.id)) || todo.content.toLowerCase() === content.toLowerCase())
        if (existing) {
          existing.content = content
          existing.status = status
        } else {
          context.todos.push({ id: String(item.id || context.todos.length + index + 1), content, status })
        }
      }
      return todoResult(context.todos)
    },
  },
  {
    name: "portfolio_summary",
    label: "Reading the portfolio",
    permission: PERMISSIONS.propertiesRead,
    description: "Totals for every property the person can see: count by status and goal, purchase and ARV totals, rehab budgets, rent on file, monthly mortgage payments, and draw cash received when allowed.",
    parameters: { type: "object", properties: {} },
    run: async (args, context) => {
      const properties = await scopedProperties(context)
      const ids = properties.map((property) => property._id)
      const countBy = (read) => properties.reduce((map, property) => {
        const key = read(property) || "Not set"
        map[key] = (map[key] || 0) + 1
        return map
      }, {})
      const result = {
        success: true,
        properties: properties.length,
        byStatus: countBy((property) => property.stage),
        byGoal: context.user.role === "contractor" ? undefined : countBy((property) => property.strategy),
      }
      if (context.user.role !== "contractor") {
        const loans = await Loan.find({ propertyId: { $in: ids } })
        Object.assign(result, {
          purchaseTotal: sum(properties, (property) => property.purchasePrice),
          arvTotal: sum(properties, (property) => property.arv),
          rehabBudgetTotal: sum(properties, (property) => property.rehabBudget),
          actualRentMonthly: sum(properties, (property) => property.actualRent),
          marketRentMonthly: sum(properties, (property) => property.marketRent),
          loanBalanceTotal: sum(loans, (loan) => loan.balance),
          monthlyMortgageTotal: sum(loans, (loan) => loan.payment),
          missingPurchasePrice: properties.filter((property) => property.purchasePrice == null).map((property) => property.address),
          missingArv: properties.filter((property) => property.arv == null).map((property) => property.address),
        })
      }
      if (context.permissions.includes(PERMISSIONS.drawsRead) && context.user.role !== "contractor") {
        const draws = await Draw.find({ propertyId: { $in: ids } })
        result.drawCashReceived = sum(draws.map(presentDraw), (row) => row.pulled)
        result.drawsScheduled = sum(draws.map(presentDraw), (row) => row.amount)
      }
      return result
    },
    summarize: (result) => ({ title: `${result.properties} properties` }),
  },
  {
    name: "list_properties",
    label: "Reading properties",
    permission: PERMISSIONS.propertiesRead,
    description: "List properties the person can see, optionally filtered. Returns address, city, status, goal, purchase price, ARV, rehab budget and remaining, rent figures and next step.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words that must appear in the address or city." },
        status: { type: "string", description: "Status such as Renovation, For rent, Rented, For sale, Sold, Under contract." },
        goal: { type: "string", description: "Goal or strategy such as Fix & flip, Buy & hold, Refinance." },
        city: { type: "string" },
        limit: { type: "number", description: "Most rows to return, up to 100." },
      },
    },
    run: async (args, context) => {
      let properties = await scopedProperties(context)
      const fits = (value, needle) => matchScore(needle, value) >= PROPERTY_MATCH
      if (args.query) properties = properties.filter((property) => fits(`${property.address} ${property.city}`, args.query))
      if (args.status) properties = properties.filter((property) => fits(property.stage, args.status))
      if (args.goal) properties = properties.filter((property) => fits(property.strategy, args.goal))
      if (args.city) properties = properties.filter((property) => fits(property.city, args.city))
      const limit = clampLimit(args.limit, 50, 100)
      return {
        success: true,
        total: properties.length,
        returned: Math.min(limit, properties.length),
        properties: properties.slice(0, limit).map((property) => {
          const view = compactProperty(property, context.user)
          delete view.scopeLines
          delete view.accessInfo
          return view
        }),
      }
    },
    summarize: (result) => ({ title: `${result.total} ${result.total === 1 ? "property" : "properties"}` }),
  },
  {
    name: "get_property",
    label: "Opening the property",
    permission: PERMISSIONS.propertiesRead,
    description: "Everything on file for one property: deal figures, scope, loans, draw schedule, expenses, upcoming bills, open tasks and documents, limited to what the person may see.",
    parameters: {
      type: "object",
      properties: { property: { type: "string", description: "The property id or address, as written by the person." } },
      required: ["property"],
    },
    run: async (args, context) => {
      const found = await findProperty(context, args.property)
      if (!found.property) return notFound(args.property, found.matches)
      const property = found.property
      const result = { success: true, property: compactProperty(property, context.user) }
      if (found.corrected) result.note = `"${args.property}" was read as ${property.address}.`
      const allowed = (permission) => context.permissions.includes(permission)
      if (context.user.role !== "contractor") {
        const loans = await Loan.find({ propertyId: property._id })
        const lenders = await Lender.find({ _id: { $in: loans.map((loan) => loan.lenderId).filter(Boolean) } })
        result.loans = loans.map((loan) => presentLoanRow(loan, new Map([[String(property._id), property.address]]), lenders))
      }
      if (allowed(PERMISSIONS.drawsRead)) {
        const [budgets, draws] = await Promise.all([DrawBudget.find({ propertyId: property._id }), Draw.find({ propertyId: property._id }).sort({ createdAt: 1 })])
        result.draws = drawSummary(context, property, budgets, draws)
      }
      if (allowed(PERMISSIONS.expensesRead) && context.user.role !== "contractor") {
        const [expenses, requests, bills] = await Promise.all([
          Expense.find({ propertyId: property._id }).sort({ date: -1 }),
          ExpenseRequest.find({ propertyId: property._id, status: { $in: OPEN_REQUEST_STATUSES } }),
          Bill.find({ propertyId: property._id, status: { $ne: "Paid" } }).sort({ due: 1 }),
        ])
        result.expenses = {
          postedTotal: sum(expenses, (item) => item.amount),
          postedCount: expenses.length,
          recent: expenses.slice(0, 10).map((item) => ({ title: item.title, amount: item.amount, category: item.category, vendor: item.vendor || "", date: item.date || "" })),
          waitingForApproval: requests.map((item) => ({ title: item.title, amount: item.amount, status: item.status })),
        }
        result.unpaidBills = bills.map((bill) => ({ title: bill.title, amount: bill.amount ?? null, due: bill.due || "", recurrence: bill.recurrence, category: bill.category }))
      }
      const tasks = await Task.find({ propertyId: property._id, done: false }).sort({ due: 1 })
      result.openTasks = tasks.map((task) => ({ title: task.title, due: task.due || "", priority: task.priority, labels: task.labels || [] }))
      if (allowed(PERMISSIONS.documentsRead)) {
        const files = await DocumentFile.find({ propertyId: property._id }).sort({ createdAt: -1 }).limit(20)
        result.documents = files.map((file) => ({ name: file.name, kind: file.kind, added: dateKey(file.createdAt?.toISOString?.()) }))
      }
      return result
    },
    summarize: (result) => ({ title: result.property?.address || "Property" }),
  },
  {
    name: "list_loans",
    label: "Reading loans",
    permission: PERMISSIONS.propertiesRead,
    staffOnly: true,
    description: "Loans on the properties the person can see: lender, balance, monthly payment, maturity, terms and whether the terms are verified.",
    parameters: {
      type: "object",
      properties: {
        lender: { type: "string", description: "Only loans from a lender whose name contains this." },
        property: { type: "string", description: "Only loans on a property whose address contains this." },
      },
    },
    run: async (args, context) => {
      const properties = await scopedProperties(context)
      const names = new Map(properties.map((property) => [String(property._id), property.address]))
      const loans = await Loan.find({ propertyId: { $in: properties.map((property) => property._id) } })
      const lenders = await Lender.find({ _id: { $in: loans.map((loan) => loan.lenderId).filter(Boolean) } })
      let rows = loans.map((loan) => presentLoanRow(loan, names, lenders))
      if (args.lender) rows = rows.filter((row) => row.lender.toLowerCase().includes(String(args.lender).toLowerCase()))
      if (args.property) rows = rows.filter((row) => row.property.toLowerCase().includes(String(args.property).toLowerCase()))
      return {
        success: true,
        total: rows.length,
        balanceTotal: sum(rows, (row) => row.balance),
        monthlyPaymentTotal: sum(rows, (row) => row.monthlyPayment),
        loans: rows,
      }
    },
    summarize: (result) => ({ title: `${result.total} ${result.total === 1 ? "loan" : "loans"}` }),
  },
  {
    name: "list_lenders",
    label: "Reading lenders",
    permission: PERMISSIONS.propertiesRead,
    staffOnly: true,
    description: "Lenders that finance the properties the person can see, with each lender's terms, number of properties, total balance and monthly payments.",
    parameters: { type: "object", properties: {} },
    run: async (args, context) => {
      const properties = await scopedProperties(context)
      const names = new Map(properties.map((property) => [String(property._id), property.address]))
      const loans = await Loan.find({ propertyId: { $in: properties.map((property) => property._id) } })
      const lenders = await Lender.find({ _id: { $in: loans.map((loan) => loan.lenderId).filter(Boolean) } })
      return {
        success: true,
        total: lenders.length,
        lenders: lenders.map((lender) => {
          const own = loans.filter((loan) => String(loan.lenderId) === String(lender._id))
          return {
            name: lender.name,
            terms: lender.terms || "",
            properties: own.map((loan) => names.get(String(loan.propertyId)) || ""),
            balanceTotal: sum(own, (loan) => loan.balance),
            monthlyPaymentTotal: sum(own, (loan) => loan.payment),
          }
        }),
      }
    },
    summarize: (result) => ({ title: `${result.total} ${result.total === 1 ? "lender" : "lenders"}` }),
  },
  {
    name: "list_draws",
    label: "Reading draws",
    permission: PERMISSIONS.drawsRead,
    description: "Rehab draw schedules: for each property the budget, each draw's amount, cash received, remaining, forecast and funded dates.",
    parameters: {
      type: "object",
      properties: {
        property: { type: "string", description: "Only this property (id or address)." },
        status: { type: "string", description: "Only draws with this status, such as Funded or Requested." },
      },
    },
    run: async (args, context) => {
      let properties = await scopedProperties(context)
      if (args.property) {
        const found = await findProperty(context, args.property)
        if (!found.property) return notFound(args.property, found.matches)
        properties = [found.property]
      }
      const ids = properties.map((property) => property._id)
      const [budgets, draws] = await Promise.all([DrawBudget.find({ propertyId: { $in: ids } }), Draw.find({ propertyId: { $in: ids } }).sort({ createdAt: 1 })])
      let rows = properties.map((property) => drawSummary(context, property, budgets, draws.filter((draw) => String(draw.propertyId) === String(property._id))))
      if (args.status) {
        const wanted = String(args.status).toLowerCase()
        rows = rows.map((row) => ({ ...row, draws: row.draws.filter((draw) => String(draw.status).toLowerCase() === wanted) }))
      }
      rows = rows.filter((row) => row.draws.length || row.rehabBudget != null)
      return {
        success: true,
        properties: rows.length,
        scheduledTotal: sum(rows, (row) => row.scheduled),
        receivedTotal: sum(rows, (row) => row.received),
        schedules: rows,
      }
    },
    summarize: (result) => ({ title: `${result.properties} draw ${result.properties === 1 ? "schedule" : "schedules"}` }),
  },
  {
    name: "upcoming_payments",
    label: "Checking upcoming payments",
    permission: PERMISSIONS.expensesRead,
    staffOnly: true,
    description: "Money due in the next N days (default 30): unpaid bills including overdue ones, monthly mortgage payments with their due dates when a payment day is on file, loan maturities, open draws with a forecast date, and payment tasks such as EMD, insurance or taxes.",
    parameters: {
      type: "object",
      properties: { days: { type: "number", description: "How many days ahead to look, 1 to 365." } },
    },
    run: async (args, context) => {
      const days = clampLimit(args.days, 30, 365)
      const today = todayKey()
      const until = shiftKey(today, days)
      const properties = await scopedProperties(context)
      const ids = properties.map((property) => property._id)
      const names = new Map(properties.map((property) => [String(property._id), property.address]))
      const place = (id) => names.get(String(id || "")) || "Company-wide"
      const [bills, loans, tasks] = await Promise.all([
        Bill.find({ status: { $ne: "Paid" }, $or: [{ propertyId: { $in: ids } }, { propertyId: null }] }),
        Loan.find({ propertyId: { $in: ids } }),
        Task.find({ done: false, labels: { $in: PAYMENT_TASK_LABELS }, $or: [{ propertyId: { $in: ids } }, { propertyId: null }] }),
      ])
      const dueBills = bills
        .filter((bill) => dateKey(bill.due) && dateKey(bill.due) <= until)
        .map((bill) => ({ title: bill.title, property: place(bill.propertyId), amount: bill.amount ?? null, due: dateKey(bill.due), overdue: dateKey(bill.due) < today, recurrence: bill.recurrence }))
        .sort((left, right) => left.due.localeCompare(right.due))
      const mortgages = loans.filter((loan) => loan.payment).map((loan) => ({
        property: place(loan.propertyId),
        lender: loan.lender || "Not provided",
        monthlyPayment: loan.payment,
        paymentDay: loan.paymentDay ?? null,
        dueDates: loanPaymentDates(loan, today, until),
      }))
      const maturities = loans
        .filter((loan) => dateKey(loan.maturity) && dateKey(loan.maturity) <= until)
        .map((loan) => ({ property: place(loan.propertyId), lender: loan.lender || "Not provided", maturity: dateKey(loan.maturity), balance: loan.balance ?? null, passed: dateKey(loan.maturity) < today }))
      const result = {
        success: true,
        today,
        through: until,
        bills: dueBills,
        billsTotal: sum(dueBills, (bill) => bill.amount),
        monthlyMortgages: mortgages,
        monthlyMortgageTotal: sum(mortgages, (row) => row.monthlyPayment),
        loanMaturities: maturities,
        paymentTasks: tasks
          .filter((task) => dateKey(task.due) && dateKey(task.due) <= until)
          .map((task) => ({ title: task.title, property: place(task.propertyId), due: dateKey(task.due), labels: task.labels || [] })),
      }
      if (context.permissions.includes(PERMISSIONS.drawsRead)) {
        const draws = await Draw.find({ propertyId: { $in: ids }, status: { $ne: "Funded" } })
        result.forecastDraws = draws
          .map((draw) => presentDraw(draw))
          .filter((draw) => dateKey(draw.requestedDate) && dateKey(draw.requestedDate) <= until)
          .map((draw) => ({ property: place(draw.propertyId), title: draw.title, amount: draw.amount, remaining: draw.remaining, forecastDate: draw.requestedDate }))
      }
      return result
    },
    summarize: (result) => ({ title: `${plural(result.bills.length, "bill")} and ${plural(result.monthlyMortgages.length, "mortgage")} through ${result.through}` }),
  },
  {
    name: "list_expenses",
    label: "Reading expenses",
    permission: PERMISSIONS.expensesRead,
    description: "Posted costs and expense requests waiting for a decision, optionally for one property. Includes totals by category.",
    parameters: {
      type: "object",
      properties: {
        property: { type: "string", description: "Only this property (id or address)." },
        limit: { type: "number", description: "Most recent rows to return, up to 100." },
      },
    },
    run: async (args, context) => {
      let properties = await scopedProperties(context)
      if (args.property) {
        const found = await findProperty(context, args.property)
        if (!found.property) return notFound(args.property, found.matches)
        properties = [found.property]
      }
      const names = new Map(properties.map((property) => [String(property._id), property.address]))
      const contractor = context.user.role === "contractor"
      const scope = contractor || args.property ? { propertyId: { $in: properties.map((property) => property._id) } } : {}
      const requestScope = contractor ? { ...scope, requestedBy: context.user._id } : scope
      const requests = await ExpenseRequest.find(requestScope).sort({ createdAt: -1 })
      const expenses = await Expense.find(contractor ? { ...scope, requestId: { $in: requests.map((item) => item._id) } } : scope).sort({ date: -1 })
      const limit = clampLimit(args.limit, 40, 100)
      const byCategory = expenses.reduce((map, item) => {
        map[item.category || "Other"] = (map[item.category || "Other"] || 0) + (Number(item.amount) || 0)
        return map
      }, {})
      return {
        success: true,
        postedTotal: sum(expenses, (item) => item.amount),
        postedCount: expenses.length,
        byCategory,
        posted: expenses.slice(0, limit).map((item) => ({ title: item.title, amount: item.amount, category: item.category, vendor: item.vendor || "", date: item.date || "", property: names.get(String(item.propertyId || "")) || "Company-wide", entity: item.entity || "" })),
        waitingForDecision: requests
          .filter((item) => OPEN_REQUEST_STATUSES.includes(item.status))
          .map((item) => ({ title: item.title, amount: item.amount, status: item.status, property: names.get(String(item.propertyId || "")) || "Company-wide" })),
      }
    },
    summarize: (result) => ({ title: plural(result.postedCount, "posted cost") }),
  },
  {
    name: "list_tasks",
    label: "Reading the to-do list",
    permission: PERMISSIONS.propertiesRead,
    staffOnly: true,
    description: "Open tasks on the to-do list with due date, priority, labels, property and assignee.",
    parameters: {
      type: "object",
      properties: {
        property: { type: "string", description: "Only tasks on this property (id or address)." },
        label: { type: "string", description: "Only tasks with this label, such as EMD, Draw, Verify, Inspection." },
      },
    },
    run: async (args, context) => {
      let properties = await scopedProperties(context)
      if (args.property) {
        const found = await findProperty(context, args.property)
        if (!found.property) return notFound(args.property, found.matches)
        properties = [found.property]
      }
      const names = new Map(properties.map((property) => [String(property._id), property.address]))
      const filter = { done: false, $or: [{ propertyId: { $in: properties.map((property) => property._id) } }, ...(args.property ? [] : [{ propertyId: null }])] }
      if (args.label) filter.labels = String(args.label)
      const tasks = await Task.find(filter).sort({ due: 1 })
      const people = await User.find({ _id: { $in: tasks.map((task) => task.assigneeId).filter(Boolean) } }).select("name email")
      const showEmail = context.permissions.includes(PERMISSIONS.tasksAssign)
      return {
        success: true,
        total: tasks.length,
        tasks: tasks.map((task) => {
          const person = people.find((item) => String(item._id) === String(task.assigneeId || ""))
          return {
            title: task.title,
            due: task.due || "",
            priority: task.priority,
            labels: task.labels || [],
            property: names.get(String(task.propertyId || "")) || "Company-wide",
            assignee: person ? (showEmail ? `${person.name} <${person.email}>` : person.name) : task.owner || "Unassigned",
          }
        }),
      }
    },
    summarize: (result) => ({ title: `${result.total} open ${result.total === 1 ? "task" : "tasks"}` }),
  },
  {
    name: "search_documents",
    label: "Searching documents",
    permission: PERMISSIONS.documentsRead,
    description: "Find files in the document library by name, such as receipts, contracts, workbooks or photos.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Words in the file name. Leave empty to list the most recent files." } },
    },
    run: async (args, context) => {
      const filter = {}
      const properties = await scopedProperties(context)
      if (context.user.role === "contractor") filter.propertyId = { $in: properties.map((property) => property._id) }
      if (args.query) filter.name = new RegExp(escapeRegex(String(args.query).trim()), "i")
      const files = await DocumentFile.find(filter).sort({ createdAt: -1 }).limit(25)
      const names = new Map(properties.map((property) => [String(property._id), property.address]))
      return {
        success: true,
        total: files.length,
        documents: files.map((file) => ({ name: file.name, kind: file.kind, property: names.get(String(file.propertyId || "")) || "", added: dateKey(file.createdAt?.toISOString?.()) })),
      }
    },
    summarize: (result) => ({ title: `${result.total} ${result.total === 1 ? "document" : "documents"}` }),
  },
  {
    name: "web_search",
    label: "Searching the web",
    web: true,
    description: "Search the public internet with Firecrawl for anything that is not in the company records: homes listed for sale or rent, market rents, comparable sales, neighborhood facts, property tax rates, insurance costs, news, or public information about a lender. Each result includes the page text. Write a specific query with the city, state or ZIP code. Use sites to target listing or county sites, recency for anything new or recent, and news for current events. Never put private financial figures in the query.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "A specific search query, for example \"homes for sale Jacksonville FL 32209\"." },
        sites: { type: "array", items: { type: "string" }, description: "Only search these domains, for example [\"zillow.com\", \"realtor.com\", \"redfin.com\"]." },
        recency: { type: "string", enum: ["any", "day", "week", "month", "year"], description: "Only pages from this recent period." },
        news: { type: "boolean", description: "Also search news articles." },
        limit: { type: "number", description: "Number of results, 1 to 8. Default 5." },
      },
      required: ["query"],
    },
    run: async (args) => {
      const query = String(args.query || "").trim().slice(0, 400)
      if (!query) return { success: false, error: "Write a search query." }
      const sites = cleanDomains(args.sites)
      const body = {
        query,
        limit: clampLimit(args.limit, 5, 8),
        sources: args.news ? ["web", "news"] : ["web"],
        country: "US",
        timeout: 60000,
        ignoreInvalidURLs: true,
        scrapeOptions: { formats: [{ type: "markdown" }], onlyMainContent: true, maxAge: FIRECRAWL_CACHE_MS },
      }
      if (sites.length) body.includeDomains = sites
      if (RECENCY[args.recency]) body.tbs = RECENCY[args.recency]
      const response = await firecrawl("/search", body)
      if (!response.success) return response
      const web = (response.data?.web || []).map((item) => ({
        title: item.title || item.metadata?.title || "",
        url: item.url || "",
        description: item.description || "",
        content: cleanMarkdown(item.markdown, 3500),
      }))
      const news = (response.data?.news || []).map((item) => ({ title: item.title || "", url: item.url || "", snippet: item.snippet || item.description || "", date: item.date || "" }))
      if (!web.length && !news.length) return { success: true, query, results: [], note: "No results. Try fewer or different words, a nearby city, or drop the sites filter." }
      return { success: true, query, sites, recency: args.recency || "any", results: web, news }
    },
    summarize: (result, args) => ({ title: plural((result.results?.length || 0) + (result.news?.length || 0), "web result"), query: args.query }),
  },
  {
    name: "read_webpage",
    label: "Visiting the website",
    web: true,
    description: "Open one public web page through Firecrawl and read it. Pass extract to pull structured fields out of the page, for example \"every listing with address, price, beds, baths, square feet and days on market\" or \"the 2025 millage rate and assessed value\". Use it on a URL from web_search or one the person gave.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The full https URL." },
        extract: { type: "string", description: "What to pull out of the page as structured data. Leave empty to read the page text." },
      },
      required: ["url"],
    },
    run: async (args) => {
      const url = String(args.url || "").trim()
      if (!/^https?:\/\//i.test(url)) return { success: false, error: "Give a full http or https URL." }
      const extract = String(args.extract || "").trim().slice(0, 1000)
      const formats = [{ type: "markdown" }]
      if (extract) formats.push({ type: "json", prompt: extract })
      const response = await firecrawl("/scrape", { url, formats, onlyMainContent: true, timeout: 60000, maxAge: FIRECRAWL_CACHE_MS })
      if (!response.success) return response
      const title = response.data?.metadata?.title
      const result = { success: true, url, title: Array.isArray(title) ? title[0] : title || "" }
      if (extract) {
        result.extracted = response.data?.json ?? null
        result.content = cleanMarkdown(response.data?.markdown, 4000)
      } else {
        result.content = cleanMarkdown(response.data?.markdown, 12000)
      }
      return result
    },
    summarize: (result, args) => ({ title: result.title || result.url, url: result.url, extracted: Boolean(args.extract) }),
  },
  {
    name: "search_records",
    label: "Searching records",
    description: "Search every company record the person can see at once: properties, loans, lenders, tasks, documents and expenses. It tolerates misspellings. Use it first when you are not sure where something lives or how a name is spelled, then open the match with the specific tool.",
    parameters: {
      type: "object",
      properties: { query: { type: "string", description: "Words to look for, such as an address, street, city, lender, vendor or file name." } },
      required: ["query"],
    },
    run: async (args, context) => {
      const query = String(args.query || "").trim()
      if (!query) return { success: false, error: "Write what to search for." }
      const allowed = (permission) => context.permissions.includes(permission)
      const staff = context.user.role !== "contractor"
      const found = []
      const add = (type, items, textOf, view) => {
        for (const entry of rank(items, query, textOf, SEARCH_MATCH)) found.push({ type, score: Math.round(entry.score * 100) / 100, ...view(entry.item) })
      }
      const properties = allowed(PERMISSIONS.propertiesRead) ? await scopedProperties(context) : []
      const ids = properties.map((property) => property._id)
      const names = new Map(properties.map((property) => [String(property._id), property.address]))
      add("property", properties, (property) => [property.address, property.city, property.stage, property.strategy, property.nextAction, ...(property.labels || [])].filter(Boolean).join(" "), (property) => ({
        id: String(property._id),
        label: property.address,
        detail: [property.city, property.stage, property.strategy, property.nextAction].filter(Boolean).join(" · "),
      }))
      if (staff && allowed(PERMISSIONS.propertiesRead)) {
        const loans = await Loan.find({ propertyId: { $in: ids } })
        const lenders = await Lender.find({ _id: { $in: loans.map((loan) => loan.lenderId).filter(Boolean) } })
        add("lender", lenders, (lender) => lender.name, (lender) => ({ label: lender.name, detail: `${loans.filter((loan) => String(loan.lenderId) === String(lender._id)).length} loans` }))
        add("loan", loans, (loan) => [loan.lender, loan.loanNumber, loan.label, names.get(String(loan.propertyId))].filter(Boolean).join(" "), (loan) => ({
          label: `${loan.lender || "Loan"}${loan.loanNumber ? ` #${loan.loanNumber}` : ""}`,
          detail: names.get(String(loan.propertyId)) || "",
        }))
        const tasks = await Task.find({ done: false, $or: [{ propertyId: { $in: ids } }, { propertyId: null }] })
        add("task", tasks, (task) => [task.title, ...(task.labels || []), names.get(String(task.propertyId || ""))].filter(Boolean).join(" "), (task) => ({ label: task.title, detail: [task.due, names.get(String(task.propertyId || ""))].filter(Boolean).join(" · ") }))
      }
      if (allowed(PERMISSIONS.documentsRead)) {
        const files = await DocumentFile.find(staff ? {} : { propertyId: { $in: ids } }).sort({ createdAt: -1 }).limit(500)
        add("document", files, (file) => file.name, (file) => ({ label: file.name, detail: names.get(String(file.propertyId || "")) || file.kind }))
      }
      if (staff && allowed(PERMISSIONS.expensesRead)) {
        const expenses = await Expense.find({}).sort({ createdAt: -1 }).limit(500)
        add("expense", expenses, (item) => [item.title, item.vendor, item.category].filter(Boolean).join(" "), (item) => ({ label: item.title, detail: [item.vendor, item.amount != null ? `$${item.amount}` : "", names.get(String(item.propertyId || ""))].filter(Boolean).join(" · ") }))
      }
      found.sort((left, right) => right.score - left.score)
      return { success: true, query, total: found.length, matches: found.slice(0, 20) }
    },
    summarize: (result, args) => ({ title: plural(result.total || 0, "match", "matches"), query: args.query }),
  },
]

function todoResult(todos) {
  const completed = todos.filter((todo) => todo.status === "completed").length
  const pending = todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress").length
  return {
    success: true,
    title: `${pending} pending, ${completed} completed`,
    metadata: { todos: todos.map((todo) => ({ ...todo })), total: todos.length, pending, completed },
  }
}

export function toolsFor(context) {
  return TOOLS.filter((tool) => {
    if (tool.permission && !context.permissions.includes(tool.permission)) return false
    if (tool.staffOnly && context.user.role === "contractor") return false
    if (tool.web && !webAllowed(context)) return false
    return true
  })
}

export function toolSpecs(tools) {
  return tools.map((tool) => ({ type: "function", function: { name: tool.name, description: tool.description, parameters: tool.parameters } }))
}

function parseArguments(raw) {
  if (raw && typeof raw === "object") return raw
  try {
    const parsed = JSON.parse(raw || "{}")
    return parsed && typeof parsed === "object" ? parsed : {}
  } catch {
    return null
  }
}

export async function executeTool(call, tools, context) {
  const tool = tools.find((item) => item.name === call.name)
  const args = parseArguments(call.arguments)
  if (!tool) return { args: args || {}, result: { success: false, error: `There is no tool named ${call.name}. Use one of: ${tools.map((item) => item.name).join(", ")}.` } }
  if (!args) return { args: {}, result: { success: false, error: "The tool arguments were not valid JSON. Send a JSON object." } }
  try {
    const result = await tool.run(args, context)
    return { args, result: result && typeof result === "object" ? { success: true, ...result } : { success: true, output: String(result) } }
  } catch (error) {
    return { args, result: { success: false, error: error.message, MUST_FIX: "Error occurred. Read error, fix issue, retry. DO NOT skip." } }
  }
}

export function toolContent(name, result) {
  const text = JSON.stringify(result.success === false ? { error: result.error, candidates: result.candidates, message: `Tool ${name} failed: ${result.error}. Try different approach.`, tool: name } : result)
  return text.length > MODEL_RESULT_LIMIT ? `${text.slice(0, MODEL_RESULT_LIMIT)}… [truncated, ask a narrower question for the rest]` : text
}

export function clientResult(tool, args, result) {
  if (result.success === false) return { success: false, error: result.error }
  if (tool?.name === "todo_write") return result
  return { success: true, ...(tool?.summarize ? tool.summarize(result, args) : {}) }
}
