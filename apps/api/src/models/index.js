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
      // The call ringtone and message chime this person picked in Settings.
      sounds: { ringtone: String, chime: String },
      // The AI teammate's account: it posts in property chats, never signs in, and gets no notifications.
      bot: { type: Boolean, default: false },
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
      rehabRemaining: Number,
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
    },
    { timestamps: true },
  ),
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
      status: { type: String, default: "Current" },
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
      // A temporary chat is never listed in History. MongoDB removes it once `expiresAt` passes.
      temporary: { type: Boolean, default: false },
      expiresAt: { type: Date, default: undefined },
    },
    { timestamps: true },
  ).index({ expiresAt: 1 }, { expireAfterSeconds: 0 }),
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
      updatedBy: String,
    },
    { timestamps: true },
  ),
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
