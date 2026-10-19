import { chatTitleFromPrompt } from "@synergifund/shared"
import { chat, createUsageTracker } from "./llm.js"
import { StreamProcessor, createRun } from "./stream.js"
import { clientResult, executeTool, toolContent, toolSpecs, toolsFor } from "./tools.js"

const HISTORY_MESSAGES = 10
const MAX_GATHER_STEPS = 12
const MAX_TODO_NUDGES = 2
const MAX_FOLLOW_UPS = 1
const EVIDENCE_LIMIT = 80000
// An ARV reads several listing pages, so a run may take a few minutes.
const RUN_DEADLINE_MS = 6 * 60 * 1000
const TITLE_UNTIL_PROMPTS = 3
const KEEP_FULL_RESULTS = 6
const COMPACT_RESULT_CHARS = 1200

const FOLLOW_UP_TOOL = {
  type: "function",
  function: {
    name: "request_more_data",
    description: "Ask the data step for more lookups before answering. Use it only when the evidence cannot answer the question and specific lookups would. You can use it once.",
    parameters: {
      type: "object",
      properties: {
        reason: { type: "string", description: "What is missing." },
        steps: { type: "array", items: { type: "string" }, description: "One to four specific lookups, for example \"Read the Zillow 32209 newest listings page and extract price, beds, baths\"." },
      },
      required: ["steps"],
    },
  },
}

function today() {
  return new Date().toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" })
}

function describeTools(tools) {
  return tools.filter((tool) => tool.name !== "todo_write").map((tool) => `- ${tool.name}: ${tool.description}`).join("\n")
}

function who(user) {
  return `${user.name} (${user.role})`
}

// Emails and other writing come back in fenced blocks; the Agent page shows them as a draft card with Copy and
// Send via Gmail / Outlook / the email app, which opens a prefilled compose window. Nothing is ever sent from here.
function writingRules(user) {
  const signature = [user.name, user.title, user.company || "SynergiFund"].filter(Boolean).join("\n")
  return `Writing for the person (emails, text messages, chat messages, letters, notes):
- Put an email in a fenced code block with the language email. First line "To: " and the recipient's email address (several are separated by commas). Leave it empty after "To: " when the address is not in the evidence or the request; never make one up. Second line "Subject: " and a short, specific subject. Then one blank line, then the body as plain text with no markdown. For example:
\`\`\`email
To: jane@example.com
Subject: Draw 3 for 2319 College Street

Hi Jane,

...

Thanks,
${signature}
\`\`\`
- Put any other writing in a fenced code block with the language draft, as plain text.
- Write as ${user.name}, in the first person: warm, professional and to the point. Sign emails with the signature above, exactly as written. Text and chat messages need no signature.
- Use the real names, addresses, dates and dollar amounts from the evidence. Never leave placeholders such as [Name], [Date] or XX. If a fact is missing, write around it and say after the block what you left out.
- Before the block write one short sentence at most. After it add nothing, unless you must say what is missing or give a download link (on a line of its own). Never put a download link inside an email or draft: the person downloads the file and attaches it. Never say it was sent: the person reviews it and sends it.
- When asked to change a draft from earlier in this chat, write the whole new version in a new block.`
}

function planPrompt(user, tools, webAllowed) {
  return `You are the SynergiFund agent, the analyst for a private real estate investment company that buys, renovates, rents, refinances and sells houses.
Today is ${today()}. You are answering ${who(user)}. You read company records${webAllowed ? " and you can search the public web" : ""}. You never change anything.
Earlier replies in this chat may describe limits that no longer apply. Trust only the lookups listed below.

Your job in this step is to decide how to answer.
- If the question needs company records or public facts, call todo_write once with a short plan of 1 to 5 steps. Each step names what to find out and where, for example "Find the loans on 876 Fields Rd" or "Search Zillow, Realtor and Redfin for homes listed this week in Jacksonville FL 32209". Correct obvious misspellings of places and names in the steps. Do not answer yet.
${webAllowed
    ? "- Questions about listings for sale or rent, market rents, comparable sales, neighborhoods, tax rates, insurance, news, or anything else outside the company records need web steps. Never say you cannot browse the web."
    : "- Web search is not connected in this workspace. If the person asks for something only the web has, reply that web search is not connected yet and an admin can connect it in Settings, and offer what the company records can show instead."}
- If the person wants an ARV (after repair value), comps, what a house would sell for once renovated, or a maximum offer, plan two steps: get the subject's square footage, bedrooms, bathrooms, ZIP and rehab budget (get_property when it is in the records, otherwise its listing on the web); then run arv_analysis, which finds and checks the sold comps itself.${webAllowed ? "" : " Without web search, say comps cannot be looked up yet and offer to run arv_analysis on comps the person pastes in."}
- If the person wants documents gathered, collected, bundled, zipped or downloaded (for example "zip the closing docs for 3318 Nolan"), plan two steps: find the documents, then zip them.
- If the person wants an email, message, letter or note written (or a reply, or a change to an earlier draft) and it is about a property, loan, lender, draw, payment, task, document or a person on the team, plan steps to look up those facts first, plus a step to find the recipient's email address with list_team when they are on the team. If it needs no records, write it now by the writing rules below and do not call a tool.
- If the message is a greeting, a thank you, or something you can answer without any data, reply in one or two plain sentences and do not call a tool.
- If the question is too vague to look anything up, ask one short clarifying question and do not call a tool.

These are the lookups the next step can make for this person:
${describeTools(tools)}

${writingRules(user)}`
}

function gatherPrompt(user, webAllowed) {
  return `You are the data step of the SynergiFund agent. Today is ${today()}. You are working for ${who(user)} and you can only see what this person is allowed to see.

Gather the facts needed to answer the question by calling tools. Do not write the final answer.

How to work:
- Follow the plan. Mark a step in_progress with todo_write when you start it and completed once you have the facts. Send the whole list each time.
- Make independent lookups in the same turn. They run at the same time.
- Repeating a lookup with the same arguments returns the same result, so change the arguments instead.

Gathering documents:
- Use find_documents with the property, company, folder, words and dates the person gave. If it shows fewer than its total, call it again with a higher limit (up to 150) before zipping. If it finds the right files, call zip_documents with their ids (all of them, up to 150) and a short descriptive name. If it finds nothing, try once with fewer filters.

Working out an ARV (after repair value):
- The subject: get_property gives its square footage, beds, baths, ZIP (in its city) and rehab budget. If it is not in the records or a fact is missing, find its listing (web_search with sites ["zillow.com", "redfin.com", "realtor.com"]) and read it for beds, baths, square feet, ZIP, list price and home type.
- Then call arv_analysis with the property (or the subject's address, ZIP, beds, baths and sq ft). It finds the sold comps on Redfin itself, checks each one by the team's rules and does the math, which takes about a minute. Do not search for comps yourself first, and only pass comps when the person gave specific ones.

Searching company records:
- When you are not sure where something lives or a name may be misspelled, start with search_records, then open the match with get_property or the specific list tool.
- Use get_property for one house and list_* tools for many. If a tool says a name matches several properties, pick the closest candidate.
${webAllowed
    ? `Searching the web (Firecrawl):
- Write specific queries with the city, state and ZIP code. Fix spelling in place names first.
- For listings use sites such as ["zillow.com", "realtor.com", "redfin.com"]. For rents add "rent" or use ["zillow.com", "apartments.com", "rentometer.com"]. For taxes and assessments search the county property appraiser or tax collector site.
- Use recency "week" or "month" when the person asks for new or recent items, and news true for current events.
- Each result already includes page text. If the text does not have the details, open the best one or two results with read_webpage and pass extract describing exactly the fields you need, for example "every listing with address, price, beds, baths, square feet, days on market and URL".
- If a search returns nothing useful, try once more with different words or different sites. Use at most six web calls per plan step.
- Prefer primary sources such as the listing site, the county site or the lender's own site. Never put private figures from the records, such as balances or prices, in a query.`
    : "- Web search is turned off. Work only from the records."}

When every step is completed or cancelled, reply with a few plain lines: what you found, where it came from, and what is still missing.`
}

function answerPrompt(user, canFollowUp) {
  return `You are the SynergiFund agent, the analyst for a private real estate investment company. Today is ${today()}. You are answering ${who(user)}.

Write the answer to the person's question using only the evidence below. Rules:
- Use only numbers and facts that appear in the evidence. Never estimate a figure that is not there. If something is missing, say so plainly and say what would fill it.
- Lead with the direct answer in one or two sentences, then the supporting detail.
- Use US dollars with thousands separators, and dates like Oct 8, 2026.
- Use a short markdown table when comparing three or more properties, listings, loans or payments. Use bullets for short lists. Keep it tight.
- Facts from web_search or read_webpage are public information, not company records. Say they are from the web and link each source inline as a markdown link.
- When the person asks what to do, give a clear recommendation and the reason, based on the evidence.
- Never show JSON, tool names or ids. You cannot change records; if asked to, say which page in SynergiFund does it.
- When zip_documents made a download, give its link exactly as written in its instructions (a markdown link) on a line of its own, and list what is in it briefly. The page shows the link as a download button at the very end of the answer, so never say "above" or "below" about it. Never make up a link.
- When the person asked for an email, message, letter or note, the draft is the answer: follow the writing rules below.
- When arv_analysis ran, use its numbers exactly and never work out an ARV or offer yourself. When it searched for comps, say they are sold houses from Redfin for that ZIP (public web data, not company records). Lead with the ARV and the maximum offer with its formula (ARV x 0.70 - renovation estimate), saying where the renovation estimate came from. When there is no renovation estimate, give the offer before repairs (offerBeforeRepairs, ARV x 0.70) and say to type the renovation estimate into the card to get the maximum offer. When there is a purchase or list price, say how it compares with the maximum offer (purchaseGap or listGap: above means it costs more than the maximum offer). Then a few short bullets: which comps were used and any adjustment, which were skipped and why, and any comp it flagged to check. If it found fewer than 3 usable comps, say the ARV is not reliable yet, what it searched (its summary says), and which skipped comps are worth a second look. Do not repeat the full comp table or the math: the page shows them in an ARV card under your answer, with buttons to copy the comp log and save it to the property.${canFollowUp ? "\n- If the evidence clearly cannot answer the question and specific lookups would, call request_more_data once with those steps instead of answering. Otherwise answer now." : ""}

${writingRules(user)}`
}

function historyMessages(thread) {
  return thread.messages
    .slice(0, -1)
    .slice(-HISTORY_MESSAGES)
    .filter((message) => message.content && !message.error)
    .map((message) => ({ role: message.role === "user" ? "user" : "assistant", content: message.content }))
}

function compactOlderResults(messages) {
  const results = messages.filter((message) => message.role === "tool")
  for (const message of results.slice(0, -KEEP_FULL_RESULTS)) {
    if (message.compacted || message.content.length <= COMPACT_RESULT_CHARS) continue
    message.content = `${message.content.slice(0, COMPACT_RESULT_CHARS)}… [shortened to save space; the full result is kept for the final answer]`
    message.compacted = true
  }
}

// Zips go first so their download link is never the part cut for length; a lookup too long to fit is left out
// without dropping the smaller ones after it.
function evidenceText(evidence) {
  let text = ""
  let skipped = 0
  const ordered = [...evidence.filter((item) => item.tool === "zip_documents"), ...evidence.filter((item) => item.tool !== "zip_documents")]
  for (const item of ordered) {
    const block = `### ${item.tool} ${JSON.stringify(item.args)}\n${toolContent(item.tool, item.result)}\n\n`
    if (text.length + block.length > EVIDENCE_LIMIT) {
      skipped += 1
      continue
    }
    text += block
  }
  if (skipped) text += `### ${skipped} more ${skipped === 1 ? "lookup was" : "lookups were"} made but left out for length.\n`
  return text || "No records were looked up."
}

async function chatTitle({ prompts, model, tracker }) {
  const fallback = chatTitleFromPrompt(prompts[0])
  try {
    const response = await chat({
      model,
      tracker,
      temperature: 0.7,
      maxTokens: 400,
      messages: [
        { role: "system", content: "You are a helpful assistant that creates descriptive chat names. Reply with only the chat name, no explanations." },
        {
          role: "user",
          content: `Generate a descriptive chat name based on what the user is trying to accomplish. Their messages so far, in order:\n${prompts.map((text, index) => `${index + 1}. "${text.slice(0, 400)}"`).join("\n")}\nIgnore greetings and fix obvious spelling mistakes in names and places. Requirements: 3 to 7 words.\nReply with ONLY the chat name, nothing else.`,
        },
      ],
    })
    const name = response.content.replace(/["'`*#]/g, "").split("\n")[0].trim().split(/\s+/).slice(0, 7).join(" ")
    return name || fallback
  } catch {
    return fallback
  }
}

export async function runAgent({ user, permissions, thread, prompt, res, settings }) {
  const run = createRun({ ownerId: user._id })
  const stream = new StreamProcessor(res, run.runId)
  stream.start()
  const startedAt = Date.now()
  const deadline = startedAt + RUN_DEADLINE_MS
  const tracker = createUsageTracker()
  const context = { user, permissions, settings, todos: [], cache: {} }
  const tools = toolsFor(context)
  const plannerTools = tools.filter((tool) => tool.name === "todo_write")
  const webAllowed = tools.some((tool) => tool.web)
  const history = historyMessages(thread)
  const toolCalls = []
  const evidence = []
  const results = new Map()
  let statusCount = 0

  const status = (title) => {
    statusCount += 1
    stream.sendToolResult("status", { success: true, title, step: statusCount })
  }
  const record = (tool, args, result) => {
    const shown = clientResult(tool, args, result)
    toolCalls.push({ tool: tool?.name || "unknown", args, result: shown })
    stream.sendToolResult(tool?.name || "unknown", shown)
  }
  const runTool = async (call) => {
    const tool = tools.find((item) => item.name === call.name)
    const key = call.name === "todo_write" ? "" : `${call.name}:${call.arguments}`
    if (key && results.has(key)) return { call, outcome: results.get(key), repeated: true }
    const outcome = await executeTool(call, tools, context)
    if (key) results.set(key, outcome)
    record(tool || { name: call.name }, outcome.args, outcome.result)
    if (call.name !== "todo_write") evidence.push({ tool: call.name, args: outcome.args, result: outcome.result })
    return { call, outcome, repeated: false }
  }

  const gatherMessages = [{ role: "system", content: gatherPrompt(user, webAllowed) }, ...history]
  const gather = async (instruction) => {
    gatherMessages.push({ role: "user", content: instruction })
    let notes = ""
    let nudges = 0
    for (let step = 0; step < MAX_GATHER_STEPS; step += 1) {
      if (Date.now() > deadline) {
        notes = "Stopped early because the time limit was reached."
        break
      }
      status(step === 0 ? "Choosing what to look up" : "Reviewing what I found")
      compactOlderResults(gatherMessages)
      const response = await chat({
        model: settings.taskModel,
        tracker,
        messages: gatherMessages.map(({ compacted, ...message }) => message),
        tools: toolSpecs(tools),
        maxTokens: 3000,
      })
      if (!response.toolCalls.length) {
        const pending = context.todos.filter((todo) => todo.status === "pending" || todo.status === "in_progress")
        if (pending.length && nudges < MAX_TODO_NUDGES) {
          nudges += 1
          gatherMessages.push({ role: "assistant", content: response.content || "" })
          gatherMessages.push({ role: "user", content: `You have ${pending.length} incomplete steps (pending + in_progress): ${pending.map((todo) => todo.content).join("; ")}. Gather them, or mark them cancelled with todo_write if they cannot be answered.` })
          continue
        }
        notes = response.content.trim()
        gatherMessages.push({ role: "assistant", content: notes })
        break
      }
      gatherMessages.push({
        role: "assistant",
        content: response.content || "",
        tool_calls: response.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: call.arguments } })),
      })
      const planning = response.toolCalls.filter((call) => call.name === "todo_write")
      const lookups = response.toolCalls.filter((call) => call.name !== "todo_write")
      const done = []
      for (const call of planning) done.push(await runTool(call))
      done.push(...(await Promise.all(lookups.map(runTool))))
      for (const call of response.toolCalls) {
        const item = done.find((entry) => entry.call === call)
        const content = toolContent(call.name, item.outcome.result)
        gatherMessages.push({ role: "tool", tool_call_id: call.id, content: item.repeated ? `Same lookup as before. ${content}` : content })
      }
    }
    return notes
  }

  let answer = ""
  let failed = false

  try {
    status("Understanding the question")
    const plan = await chat({
      model: settings.decisionModel,
      tracker,
      maxTokens: 1500,
      messages: [{ role: "system", content: planPrompt(user, tools, webAllowed) }, ...history, { role: "user", content: prompt }],
      tools: toolSpecs(plannerTools),
    })
    const planCall = plan.toolCalls.find((call) => call.name === "todo_write")
    if (!planCall) {
      answer = plan.content.trim() || "Could you tell me a little more about what you want to know?"
    } else {
      await runTool(planCall)
      const notes = [await gather(`Current user request - ${prompt}\nPlan - ${JSON.stringify(context.todos)}`)]

      for (let round = 0; round <= MAX_FOLLOW_UPS; round += 1) {
        const canFollowUp = round < MAX_FOLLOW_UPS && Date.now() < deadline
        status(round === 0 ? "Writing the answer" : "Writing the answer with the new findings")
        const final = await chat({
          model: settings.decisionModel,
          tracker,
          temperature: 0.3,
          maxTokens: 5000,
          tools: canFollowUp ? [FOLLOW_UP_TOOL] : undefined,
          messages: [
            { role: "system", content: answerPrompt(user, canFollowUp) },
            ...history,
            {
              role: "user",
              content: `Question - ${prompt}\n\nPlan - ${JSON.stringify(context.todos)}\n\nNotes from the data step - ${notes.filter(Boolean).join("\n") || "none"}\n\nEvidence:\n${evidenceText(evidence)}`,
            },
          ],
        })
        const followUp = canFollowUp ? final.toolCalls.find((call) => call.name === "request_more_data") : null
        let steps = []
        if (followUp) {
          try {
            steps = (JSON.parse(followUp.arguments || "{}").steps || []).map((step) => String(step).trim()).filter(Boolean).slice(0, 4)
          } catch {}
        }
        if (!steps.length) {
          answer = final.content.trim() || "I could not write an answer from what I found. Try asking about one property or one lender at a time."
          break
        }
        const extra = steps.map((content, index) => ({ id: `f${round + 1}-${index + 1}`, content, status: "pending" }))
        await runTool({ id: `follow-${round}`, name: "todo_write", arguments: JSON.stringify({ todos: [...context.todos, ...extra] }) })
        status("Looking up a few more things")
        notes.push(await gather(`The reviewer needs more before answering. Do these steps: ${steps.join("; ")}`))
      }
    }
    stream.send({ u_msg: answer, role: "assistant", final: true })
  } catch (error) {
    failed = true
    answer = `Error: ${error.message}`
    stream.sendError(error.message)
  }

  const durationMs = Date.now() - startedAt
  if (tracker.totalTokens > 0) stream.send({ tokenUsage: { totalTokens: tracker.totalTokens } })
  thread.messages.push({
    role: "assistant",
    content: answer,
    toolCalls,
    todos: context.todos,
    models: { task: settings.taskModel, decision: settings.decisionModel },
    usage: { ...tracker },
    agentRunDurationMs: durationMs,
    error: failed,
  })
  try {
    await thread.save()
  } catch (error) {
    console.error("Agent thread save failed", error)
  }
  stream.end()

  const prompts = thread.messages.filter((message) => message.role === "user").map((message) => message.content)
  if (!failed && prompts.length <= TITLE_UNTIL_PROMPTS) {
    try {
      thread.title = await chatTitle({ prompts, model: settings.taskModel, tracker: createUsageTracker() })
      await thread.save()
    } catch (error) {
      console.error("Agent title save failed", error)
    }
  }
}
