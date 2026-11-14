import mongoose from "mongoose"
import { sealedFields } from "../lib/sealed.js"

const { Schema, model, models } = mongoose

// Encrypted before they reach the database (lib/sealed.js): a company's tax and bank details, a property's lockbox and
// door codes, what the Agent read in a document (it holds the document's contents) and the house summaries it writes
// from them. Nothing looks these up by value.
export const SEALED_FIELDS = {
  Company: ["ein", "wireBankName", "wireRoutingNumber", "wireAccountNumber", "wireEntityName", "wireAddress"],
  Property: ["accessInfo"],
  Document: ["insight"],
  HouseSummary: ["summary"],
}

function register(name, schema) {
  return models[name] || model(name, schema)
}

const sourceSchema = new Schema(
  { file: String, sheet: String, row: Number },
  { _id: false },
)

export const User = register(
  "User",
  new Schema(
    {
      name: { type: String, required: true },
      email: { type: String, required: true, unique: true, lowercase: true, trim: true },
      passwordHash: { type: String, required: true },
      // Goes up when the password is reset or changed, which signs out every session made before.
      sessionVersion: { type: Number, default: 0 },
      role: { type: String, required: true },
      title: String,
      company: { type: String, default: "SynergiFund" },
      extraPermissions: [String],
      deniedPermissions: [String],
      propertyIds: [{ type: Schema.Types.ObjectId, ref: "Property" }],
      overviewOrder: [String],
      // The Insights sections this person hid (Customize on Insights): "attention", "projection" or a card's id.
      overviewHidden: [String],
      // The Home sections this person hid (Customize Home): "greeting", "attention", "today", "tasks", "catchup".
      homeHidden: [String],
      // How this person left the Tasks page (group, sort, filters, hidden columns), as `main`, and a property's
      // Tasks tab as `property`.
      taskViews: Schema.Types.Mixed,
      // The call ringtone and message chime this person picked in Settings.
      sounds: { ringtone: String, chime: String },
      // The AI teammate's account: it posts in property chats, never signs in, and gets no notifications.
      bot: { type: Boolean, default: false },
      // People this person blocked in chat: their messages are hidden for them, and they can't message them directly.
      blockedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      // The Agent's memory turned off (Knowledge → About you on the Agent page): it neither uses nor learns what it remembers.
      agentMemoryOff: { type: Boolean, default: false },
    },
    { timestamps: true },
  ),
)

export const Property = register(
  "Property",
  new Schema(
    {
      address: { type: String, required: true },
      city: String,
      state: String,
      zip: String,
      // The full address the state and ZIP lookup did not find (so it is not looked up again until it changes).
      addressChecked: String,
      stage: { type: String, default: "Under contract" },
      strategy: String,
      health: { type: String, default: "Health not assessed" },
      nextAction: String,
      deadline: String,
      ownerEntity: String,
      accessInfo: String,
      purchasePrice: Number,
      houseBoughtPrice: Number,
      purchaseDate: String,
      dealSource: String,
      arv: Number,
      arvDate: String,
      arvMethod: String,
      sqft: Number,
      beds: Number,
      baths: Number,
      lat: Number,
      lng: Number,
      comps: [
        {
          address: { type: String, required: true },
          city: String,
          salePrice: Number,
          saleDate: String,
          purchasePrice: Number,
          purchaseDate: String,
          beds: Number,
          baths: Number,
          sqft: Number,
          zillowUrl: String,
          notes: String,
          include: { type: Boolean, default: true },
          photoFileIds: [{ type: Schema.Types.ObjectId, ref: "Document" }],
          lat: Number,
          lng: Number,
        },
      ],
      compsUpdatedAt: Date,
      marketRent: Number,
      actualRent: Number,
      rentStatus: String,
      rentMarket: String,
      rentNotes: String,
      customerTerms: String,
      rehabBudget: Number,
      // Property Info: taxes, insurance (moved here from loans) and utilities. Owner is ownerEntity and the purchase
      // date is purchaseDate, the same fields as everywhere else.
      taxParcel: String,
      // Property taxes and the tax assessment, one row per year (newest first). paidOn is the last Mark paid for it.
      taxYears: [{ year: Number, propertyTaxes: Number, taxAssessment: Number, paidOn: String, _id: false }],
      // The one yearly tax amount and due date from before the rows: moved into taxYears at start-up (taxMove.js),
      // and shown as a row until then (taxYears in the shared package).
      taxAmount: Number,
      taxDueDate: String,
      // Insurance policies (Builder's Risk, Liability, Flood…). An Active policy's expiration date shows on the calendar
      // and in Needs attention; each Mark paid puts a payment on the cost sheet, counts it in paymentsPaid and sets paidOn.
      insurancePolicies: [
        {
          // The Category. Spelled out: a bare `type: String` here would make the whole policy a string.
          type: { type: String },
          borrowerEntity: String,
          payee: String,
          carrier: String,
          policyNumber: String,
          accountCode: String,
          monthlyPayment: Number,
          // The premium for the billing period, from before Monthly Payment: it is read as the monthly payment (a
          // twelfth of an annual one) and saved as that the next time the property's policies change.
          premium: Number,
          billing: String,
          effectiveDate: String,
          expirationDate: String,
          notes: String,
          status: String,
          paymentsTotal: Number,
          paymentsPaid: Number,
          paidOn: String,
        },
      ],
      // The one set of insurance fields from before the policy list. It shows as the first policy and is cleared when
      // that is saved into insurancePolicies (see insurancePolicies in the shared package).
      insuranceCarrier: String,
      insuranceAmount: Number,
      insuranceFrequency: String,
      insuranceDue: String,
      insurancePolicy: String,
      insurancePaidOn: String,
      // The last time Mark paid recorded the tax, from before the tax years (each year keeps its own paidOn now).
      taxPaidOn: String,
      utilities: [{ name: String, provider: String, account: String, _id: false }],
      // BRRRR refinance stage (Ready to Start, In Process, Closed), and the loans closing it marked Paid off (with the
      // status each had, so reopening the refinance can put them back).
      refinanceStage: String,
      refinanceClosedAt: Date,
      refinanceClosedLoans: [{ loanId: { type: Schema.Types.ObjectId, ref: "Loan" }, status: String, paymentsBehind: Number, pastDueAmount: Number, _id: false }],
      labels: [String],
      scopeLines: [
        {
          title: String,
          description: String,
          budget: Number,
          status: { type: String, default: "Not started" },
          // Who set the status last ("Sam Rivera (AI)" or a person), when, and why.
          statusBy: String,
          statusAt: Date,
          statusNote: String,
          // When it is expected to be done (YYYY-MM-DD), and what that is based on.
          forecastDate: String,
          forecastNote: String,
          forecastBy: String,
          forecastAt: Date,
        },
      ],
      assignedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      companyId: { type: Schema.Types.ObjectId, ref: "Company", index: true },
      position: Number,
      importSource: sourceSchema,
      updatedBy: String,
      // The last tax or insurance payment marked paid (which one, and when): the same one again within a minute is a
      // double tap, not a second payment (routes/properties.js /:id/paid).
      paidMark: { key: String, at: Date },
    },
    { timestamps: true },
  ).plugin(sealedFields, { model: "Property", fields: SEALED_FIELDS.Property }),
)

// A company (LLC, corporation, trust…) that owns properties. Each property belongs to at most one.
export const Company = register(
  "Company",
  new Schema(
    {
      name: { type: String, required: true, trim: true },
      entityType: { type: String, default: "" },
      stateOfFormation: { type: String, default: "" },
      // Shown as "Effective date".
      formedOn: { type: String, default: "" },
      address: { type: String, default: "" },
      city: { type: String, default: "" },
      state: { type: String, default: "" },
      zip: { type: String, default: "" },
      // Shown as "Authorized member".
      contactName: { type: String, default: "" },
      phone: { type: String, default: "" },
      email: { type: String, default: "" },
      notes: { type: String, default: "" },
      ein: { type: String, default: "" },
      wireBankName: { type: String, default: "" },
      wireRoutingNumber: { type: String, default: "" },
      wireAccountNumber: { type: String, default: "" },
      wireEntityName: { type: String, default: "" },
      wireAddress: { type: String, default: "" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
      updatedBy: String,
    },
    { timestamps: true },
  ).plugin(sealedFields, { model: "Company", fields: SEALED_FIELDS.Company }),
)

export const ExpenseRequest = register(
  "ExpenseRequest",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      title: { type: String, required: true },
      amount: { type: Number, required: true },
      category: { type: String, required: true },
      vendor: String,
      date: String,
      entity: { type: String, default: "Investment company" },
      costTreatment: { type: String, default: "Include in construction margin" },
      status: { type: String, default: "Submitted" },
      proofFileId: { type: Schema.Types.ObjectId, ref: "Document" },
      proofFileIds: [{ type: Schema.Types.ObjectId, ref: "Document" }],
      note: String,
      reviewNote: String,
      requestedBy: { type: Schema.Types.ObjectId, ref: "User" },
      reviewedBy: { type: Schema.Types.ObjectId, ref: "User" },
      reapplied: { type: Boolean, default: false },
      drawId: { type: Schema.Types.ObjectId, ref: "Draw" },
      scopeLineId: String,
      // This property's part of a receipt: its items (and its share of the sales tax), each posted as its own cost.
      receiptId: { type: Schema.Types.ObjectId, ref: "Receipt", index: true },
      lines: [{ description: String, category: String, amount: Number, kind: { type: String, default: "item" } }],
    },
    { timestamps: true },
  ),
)

export const Expense = register(
  "Expense",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      requestId: { type: Schema.Types.ObjectId, ref: "ExpenseRequest" },
      title: String,
      amount: Number,
      category: String,
      vendor: String,
      date: String,
      entity: String,
      costTreatment: String,
      proofFileId: { type: Schema.Types.ObjectId, ref: "Document" },
      proofFileIds: [{ type: Schema.Types.ObjectId, ref: "Document" }],
      drawId: { type: Schema.Types.ObjectId, ref: "Draw" },
      scopeLineId: String,
      reapplied: { type: Boolean, default: false },
      postedBy: { type: Schema.Types.ObjectId, ref: "User" },
      // Who bought it (the contractor on a receipt), kept by name too in case they leave the team.
      submittedBy: { type: Schema.Types.ObjectId, ref: "User" },
      submittedByName: String,
      // One item (or the sales tax share) from a receipt.
      receiptId: { type: Schema.Types.ObjectId, ref: "Receipt", index: true },
      lineKind: String,
    },
    { timestamps: true },
  ),
)

// A store receipt photographed or uploaded, read by AI into items the buyer checks, then filed on one or more
// properties. A draft until it is submitted; then each property's part is a request (or posted costs, when someone who
// approves expenses files it).
export const Receipt = register(
  "Receipt",
  new Schema(
    {
      status: { type: String, default: "Draft" },
      vendor: { type: String, default: "" },
      date: { type: String, default: "" },
      tax: Number,
      // The total printed on the receipt, to check the items against.
      printedTotal: Number,
      entity: { type: String, default: "Construction company" },
      note: { type: String, default: "" },
      items: [
        {
          description: String,
          category: String,
          quantity: Number,
          amount: Number,
          propertyId: String,
          split: { mode: String, parts: [{ propertyId: String, value: String, _id: false }] },
        },
      ],
      propertyIds: [{ type: Schema.Types.ObjectId, ref: "Property" }],
      fileIds: [{ type: Schema.Types.ObjectId, ref: "Document" }],
      read: { status: String, model: String, error: String, at: Date, warnings: [String] },
      createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
      // Who bought it: the person who files it, or the contractor an admin files it for.
      boughtBy: { type: Schema.Types.ObjectId, ref: "User" },
      boughtByName: String,
      submittedAt: Date,
      totalCents: Number,
      requestIds: [{ type: Schema.Types.ObjectId, ref: "ExpenseRequest" }],
      expenseIds: [{ type: Schema.Types.ObjectId, ref: "Expense" }],
    },
    { timestamps: true },
  ),
)

// Backups: the schedule (one record), and every stored file copied for the backups. Both stay out of the backups
// themselves, so restoring never changes the schedule or forgets a copy.
export const BackupSetting = register(
  "BackupSetting",
  new Schema(
    {
      key: { type: String, required: true, unique: true, default: "org" },
      daily: { type: Boolean, default: true },
      // Hour of the day on the team's clock (0–23).
      hour: { type: Number, default: 2 },
      keepDays: { type: Number, default: 30 },
      lastAutoDay: String,
      updatedBy: String,
    },
    { timestamps: true },
  ),
)

export const BackupFileCopy = register(
  "BackupFileCopy",
  new Schema(
    {
      storage: { type: String, required: true },
      storagePath: { type: String, required: true },
      copiedAt: Date,
      // When its document was first seen gone; the copy is removed once no kept backup can need it.
      goneSince: Date,
      // The encryption key the copy is under (empty: stored before encryption), so the encryption job reads only
      // copies that still need it.
      keyId: String,
    },
    { timestamps: true },
  ).index({ storage: 1, storagePath: 1 }, { unique: true }),
)

// One record per encryption key: a value encrypted with it. A server started with a different key under the same name,
// or with none of the keys this database was encrypted with, refuses to start (services/encryptData.js), rather than
// save records that the right key can't read.
export const EncryptionKey = register(
  "EncryptionKey",
  new Schema(
    {
      keyId: { type: String, required: true, unique: true },
      check: { type: String, required: true },
    },
    { timestamps: true },
  ),
)

export const DrawBudget = register(
  "DrawBudget",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true },
      title: { type: String, default: "Rehab funding" },
      budget: Number,
      fundingLimit: Number,
      fundingPercent: { type: Number, default: 100 },
      fundingBasis: { type: String, default: "Reported in source" },
      approvalStatus: { type: String, default: "Not confirmed" },
      loanNumber: String,
      borrower: String,
      notes: String,
    },
    { timestamps: true },
  ),
)

export const Draw = register(
  "Draw",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true },
      budgetId: { type: Schema.Types.ObjectId, ref: "DrawBudget" },
      title: { type: String, required: true },
      status: { type: String, default: "Requested" },
      amount: Number,
      fundedAmount: Number,
      cashBasis: { type: String, default: "Confirmed receipt" },
      requestedDate: String,
      fundedDate: String,
      notes: String,
      source: String,
      lines: [
        {
          title: String,
          description: String,
          amount: Number,
        },
      ],
    },
    { timestamps: true },
  ),
)

export const Lender = register(
  "Lender",
  new Schema(
    {
      name: { type: String, required: true },
      terms: { type: String, default: "" },
    },
    { timestamps: true },
  ),
)

export const Loan = register(
  "Loan",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      lenderId: { type: Schema.Types.ObjectId, ref: "Lender" },
      lender: String,
      // "Nature" (Financed, Refinanced…), no longer shown: Loan Type replaced it.
      label: { type: String, default: "Financed" },
      terms: { type: String, default: "" },
      loanNumber: String,
      loanType: String,
      // A percent, e.g. 8.9 for 8.90%.
      interestRate: Number,
      // Who the payments go to; can differ from the lender.
      servicer: String,
      // Shown as Current Loan Amount.
      balance: Number,
      payment: Number,
      paymentDay: Number,
      originationDate: String,
      // Shown as Maturity Date.
      maturity: String,
      termsStatus: { type: String, default: "Needs verification" },
      // Shown as Original Loan Amount.
      originalAmount: Number,
      status: { type: String, default: "Current" },
      // Missed payments, kept only while the loan is Late or Delinquent.
      paymentsBehind: Number,
      pastDueAmount: Number,
      insurancePayment: Number,
      insuranceFrequency: { type: String, default: "Yearly" },
      insuranceDue: String,
      importSource: sourceSchema,
    },
    { timestamps: true },
  ),
)

export const DocumentFile = register(
  "Document",
  new Schema(
    {
      name: { type: String, required: true },
      mime: String,
      size: Number,
      storage: { type: String, default: "local" },
      storagePath: { type: String, required: true },
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      companyId: { type: Schema.Types.ObjectId, ref: "Company", index: true },
      // The folder inside the property's or company's Documents (see PROPERTY_FOLDERS and COMPANY_FOLDERS).
      folder: String,
      kind: { type: String, default: "file" },
      labels: { type: [String], default: [] },
      versionGroup: String,
      version: { type: Number, default: 1 },
      // The encryption key the stored file is under (empty: stored before encryption, or encryption is off). The
      // encryption job reads only files not yet under the current key.
      fileKeyId: String,
      uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
      // What the Agent read in it (services/agent/documents.js): the kind of document (DOCUMENT_TYPES) and, sealed,
      // a JSON note with its title, summary, parties, dates, amounts and words to find it by. insightState: "" not read
      // yet, "reading", "read", "failed" (insightError says why) or "skipped" (nothing to read, such as a video).
      docType: String,
      insight: String,
      insightState: { type: String, default: "" },
      insightAt: Date,
      insightError: String,
      insightTries: { type: Number, default: 0 },
      // The person said no to the Agent's filing suggestion for it (documentSuggestion).
      suggestionDismissed: Boolean,
    },
    { timestamps: true },
  )
    .plugin(sealedFields, { model: "Document", fields: SEALED_FIELDS.Document })
    // The Agent's reader looks for the newest document not read yet, every half minute.
    .index({ insightState: 1, createdAt: -1 }),
)

export const ReviewItem = register(
  "ReviewItem",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      title: { type: String, required: true },
      detail: String,
      status: { type: String, default: "Open" },
      importSource: sourceSchema,
    },
    { timestamps: true },
  ),
)

export const ImportJob = register(
  "ImportJob",
  new Schema(
    {
      fileId: { type: Schema.Types.ObjectId, ref: "Document" },
      type: String,
      sheet: String,
      headers: [String],
      rows: { type: Array, default: [] },
      marks: { type: Array, default: [] },
      counts: {
        pending: Number,
        added: Number,
        duplicate: Number,
        skipped: Number,
        removed: Number,
        lines: Number,
        draws: Number,
        budgets: Number,
      },
      status: { type: String, default: "Draft" },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true },
  ),
)

export const Task = register(
  "Task",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      title: { type: String, required: true },
      assigneeId: { type: Schema.Types.ObjectId, ref: "User" },
      owner: String,
      due: String,
      priority: { type: String, default: "Medium" },
      labels: [String],
      done: { type: Boolean, default: false },
      // Not started, In progress or Waiting while open (see taskStatus); the status it had before it was completed,
      // to go back to when it is reopened.
      status: { type: String, default: "" },
      previousStatus: String,
      // Shown as Description.
      notes: String,
      reviewId: { type: Schema.Types.ObjectId, ref: "ReviewItem" },
      // Who added it (Assigned by); older tasks have no one.
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
      createdByName: String,
      // The task's own log: "Status changed to Waiting" by Roman, and when.
      history: [{ at: { type: Date, default: Date.now }, byName: String, text: String, _id: false }],
    },
    { timestamps: true },
  ),
)

// A comment on a task (a reply has `parentId`), with @mentions and files (DocumentFile kind "task").
export const TaskComment = register(
  "TaskComment",
  new Schema(
    {
      taskId: { type: Schema.Types.ObjectId, ref: "Task", required: true },
      parentId: { type: Schema.Types.ObjectId, ref: "TaskComment" },
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      userName: String,
      text: { type: String, default: "" },
      mentionIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      attachments: [{ fileId: { type: Schema.Types.ObjectId, ref: "Document" }, name: String, mime: String, size: Number, _id: false }],
    },
    { timestamps: true },
  ).index({ taskId: 1, createdAt: 1 }),
)

export const Bill = register(
  "Bill",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      title: { type: String, required: true },
      amount: Number,
      category: { type: String, default: "Other" },
      entity: { type: String, default: "Investment company" },
      due: String,
      startDue: String,
      recurrence: { type: String, default: "One time" },
      status: { type: String, default: "Active" },
      vendor: String,
      paidOn: String,
    },
    { timestamps: true },
  ),
)

export const PhotoSet = register(
  "PhotoSet",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true },
      weekOf: { type: String, required: true },
      fileIds: [{ type: Schema.Types.ObjectId, ref: "Document" }],
      uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
      note: String,
    },
    { timestamps: true },
  ),
)

// Something on the team calendar: a meeting, a site visit, a closing. Times are the team's local clock (HH:MM).
export const CalendarEvent = register(
  "CalendarEvent",
  new Schema(
    {
      title: { type: String, required: true },
      date: { type: String, required: true },
      allDay: { type: Boolean, default: false },
      start: String,
      end: String,
      location: { type: String, default: "" },
      description: { type: String, default: "" },
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      guestIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      createdBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
      createdByName: String,
    },
    { timestamps: true },
  )
    .index({ createdBy: 1, date: 1 })
    .index({ guestIds: 1, date: 1 }),
)

// What the AI teammate knows about one property: what it has read, its running notes, and when it last followed up
// or raised a draw, so it never repeats itself.
export const SiteWatch = register(
  "SiteWatch",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, unique: true },
      lastReviewedAt: Date,
      memory: { type: String, default: "" },
      lastFollowUpAt: Date,
      followUpsUnanswered: { type: Number, default: 0 },
      escalatedAt: Date,
      lastDrawAlertAt: Date,
      drawTaskId: { type: Schema.Types.ObjectId, ref: "Task" },
      lastReplyAt: Date,
    },
    { timestamps: true },
  ),
)

export const PhotoReport = register(
  "PhotoReport",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true },
      drawId: { type: Schema.Types.ObjectId, ref: "Draw" },
      summary: String,
      changes: [String],
      currentSetId: { type: Schema.Types.ObjectId, ref: "PhotoSet" },
      previousSetId: { type: Schema.Types.ObjectId, ref: "PhotoSet" },
    },
    { timestamps: true },
  ),
)

export const ConstructionProject = register(
  "ConstructionProject",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      title: String,
      status: { type: String, default: "Planning" },
      lenderBudget: Number,
      contractAmount: Number,
      changeOrders: Number,
      estimatedCost: Number,
      allocatedOverhead: Number,
      revenueReceived: { type: Number, default: 0 },
      notes: String,
    },
    { timestamps: true },
  ),
)

export const Activity = register(
  "Activity",
  new Schema(
    {
      actorId: { type: Schema.Types.ObjectId, ref: "User" },
      actorName: String,
      title: { type: String, required: true },
      detail: String,
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
    },
    { timestamps: true },
  ),
)

export const Notification = register(
  "Notification",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      title: String,
      body: String,
      href: String,
      read: { type: Boolean, default: false },
      event: String,
    },
    { timestamps: true },
  ),
)

export const PushSubscription = register(
  "PushSubscription",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      endpoint: { type: String, required: true, unique: true },
      p256dh: { type: String, required: true },
      auth: { type: String, required: true },
    },
    { timestamps: true },
  ),
)

// A phone running the SynergiFund app. Android is reached through Firebase Cloud Messaging; an iPhone through Apple
// push, where token is its call address (PushKit, rings through CallKit) and alertToken its notification address.
// keyHash: the phone's own key (hashed), so Decline on a locked phone works without a sign-in cookie.
// sandbox: an iPhone build for testing, reached through Apple's test service.
export const NativeDevice = register(
  "NativeDevice",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
      token: { type: String, required: true, unique: true },
      platform: { type: String, default: "android" },
      alertToken: { type: String, index: true },
      sandbox: { type: Boolean, default: false },
      keyHash: { type: String, required: true },
      appVersion: String,
      lastSeenAt: Date,
    },
    { timestamps: true },
  ),
)

export const MailMessage = register(
  "MailMessage",
  new Schema(
    {
      to: [String],
      subject: String,
      body: String,
      event: String,
      status: { type: String, default: "Queued" },
      error: { type: String, default: "" },
      providerIds: [String],
      sentCount: { type: Number, default: 0 },
    },
    { timestamps: true },
  ),
)

export const AgentThread = register(
  "AgentThread",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      title: String,
      // The title was given on purpose (renamed, or a repeating prompt's): the Agent no longer names the chat itself.
      named: { type: Boolean, default: false },
      messages: [
        {
          role: String,
          content: String,
          sources: [Schema.Types.Mixed],
          toolCalls: [{ tool: String, args: Schema.Types.Mixed, result: Schema.Types.Mixed }],
          todos: [{ id: String, content: String, status: String }],
          models: { task: String, decision: String },
          // `cost`: what the answer's model calls cost, in US dollars.
          usage: { promptTokens: Number, completionTokens: Number, totalTokens: Number, calls: Number, cost: Number },
          agentRunDurationMs: { type: Number, default: null },
          error: { type: Boolean, default: false },
          // Files the person attached to a question, and what was read from them (the agent works from these notes).
          attachments: [{ fileId: { type: Schema.Types.ObjectId, ref: "Document" }, name: String, mime: String, size: Number, _id: false }],
          attachmentNotes: String,
          // PDFs the Agent made for an answer (services/agent/pdfs.js), kept like attachments: only this person opens them.
          // `source`: the words it wrote them from, so a later "change the PDF" can rewrite one.
          files: [{ fileId: { type: Schema.Types.ObjectId, ref: "Document" }, name: String, mime: String, size: Number, source: String, _id: false }],
          // What the Agent remembered or forgot from the question ("Saved: …", "Forgot: …"), for "Memory updated".
          memoryNotes: [String],
          // The person's thumbs on an answer: "up", "down" or "".
          feedback: { type: String, default: "" },
          // A turn of a spoken conversation (services/agent/voice.js). `spoken`: what the Agent said aloud for an
          // answer, which is shorter than what it wrote; later spoken turns go by it.
          voice: Boolean,
          spoken: String,
          at: { type: Date, default: Date.now },
        },
      ],
      // Pinned chats are listed first on the Agent page.
      pinned: { type: Boolean, default: false },
      // A temporary chat is never listed in History. MongoDB removes it once `expiresAt` passes.
      temporary: { type: Boolean, default: false },
      expiresAt: { type: Date, default: undefined },
    },
    { timestamps: true },
  ).index({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
)

// A question someone saved to ask again (Prompts on the Agent page). Each person has their own.
export const AgentPrompt = register(
  "AgentPrompt",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      text: { type: String, required: true },
      // When the Agent asks it on its own (services/agent/repeats.js): every "day", "weekday", "week" (on `day`, 0 is
      // Sunday) or "month" (on `day`, 1 to 28), at `hour` team time; "" never. The answer opens as a new chat.
      repeat: { every: { type: String, default: "" }, day: Number, hour: Number },
      // The weekly brief the Agent offers (one per person).
      brief: { type: Boolean, default: false },
      // The team day it last ran, claimed before it runs so it runs once a day however many servers there are, and when
      // that claim was made (until its answer is saved): a claim half an hour old was cut off, so it is asked again.
      lastRunDay: String,
      runningAt: Date,
      lastRunAt: Date,
      lastThreadId: { type: Schema.Types.ObjectId, ref: "AgentThread" },
      lastError: String,
    },
    { timestamps: true },
  ).index({ userId: 1, updatedAt: -1 }).index({ "repeat.every": 1 }),
)

// A change the Agent prepared for a person to confirm (see services/agent/proposals.js). status: pending, saved,
// cancelled or outdated (a figure moved before it was confirmed).
export const AgentProposal = register(
  "AgentProposal",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      threadId: { type: Schema.Types.ObjectId, ref: "AgentThread" },
      propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true },
      address: String,
      // "property" (its figures) or "loan" (a loan's figures: loanId, its lender, and the document they came from).
      kind: { type: String, default: "property" },
      loanId: { type: Schema.Types.ObjectId, ref: "Loan" },
      lender: String,
      sourceId: { type: Schema.Types.ObjectId, ref: "Document" },
      sourceName: String,
      changes: [{ field: String, label: String, from: Number, to: Number, _id: false }],
      status: { type: String, default: "pending" },
      decidedAt: Date,
      expiresAt: Date,
    },
    { timestamps: true },
  ),
)

// A rename of a document the Agent prepared: only the person's Confirm renames the file (services/agent/renames.js).
export const AgentRename = register(
  "AgentRename",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      threadId: { type: Schema.Types.ObjectId, ref: "AgentThread" },
      documentId: { type: Schema.Types.ObjectId, ref: "Document", required: true },
      from: String,
      to: String,
      // Where the file is (a property's address or a company's name), for the card.
      place: String,
      status: { type: String, default: "pending" },
      decidedAt: Date,
      expiresAt: Date,
    },
    { timestamps: true },
  ),
)

export const AgentSetting = register(
  "AgentSetting",
  new Schema(
    {
      key: { type: String, required: true, unique: true, default: "org" },
      taskModel: String,
      decisionModel: String,
      // The AI teammate in property chats.
      teammateOn: { type: Boolean, default: false },
      // When it was last turned on: contractors get a full quiet period from then before any check-in.
      teammateOnAt: Date,
      teammateName: String,
      teammateUserId: { type: Schema.Types.ObjectId, ref: "User" },
      followUpDays: Number,
      drawEmail: String,
      // Documents the Agent reads: everything added from docsReadFrom on (set when the reader first starts), and the
      // documents already there before it once an admin turns on docsReadAll.
      docsReadFrom: Date,
      docsReadAll: { type: Boolean, default: false },
      // The team's AI budget for a month, in US dollars (null: no limit). Reached, new AI work waits for the next month.
      monthlyLimit: { type: Number, default: null },
      // How the Agent sounds when it is talked with: one of the speech model's voices and the accent it is asked for
      // (AGENT_VOICES and AGENT_ACCENTS in the shared package; unset: VOICE_DEFAULTS).
      voiceName: String,
      voiceAccent: String,
      // An admin has turned talking with the Agent off for everyone (Settings → Agent → Voice).
      voiceOff: { type: Boolean, default: false },
      updatedBy: String,
    },
    { timestamps: true },
  ),
)

// One model call and what it cost (services/agent/llm.js), for Settings → Agent → AI spending. `month` and `day` are
// on the team's clock. `feature`: agent, memory, receipts, documents (the background reader), calls (AI notes) or
// teammate. `userId`: who it was for (none for background work). `estimated`: worked out from the model's price list
// because the model service gave no cost.
export const AiUsage = register(
  "AiUsage",
  new Schema(
    {
      at: { type: Date, default: Date.now },
      month: { type: String, required: true },
      day: { type: String, required: true },
      feature: { type: String, default: "other" },
      userId: { type: Schema.Types.ObjectId, ref: "User", default: null },
      model: String,
      promptTokens: { type: Number, default: 0 },
      completionTokens: { type: Number, default: 0 },
      cachedTokens: { type: Number, default: 0 },
      cost: { type: Number, default: 0 },
      estimated: { type: Boolean, default: false },
    },
    { versionKey: false },
  ).index({ month: 1, feature: 1 }).index({ month: 1, userId: 1 }).index({ at: 1 }, { expireAfterSeconds: 400 * 24 * 60 * 60 }),
)

// The team's AI spending for a month, added to with each call, so the budget check is one read. `alerted80` and
// `alerted100`: the admins were told it reached 80% and 100% of the budget this month.
export const AiMonth = register(
  "AiMonth",
  new Schema(
    {
      month: { type: String, required: true, unique: true },
      cost: { type: Number, default: 0 },
      calls: { type: Number, default: 0 },
      alerted80: { type: Boolean, default: false },
      alerted100: { type: Boolean, default: false },
    },
    { timestamps: true },
  ),
)

// What the Agent remembers about one person (services/agent/memory.js), used in their chats only. `source`: "auto" (it
// learned it from a chat, `threadId`) or "added" (the person wrote it under Knowledge → About you).
export const AgentMemory = register(
  "AgentMemory",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      text: { type: String, required: true },
      source: { type: String, default: "auto" },
      threadId: { type: Schema.Types.ObjectId, ref: "AgentThread" },
    },
    { timestamps: true },
  ).index({ userId: 1, createdAt: 1 }),
)

// Team knowledge (Knowledge → Team on the Agent page): notes admins write for everyone's Agent, about the business
// (the team's terms, its companies, how it works) or about one house (propertyId). Only people who see the whole books
// read them (services/agent/knowledge.js).
export const TeamNote = register(
  "TeamNote",
  new Schema(
    {
      text: { type: String, required: true },
      propertyId: { type: Schema.Types.ObjectId, ref: "Property", index: true },
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
      createdByName: String,
      updatedByName: String,
    },
    { timestamps: true },
  ),
)

// A team note the Agent prepared when an admin asked it to remember something for the team: only their Confirm on the
// card saves it.
export const TeamNoteDraft = register(
  "TeamNoteDraft",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      threadId: { type: Schema.Types.ObjectId, ref: "AgentThread" },
      text: String,
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      address: String,
      noteId: { type: Schema.Types.ObjectId, ref: "TeamNote" },
      status: { type: String, default: "pending" },
      decidedAt: Date,
      expiresAt: Date,
    },
    { timestamps: true },
  ),
)

// A house's summary, written by the Agent in the background from its records, its documents' notes and the team's
// notes on it (services/agent/knowledge.js): what it is, the plan, how it got here, who is involved, what is on file
// and what is open. `summary` is the JSON it wrote; `factsKey` what it was written from, so a change to that has it
// written again. state: "" waiting, "writing", "written" or "failed" (error says why). `wanted`: an admin asked for it
// to be written again now.
export const HouseSummary = register(
  "HouseSummary",
  new Schema(
    {
      propertyId: { type: Schema.Types.ObjectId, ref: "Property", required: true, unique: true },
      summary: String,
      factsKey: String,
      state: { type: String, default: "" },
      startedAt: Date,
      writtenAt: Date,
      error: String,
      // Failed tries at the facts it was last tried with (triedKey); a change to them starts the count again.
      tries: { type: Number, default: 0 },
      triedKey: String,
      wanted: { type: Boolean, default: false },
    },
    { timestamps: true },
  ).plugin(sealedFields, { model: "HouseSummary", fields: SEALED_FIELDS.HouseSummary }),
)

export const Call = register(
  "Call",
  new Schema(
    {
      channelId: { type: Schema.Types.ObjectId, ref: "ChatChannel", required: true },
      media: { type: String, default: "audio" },
      startedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
      startedByName: String,
      invitedIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      declinedIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      participants: [{ userId: { type: Schema.Types.ObjectId, ref: "User" }, name: String, joinedAt: Date, leftAt: Date }],
      status: { type: String, default: "ringing" },
      outcome: String,
      startedAt: { type: Date, default: Date.now },
      answeredAt: Date,
      endedAt: Date,
    },
    { timestamps: true },
  )
    .index({ channelId: 1, startedAt: -1 })
    .index({ invitedIds: 1, startedAt: -1 })
    .index({ "participants.userId": 1, startedAt: -1 }),
)

// AI notes for one stretch of a call: from when someone turns AI notes on until it is turned off or the call ends.
// Each person's app sends only their own microphone, so every line knows who said it. The audio is not kept.
export const CallNote = register(
  "CallNote",
  new Schema(
    {
      callId: { type: Schema.Types.ObjectId, ref: "Call", required: true },
      channelId: { type: Schema.Types.ObjectId, ref: "ChatChannel", required: true },
      media: { type: String, default: "audio" },
      startedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
      startedByName: String,
      stoppedBy: { type: Schema.Types.ObjectId, ref: "User" },
      stoppedByName: String,
      onAt: { type: Date, default: Date.now },
      offAt: Date,
      // Everyone in the call while notes were on.
      participants: [{ userId: { type: Schema.Types.ObjectId, ref: "User" }, name: String }],
      segments: [{ userId: { type: Schema.Types.ObjectId, ref: "User" }, name: String, at: Date, durationMs: Number, text: String }],
      // recording → writing → ready, or empty (nothing was heard) or failed.
      status: { type: String, default: "recording" },
      error: { type: String, default: "" },
      title: { type: String, default: "" },
      summary: { type: String, default: "" },
      keyPoints: [String],
      decisions: [String],
      actionItems: [{ task: String, owner: String, due: String }],
      failedChunks: { type: Number, default: 0 },
      transcribeModel: String,
      notesModel: String,
      messageId: { type: Schema.Types.ObjectId, ref: "ChatMessage" },
    },
    { timestamps: true },
  )
    .index({ callId: 1, onAt: 1 })
    .index({ "participants.userId": 1, onAt: -1 })
    .index({ status: 1 }),
)

export const ChatChannel = register(
  "ChatChannel",
  new Schema(
    {
      kind: { type: String, enum: ["general", "channel", "property", "direct"], required: true },
      name: { type: String, default: "" },
      topic: { type: String, default: "" },
      private: { type: Boolean, default: false },
      // Channels made after member lists arrived only include people who were added or joined. Older public
      // channels (no flag) still include everyone on the team.
      memberList: { type: Boolean, default: false },
      propertyId: { type: Schema.Types.ObjectId, ref: "Property" },
      memberIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      directKey: String,
      createdBy: { type: Schema.Types.ObjectId, ref: "User" },
      archivedAt: Date,
      lastMessageAt: Date,
    },
    { timestamps: true },
  )
    .index({ kind: 1 })
    .index({ propertyId: 1 }, { unique: true, partialFilterExpression: { kind: "property" } })
    .index({ directKey: 1 }, { unique: true, partialFilterExpression: { kind: "direct" } })
    .index({ kind: 1, name: 1 }, { unique: true, partialFilterExpression: { kind: "general" } }),
)

export const ChatMessage = register(
  "ChatMessage",
  new Schema(
    {
      channelId: { type: Schema.Types.ObjectId, ref: "ChatChannel", required: true },
      userId: { type: Schema.Types.ObjectId, ref: "User" },
      userName: String,
      kind: { type: String, default: "message" },
      text: { type: String, default: "" },
      parentId: { type: Schema.Types.ObjectId, ref: "ChatMessage" },
      replyCount: { type: Number, default: 0 },
      replyUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      lastReplyAt: Date,
      mentionIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      mentionsChannel: { type: Boolean, default: false },
      reactions: [{ emoji: String, userIds: [{ type: Schema.Types.ObjectId, ref: "User" }] }],
      attachments: [{ fileId: { type: Schema.Types.ObjectId, ref: "Document" }, name: String, mime: String, size: Number }],
      // kind "notes": the AI notes written after a call.
      noteId: { type: Schema.Types.ObjectId, ref: "CallNote" },
      editedAt: Date,
      deletedAt: Date,
    },
    { timestamps: true },
  )
    .index({ channelId: 1, parentId: 1, createdAt: -1 })
    .index({ parentId: 1, createdAt: 1 })
    .index({ mentionIds: 1, createdAt: -1 }),
)

// A chat message someone reported to the admins (with what it said then, in case it is edited or deleted later).
export const ChatReport = register(
  "ChatReport",
  new Schema(
    {
      messageId: { type: Schema.Types.ObjectId, ref: "ChatMessage", required: true },
      channelId: { type: Schema.Types.ObjectId, ref: "ChatChannel" },
      reporterId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      reporterName: String,
      authorId: { type: Schema.Types.ObjectId, ref: "User" },
      authorName: String,
      text: String,
      reason: String,
      status: { type: String, default: "Open" },
    },
    { timestamps: true },
  ).index({ messageId: 1, reporterId: 1 }),
)

export const ChatRead = register(
  "ChatRead",
  new Schema(
    {
      userId: { type: Schema.Types.ObjectId, ref: "User", required: true },
      channelId: { type: Schema.Types.ObjectId, ref: "ChatChannel", required: true },
      lastReadAt: Date,
      hidden: { type: Boolean, default: false },
    },
    { timestamps: true },
  ).index({ userId: 1, channelId: 1 }, { unique: true }),
)
