import mongoose from "mongoose"

const { Schema, model, models } = mongoose

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
      role: { type: String, required: true },
      title: String,
      company: { type: String, default: "SynergiFund" },
      extraPermissions: [String],
      deniedPermissions: [String],
      propertyIds: [{ type: Schema.Types.ObjectId, ref: "Property" }],
      overviewOrder: [String],
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
      marketRent: Number,
      actualRent: Number,
      rentStatus: String,
      rentMarket: String,
      rentNotes: String,
      customerTerms: String,
      rehabBudget: Number,
      rehabRemaining: Number,
      labels: [String],
      scopeLines: [
        {
          title: String,
          description: String,
          budget: Number,
          status: { type: String, default: "Not started" },
        },
      ],
      assignedUserIds: [{ type: Schema.Types.ObjectId, ref: "User" }],
      importSource: sourceSchema,
      updatedBy: String,
    },
    { timestamps: true },
  ),
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
      label: { type: String, default: "Financed" },
      terms: { type: String, default: "" },
      loanNumber: String,
      balance: Number,
      payment: Number,
      paymentDay: Number,
      maturity: String,
      termsStatus: { type: String, default: "Needs verification" },
      originalAmount: Number,
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
      kind: { type: String, default: "file" },
      versionGroup: String,
      version: { type: Number, default: 1 },
      uploadedBy: { type: Schema.Types.ObjectId, ref: "User" },
    },
    { timestamps: true },
  ),
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
      notes: String,
      reviewId: { type: Schema.Types.ObjectId, ref: "ReviewItem" },
    },
    { timestamps: true },
  ),
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
      messages: [
        {
          role: String,
          content: String,
          sources: [Schema.Types.Mixed],
          toolCalls: [{ tool: String, args: Schema.Types.Mixed, result: Schema.Types.Mixed }],
          todos: [{ id: String, content: String, status: String }],
          models: { task: String, decision: String },
          usage: { promptTokens: Number, completionTokens: Number, totalTokens: Number, calls: Number },
          agentRunDurationMs: { type: Number, default: null },
          error: { type: Boolean, default: false },
          at: { type: Date, default: Date.now },
        },
      ],
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
      updatedBy: String,
    },
    { timestamps: true },
  ),
)

export const ChatChannel = register(
  "ChatChannel",
  new Schema(
    {
      kind: { type: String, enum: ["general", "channel", "property", "direct"], required: true },
      name: { type: String, default: "" },
      topic: { type: String, default: "" },
      private: { type: Boolean, default: false },
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
      editedAt: Date,
      deletedAt: Date,
    },
    { timestamps: true },
  )
    .index({ channelId: 1, parentId: 1, createdAt: -1 })
    .index({ parentId: 1, createdAt: 1 })
    .index({ mentionIds: 1, createdAt: -1 }),
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
