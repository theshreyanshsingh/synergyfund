# Talking with the Agent

The Agent can be talked with. On the Agent page (and in the phone sheet) **Talk** turns the composer into a voice
panel: you speak, the Agent answers aloud, and the chat fills in as it would for typed questions, with the full written
answer, its tables and its Confirm cards.

It is a port of Oscar, a voice agent built and measured separately (`~/Desktop/Oscar`). The server side is
`apps/api/src/services/agent/voice.js` and `apps/api/src/routes/voice.js`; the page side is
`apps/web/components/agent/useAgentVoice.js` and `AgentVoice.js`, with `apps/web/lib/turnDetector.js` and
`voicePlayer.js`.

## What happens in a turn

1. The page listens. When you stop speaking, it sends that turn as a recording to `POST /api/agent/voice/turn`.
2. The server starts three things at once: the turn is written down (for the chat and for later turns), a request
   decides where the turn goes, and the speech model starts on a reply of its own.
3. Where the turn goes:
   - **Small talk, thanks:** the speech model's own reply plays. About two seconds.
   - **"What can you do?":** a prepared line is said.
   - **Anything the records, the documents or the web would answer or do:** you hear "One moment, let me look that
     up", and the question is asked of the Agent exactly as a typed one is, with your permissions. A text model
     writes two or three sentences of its written answer, and the speech model says those word for word. The written
     answer is saved to the chat as usual.

The speech model is `openai/gpt-audio` through OpenRouter, the turn is written down by `deepgram/nova-3`, and the
short spoken version is written by `anthropic/claude-haiku-5.5` (`VOICE_WRITER_MODEL` changes that). The Agent's own
work runs on the task and decision models chosen in Settings → Agent.

## Rules

- **Nothing spoken saves a change.** A change, rename or team note the Agent prepares waits for a tap on its card,
  as in any chat. Saying "yes, confirm" does not confirm it.
- **Same permissions as typing.** The spoken question goes through the same Agent with the speaker's own
  permissions. People who cannot ask the Agent cannot talk to it.
- **Spending is counted.** Speech, deciding and writing down are recorded as "voice" in AI spending; the Agent's own
  work as "agent". Once the month's budget is used up, turns are refused.
- **The speech model is never shown the records.** It gets who it is, how it sounds, the chat so far as short text,
  and the line to say. Not the written answer, not a tool, not the team's notes.

## Voice and accent

Settings → Agent → Voice (admins): one of the speech model's thirteen voices and an accent. The default is Cedar
with an Indian accent. The voices have no accents of their own, so the model is asked for one; the wording and
placement of that request (`accentNote` and `accentReminder` in `voice.js`) were settled by measurement in Oscar and
should not be reworded without measuring again.

Measured here on 13 November 2026, on real replies judged by three listening models that were not told what to
expect:

- Lines the model is handed to say (the hello, "One moment", the answers, what it can do): Indian on 4 clips of 4.
- Its own replies to small talk: Indian on 4 of 5. The one that was not was a long answer to "what can you help me
  with", which is why that question now gets a prepared line.
- A first version of its instructions that named the person and described the company at more length lost the
  accent on 2 replies of 2. The instructions are now the ones measured in Oscar, word for word but for the name and
  what its two notes are about.

That is a small sample. Oscar's own figures for the same wording are 80 replies of 80.

## How long it takes

Measured on a test database with four made-up houses:

- The hello: at once (it is recorded once and kept).
- Small talk: speech starts about 1.5 seconds after the turn is sent.
- A question for the records: "One moment" starts after 1.5 to 3.5 seconds; the answer came after about 50 seconds,
  nearly all of it the Agent's own plan, look-up and answer steps. After 14 seconds the person is told once that it
  is still being worked on.

## On speakers and on headphones

On speakers the Agent's voice would leak back into the microphone and it would answer itself, so by default the
page does not listen while the Agent is speaking or working. With "I'm on headphones" ticked in the voice panel, you
can talk over it: it stops and takes what you say as the next turn.

## Not built

- Calling a phone number to reach the Agent.
- Confirming a change by voice.

## Trying it without touching real data

`apps/api/test/voice.test.js` runs the whole path against a stand-in for the model service and a throwaway database
(`npm test -w @synergifund/api`). To hear it, start the API on a throwaway MongoDB with only `OPENROUTER_API_KEY`
set, sign in, and use Talk on the Agent page.
