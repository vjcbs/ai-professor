# Case Partner

A voice-based case-study debate/quiz coach built on ElevenLabs Conversational
AI, grounded in the Neurovista case (Columbia CaseWorks) and its accompanying
course readings (Gans/Scott/Stern, Guzman lecture notes, Saffo's forecasting
rules).

Live demo: **https://ai-professor-zeta.vercel.app**

---

## What it does

The student picks a mode and talks to the agent out loud:

- **Debate mode** — state a thesis on Sun Yu's strategic bet with
  Neurovista; the agent personally argues the strongest opposing position
  and holds it under real pressure, pulling in course frameworks (S-curves,
  IP vs. speed vs. organizational advantage, Saffo's rules) rather than just
  restating case facts.
- **Quiz Me mode** — cold-call practice. The agent asks pointed questions,
  gives zero feedback while questioning, and only delivers its evaluation
  after 2-3 full rounds — closer to how a professor actually cold-calls in
  class than a hint-giving tutor would.

As the conversation progresses, a "thinking map" on the page lights up live
(thesis → evidence → tradeoffs → refine) as the agent recognizes the student
has actually reached each stage — not on a timer, not client-side guesswork,
but the agent itself deciding when a stage is genuinely satisfied. When the
session closes, a written recap appears automatically, and if the same
student returns for a second session, the agent greets them by name and
opens by referencing a specific gap from last time.

---

## Architecture

```
Browser (index.html)
  │  raw @elevenlabs/client SDK — no embeddable widget
  ▼
ElevenLabs Conversational AI agent ("Case Partner")
  │  system prompt + knowledge base (RAG) + tools
  ▼
Vercel serverless functions (api/*.js)
  │
  ▼
Couchbase Capella (Data API) — cross-session memory
```

### Frontend (`index.html`)

A single self-contained page, no framework, built directly against
`@elevenlabs/client` (not the pre-built `<elevenlabs-convai>` widget) so the
UI could be fully custom:

- `Conversation.startSession({ agentId, dynamicVariables, clientTools, ... })`
  starts the call; `onConnect` / `onDisconnect` / `onMessage` / `onModeChange`
  drive the UI state (live transcript, orb animation, mode lock while a call
  is active).
- `dynamicVariables: { user_name, mode }` passes the name typed into the
  header input and the selected mode (`debate` / `quiz`) into the agent's
  system prompt and tool calls at session start.
- A **client tool**, `update_thinking_map`, is registered in the
  `clientTools` object passed to `startSession`. The agent calls it
  server-side; ElevenLabs routes that call down to the browser, where the
  handler just toggles a CSS class on the matching thinking-map step. This
  is the mechanism that makes the sidebar react live to the actual
  conversation instead of a canned animation. (ElevenLabs' "Update state"
  system tool was tried first and doesn't work for this — it only touches
  internal conversation state and never reaches the client.)
- The recap card polls `/api/recap` every 2 seconds and renders whatever the
  agent's `send_case_recap` webhook last posted.

### ElevenLabs agent configuration

Configured via the ElevenLabs API (`agents_update`, `agents_create_tool`),
not the dashboard — the dashboard was found to silently fail to persist
changes during earlier iterations, so every change here is written via the
API and read back with `agents_get` to confirm.

- **System prompt** — branches on `{{mode}}` to run either Debate or Quiz
  Me instructions (they're written to feel sharply different, not two
  flavors of the same script), instructs the agent to call
  `getStudentContext` as its first action every session, and defines the
  4-tool closing sequence used once a session reaches a real synthesis
  point.
- **Knowledge base + RAG** — 5 documents (the Neurovista case, Gans/Scott/
  Stern, Guzman's lecture notes, Saffo, Garbuio & Lin) attached with
  `usage_mode: auto`, RAG enabled (`e5_mistral_7b_instruct` embeddings,
  max 5 chunks, 0.6 max vector distance). Every factual claim the agent
  makes about the case is required by the prompt to come from this KB, not
  invented.
- **Dynamic variables** — `{{mode}}` and `{{user_name}}`, set per-session
  from the frontend.
- **Tools** — six total, described below.

### Tools

| Tool | Type | Fires when | Backed by |
|---|---|---|---|
| `send_case_recap` | webhook | Session reaches a synthesis point | `POST /api/recap` (Couchbase-backed, polled by the page) |
| `update_thinking_map` | client | Each time a reasoning stage is genuinely reached | Browser-side `clientTools` handler |
| `getStudentContext` | webhook | Once, at the very start of every session | `POST /api/get-student-context` → Couchbase |
| `saveCaseAttempt` | webhook | Once the agent has a clear read on how the attempt went | `POST /api/save-case-attempt` → Couchbase |
| `updateLearningState` | webhook | When a recurring gap is worth flagging for next time | `POST /api/update-learning-state` → Couchbase |
| `createPrepBrief` | webhook | End of session, alongside the recap | `POST /api/create-prep-brief` → Couchbase |

`send_case_recap` is the third-party integration: it's a webhook tool
calling a self-hosted Vercel deployment, not just a URL like httpbin.org.
The last four are the cross-session memory layer (see below) — together
they demonstrate both tool-use patterns ElevenLabs supports (webhook and
client) plus a genuine external system in the loop.

### Why Couchbase

The core problem this app is solving is that a single practice session
doesn't build a skill — repetition does, and repetition only compounds if
each session knows what happened in the last one. Couchbase is the
persistence layer that makes that possible: it's what turns "one voice
conversation" into "a learning record that accumulates over time." A few
things specifically drive that choice, beyond just the welcome-back moment:

- **Structured signals, not a transcript dump.** Every session is broken
  down into the pieces that actually matter for coaching — thesis,
  evidence used, tradeoffs missed, a score, recurring gaps — and written as
  discrete fields rather than raw text. That's what makes it possible to
  reason over a student's history programmatically (e.g. "this gap keeps
  recurring") instead of re-reading a transcript every time.
- **A student profile that compounds across many sessions, not just two.**
  `student_profile.weak_areas` and `learning_state.recurring_gaps` merge
  and accumulate on every write (`save-case-attempt.js`, `Array.from(new
  Set([...]))`) — the memory isn't "session N vs. session N-1," it's a
  running profile that gets more accurate the more a student uses it.
- **Serverless-friendly by design.** The app runs as stateless Vercel
  functions with no server to hold state in between requests, so
  persistence has to live outside the process. Couchbase Capella's Data
  API (REST, key-value) was chosen specifically because it needs no
  connection pool to manage across cold starts, unlike the stateful
  Couchbase SDK.
- **Graceful degradation.** If Couchbase isn't configured or is
  unreachable, every endpoint fails soft (`isConfigured()` checks, try/
  catch around each call) and returns a "not configured" response instead
  of erroring — the live conversation, RAG, and thinking-map still work
  without memory, so a Couchbase outage degrades the experience rather
  than breaking it.

There's no login system in this demo — a student's typed name is their
identity, slugged into a document key (`lib/couchbase.js`). Four data
shapes are persisted via the Couchbase Capella Data API:

- `student_profile:{user_id}` — name, course, accumulated weak areas
- `case_attempt:{user_id}:{timestamp}` (+ a `_latest` mirror for O(1) lookup)
  — thesis, evidence used, tradeoffs missed, a rough score, per attempt
- `learning_state:{user_id}` — recurring gaps and what to challenge next
  session
- `prep_brief:{user_id}:{timestamp}` (+ a `_latest` mirror) — final
  recommendation, feedback, and a concrete next-practice prompt
- `latest_recap` — the most recent session recap, so the recap card
  survives a Vercel cold start instead of resetting to empty

`getStudentContext` reads `student_profile`, `learning_state`, and the
latest `case_attempt` in parallel at session start; the system prompt
instructs the agent to open with a specific callback ("Welcome back, Vani —
last time you made a strong market-size argument but didn't address the
regulatory risk...") rather than a generic greeting. The other three tools
write to this store as a session closes out.

---

## Repo layout

```
index.html                    Custom frontend (SDK, UI, thinking-map wiring)
lib/couchbase.js               Couchbase Capella Data API helper
api/recap.js                   Backs send_case_recap (Couchbase-backed, with an in-memory fallback)
api/get-student-context.js     Backs getStudentContext
api/save-case-attempt.js       Backs saveCaseAttempt
api/update-learning-state.js   Backs updateLearningState
api/create-prep-brief.js       Backs createPrepBrief
```

## Run locally

This is a zero-build static page (`index.html`) plus Vercel serverless
functions in `api/` — there's no bundler, no framework, and no
`package.json` to install. The Vercel CLI is the easiest way to run both
together locally, since it emulates the serverless functions the same way
production does.

1. Install the Vercel CLI if you don't already have it:
   ```
   npm i -g vercel
   ```
2. From the repo root, set your Couchbase credentials as local env vars,
   either:
   - by pulling them from the deployed Vercel project (if this repo is
     already linked to one):
     ```
     vercel link
     vercel env pull .env.local
     ```
   - or by creating `.env.local` yourself:
     ```
     COUCHBASE_ENDPOINT=https://cb-xxxxxxxx.data.cloud.couchbase.com
     COUCHBASE_USERNAME=your-capella-database-username
     COUCHBASE_PASSWORD=your-capella-database-password
     ```
   Without these, the app still runs — the memory/recap endpoints just
   return "not configured" instead of erroring (see Cross-session memory
   above), so you can preview the UI without a Couchbase cluster.
3. Start the dev server from the repo root:
   ```
   vercel dev
   ```
4. Open the local URL it prints (usually `http://localhost:3000`).
5. Type a name, pick a mode, and start speaking. The page talks directly to
   the live ElevenLabs agent (`agent_5801m1w335epekzvayexhg7cpxes`,
   hardcoded in `index.html`) — no local agent setup is needed. Only the
   backend memory/recap endpoints (`api/*.js`) run locally; everything
   voice-related still goes over the network to ElevenLabs.

**Important:** Couchbase Capella must be running (not paused) for the
memory and recap tools to work, whether you're running locally or against
the deployed site — a paused cluster makes every Couchbase call fail and
the endpoints silently fall back to "not configured" / in-memory behavior.

## Deploy

1. Push this repo to GitHub, connect it to a Vercel project (auto-detects
   `api/` as serverless functions, serves `index.html` at the root — no
   build config needed).
2. In Vercel → Settings → Environments → Production, add:
   `COUCHBASE_ENDPOINT`, `COUCHBASE_USERNAME`, `COUCHBASE_PASSWORD`, and
   optionally `COUCHBASE_BUCKET` (defaults to `case_partner`, `_default`
   scope/collection).
3. In the ElevenLabs agent, point `send_case_recap` and the four memory
   tools' webhook URLs at your deployed domain.
4. Redeploy after adding env vars — they only apply to deployments made
   after they're saved.

## Golden demo path

1. Open the page, type a name, pick **Quiz Me** or **Debate**, start
   speaking.
2. State a thesis (or answer the cold-call question) — watch the "thesis"
   step light up on the thinking map as the agent recognizes it.
3. Push back and forth for a few turns — evidence and tradeoffs light up as
   they're genuinely reached, not on a script.
4. Let the agent synthesize; the recap appears on the page within seconds.
5. End the call, reload with the **same name**, and start a new session —
   the agent should open by referencing a specific gap from the last one.
