# Talking with the Agent

The Agent can be talked with. On the Agent page (and in the phone sheet) **Talk** turns the composer into a voice
panel: you speak, the Agent answers aloud, and the chat fills in as it would for typed questions, with the full written
answer, its tables and its Confirm cards.

In a new chat the panel is the Agent's circle with the page to itself. Once there are messages it is a bar where the
box was: the circle, a line for what the Agent is doing, a line for what it is saying, and three round controls
(Mute, Stop, End) like a call's. The circle swells with whoever is speaking, turns fast with an arc round it while the
Agent works, and sends out rings while it speaks; tapping it stops an answer, and so does speaking over it.

It is a port of Oscar, a voice agent built and measured separately (`~/Desktop/Oscar`). The server side is
`apps/api/src/services/agent/voice.js` and `apps/api/src/routes/voice.js`; the page side is
`apps/web/components/agent/useAgentVoice.js` and `AgentVoice.js`, with `apps/web/lib/turnDetector.js` and
`voicePlayer.js`.

## What happens in a turn

1. The page listens. When you stop speaking, it sends that turn as a recording to `POST /api/agent/voice/turn`.
   What you said shows in the chat as your message as soon as it is written down, with the Agent at work under it.
2. The server starts three things at once: the turn is written down (for the chat and for later turns), a request
   decides where the turn goes, and the speech model starts on a reply of its own.
3. Where the turn goes:
   - **Small talk, thanks:** the speech model's own reply plays. About two seconds.
   - **"What can you do?":** a prepared line is said.
   - **Anything the records, the documents or the web would answer or do:** you hear "One moment, let me look that
     up", and the question is asked of the Agent exactly as a typed one is, with your permissions. A text model
     writes two or three sentences of its written answer, and the speech model says those word for word. The written
     answer is saved to the chat as usual, and shows there (the page is sent `saved`) while the short version is
     still being said.

The speech model is `openai/gpt-audio` through OpenRouter, the turn is written down by `deepgram/nova-3`, and the
short spoken version is written by `anthropic/claude-haiku-5.5` (`VOICE_WRITER_MODEL` changes that). The Agent's own
work runs on the task and decision models chosen in Settings → Agent.

## A pause is not always the end of a turn

A turn ends after 0.8 seconds of silence. Until the Agent has started on an answer (about a second and a half more)
the microphone stays open, and someone who goes on talking gets their turn back: the upload is cancelled, nothing of
it is kept or looked up, and the turn goes again with what they add. A turn is taken back twice at most, so a noisy
room cannot keep it from being answered; after that the Agent answers what it has.

The page stops taking a turn back once it has seen where the turn went (the `route` event), and its cancellation
can cross with that event on the way. So the server keeps nothing and looks nothing up for 0.6 seconds after it
sends `route` (`PATIENCE.takeBack`), and drops the turn if the person has gone by then. The hold line is not held up
by this. Once that moment has passed, a question for the records is the Agent's: its answer is written to the chat
even if the person stops listening.

A step further was tried and left out: having the deciding model say when a turn broke off mid-sentence, so the Agent
would wait a few seconds more. On 14 November 2026, on recorded phrases, it caught 7 of 8 that broke off, but also
held back 7 of 12 complete short ones ("Who should I send it to?", "Go ahead.", "Jacksonville."); a second wording
held back 6 of 12 and caught only 4 of 8. A wrong wait would cost the person several seconds each time.

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
with an Australian accent. The voices have no accents of their own, so the model is asked for one; the wording and
placement of that request (`accentNote` and `accentReminder` in `voice.js`) were settled by measurement in Oscar and
should not be reworded without measuring again.

Measured here on real replies judged by three listening models that were not told what to expect.

With the Australian accent (the default), on 14 November 2026: 8 recordings of 8 were judged Australian by at least
two of the three (the third heard British on three short ones, and one heard New Zealand once). Three were lines the
model was handed (the hello, what it can do, and "One moment" with a looked-up answer); five were its own replies to
small talk.

With the Indian accent, on 13 November 2026:

- Lines the model is handed to say (the hello, "One moment", the answers, what it can do): Indian on 4 clips of 4.
- Its own replies to small talk: Indian on 4 of 5. The one that was not was a long answer to "what can you help me
  with", which is why that question now gets a prepared line.
- A first version of its instructions that named the person and described the company at more length lost the
  accent on 2 replies of 2. The instructions are now the ones measured in Oscar, word for word but for the name and
  what its two notes are about.

These are small samples. Oscar's own figures for the same wording, with the Indian accent, are 80 replies of 80.

## How long it takes

Measured on a test database with four made-up houses:

- The hello: at once (it is recorded once and kept).
- Small talk: speech starts about 1.5 seconds after the turn is sent.
- A question for the records: "One moment" starts after 1.5 to 3.5 seconds; the answer came after about 50 seconds,
  nearly all of it the Agent's own plan, look-up and answer steps. After 14 seconds the person is told once that it
  is still being worked on.

## Talking over the Agent

The microphone stays open all the time, as on a call. Speaking over the Agent stops it, and what is said is the next
turn: during its hello, during a reply of its own, and during a looked-up answer from 0.8 seconds after the question
was handed over (the server keeps the question from 0.6 seconds on, so it is still answered in writing), also while
it works on that answer in silence (there it stops within about a fifth of a second). Mute shuts the microphone for a
while.

On loudspeakers the Agent's own voice comes back in through the microphone. The browser's echo canceller takes most
of it out, but how much is left differs from device to device, so the page does not rely on it
(`apps/web/lib/bargeIn.js`):

- It learns how much of the Agent's voice reaches the microphone (while the hello plays, then whenever the Agent
  speaks and nobody else does) and takes sound up to a margin above that for echo, not speech.
- Sound far above that is plainly a person: the Agent stops within about a fifth of a second.
- Sound only a little above it makes the player turn the Agent's voice down for about half a second. An echo falls
  with it; a person's voice does not. Then the Agent is stopped, or its voice comes back up. If the Agent's voice
  ends during that check (the hold line is short), what follows decides: someone still speaking once it has died
  away stops it, and quiet means it was the echo.
- It stops the Agent without that check only once the echo has looked steady for half a second of the Agent's
  speech, so turning the volume up between answers costs a check, not a wrong stop.
- If what stopped the Agent falls silent the moment the Agent does, it was the Agent's own voice: the recording is
  thrown away, and it has learned that the echo can be that loud.
- Sound that starts while the Agent's voice can be heard is never sent as a turn unless a person is confirmed (it
  stopped the Agent, or went on in a quiet moment).

Checked on made-up sound (`apps/web/lib/bargeIn.js` has no browser parts): five minutes of the Agent alone never
stopped it with no echo, a good or poor echo canceller, or none at all, with the echo up to a quarter of a second
late; the volume turned up sixteen times between answers or mid-answer cost at most one stop, known to be mistaken.
In a browser with a simulated loudspeaker echo (14 November 2026), speaking over the Agent stopped it about a
quarter of a second after the speech began, over its hello, its own replies and looked-up answers, and the Agent
never stopped itself with the echo steady, turned up between answers or mid-answer, or arriving a quarter of a
second late.

The limits: on loudspeakers with no echo cancelling at all, a person has to speak clearly louder than the Agent's
voice sounds at the microphone; only a little louder, it stopped the Agent in 3 of 5 runs. Stop always works. And on
made-up sound, the volume turned up a great deal just before an answer made it stop itself once in about a hundred
tries, after which it had learned.

## Turning it off

Settings → Agent → Voice has "People can talk with the Agent" (admins). Off, the Talk button is gone for everyone
and the voice routes refuse; the voice and accent chosen are kept for when it is turned on again.

## Not built

- Calling a phone number to reach the Agent.
- Confirming a change by voice.

## Trying it without touching real data

`apps/api/test/voice.test.js` runs the whole path against a stand-in for the model service and a throwaway database
(`npm test -w @synergifund/api`). To hear it, start the API on a throwaway MongoDB with only `OPENROUTER_API_KEY`
set, sign in, and use Talk on the Agent page.
