# Plan 002: Add scheduled fight-card previews and results recaps via Cron Triggers

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0e964c2..HEAD -- src/index.ts src/agent.ts src/espn.ts src/tools/events.ts wrangler.jsonc test/`
> Plan 001 is EXPECTED to have changed `src/espn.ts`, `src/tools/events.ts`, and `test/` —
> that is not drift. For the other files, compare the "Current state" excerpts
> against the live code before proceeding; on a mismatch, treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED (posts to a real Slack channel on a timer; misconfiguration is publicly visible in the workspace)
- **Depends on**: plans/001-expose-fight-results-in-lookup-events.md
- **Category**: direction
- **Planned at**: commit `0e964c2`, 2026-07-07
- **Issue**: https://github.com/tmatti/gu/issues/10

## Why this matters

This repo is "gu", a Slack MMA-analyst bot on Cloudflare Workers. Today it is purely reactive — it only speaks when @-mentioned or DM'd. All the machinery for proactive posts already exists: `postMessage` can post to a channel (`src/slack.ts`), `fetchScoreboard()` returns the upcoming card (`src/espn.ts`), and the system prompt has an ANALYSIS MODE built for card previews (`src/agent.ts`). This plan adds a `scheduled()` handler with two cron jobs: a Saturday card preview ("here's tonight's card and my takes") and a Sunday results recap (using the winner data added by Plan 001). This turns the bot from a lookup utility into a channel presence, which is the point of its heavily-tuned personality.

## Current state

Relevant files:

- `src/index.ts` — Hono app; exports `export default app;` (line 90). This must become an object export (`{ fetch, scheduled }`) so a cron handler can be added.
- `src/agent.ts` — `buildSystemPrompt()` (line 6), `handleMention` / `handleDM` each build an OpenRouter client and call `generateText` with `stopWhen: stepCountIs(8)`, tools from `getTools(env)`, and a 3900-char Slack length cap. The new announcement path reuses this loop.
- `src/slack.ts` — `postMessage(token, channel, text, threadTs?)` returns the message `ts`; works for top-level channel posts when `threadTs` is omitted.
- `src/tools/events.ts` — after Plan 001, exports `mapScoreboardEvents` and its fights carry `winner`/`completed`/`status`.
- `wrangler.jsonc` — no `triggers` key today; `vars` holds `MODEL_ID`; one KV binding `FIGHTERS_KV` (used here for idempotency markers).
- `test/index.spec.ts` — test pattern (vitest + `cloudflare:test`).

Excerpt — `src/index.ts:1-16` and the export (as of `0e964c2`):

```ts
import { Hono } from "hono";
import { verifySlackSignature } from "./slack";
import { handleMention, handleDM } from "./agent";

type Bindings = {
  SLACK_SIGNING_SECRET: string;
  SLACK_BOT_TOKEN: string;
  OPENROUTER_API_KEY: string;
  MODEL_ID: string;
  FIGHTERS_KV: KVNamespace;
  BRAVE_API_KEY: string;
};

const app = new Hono<{ Bindings: Bindings }>();
// ...
export default app;
```

Excerpt — `src/agent.ts:94-105` (the generation + post pattern to reuse):

```ts
const result = await generateText({
	model: openrouter(env.MODEL_ID),
	stopWhen: stepCountIs(8),
	tools,
	system: buildSystemPrompt(),
	messages,
});

const text = result.text.trim();
const reply = text.length > 3900 ? text.slice(0, 3897) + '...' : text;
```

Excerpt — `wrangler.jsonc` (full file is 19 lines):

```jsonc
{
	"name": "gu",
	"main": "src/index.ts",
	"compatibility_date": "2025-04-01",
	"compatibility_flags": ["nodejs_compat"],
	"observability": { "enabled": true },
	"vars": { "MODEL_ID": "anthropic/claude-sonnet-4-5" },
	"kv_namespaces": [{ "binding": "FIGHTERS_KV", "id": "…", "preview_id": "…" }]
}
```

Repo conventions:

- Formatting: tabs, single quotes, semicolons, width 140 (`.prettierrc`). Match the file you're editing.
- No Node built-ins in Worker code — Web APIs only.
- Secrets stay in Wrangler secrets; a Slack channel ID is NOT a secret and goes in `wrangler.jsonc` `vars`.
- Error handling in `agent.ts` catches, truncates the message to 200 chars, and reports into Slack — announcements should instead fail silently to the channel (log via `console.error`; never post an error message on a timer).

## Commands you will need

| Purpose   | Command                          | Expected on success |
|-----------|----------------------------------|---------------------|
| Install   | `npm install`                    | exit 0              |
| Typecheck | `npx tsc --noEmit`               | exit 0, no errors   |
| Tests     | `npx vitest run`                 | all pass            |
| Local dev | `npm run dev`                    | server on :8787     |
| Regenerate Env types (optional) | `npm run cf-typegen` | exit 0 |

Note: `npm run test` is watch mode; use `npx vitest run`. Local cron testing: with `npm run dev` running, `curl "http://localhost:8787/__scheduled?cron=0+17+*+*+6"` triggers the scheduled handler (wrangler dev supports this endpoint).

## Scope

**In scope** (the only files you should modify):
- `src/index.ts` — export shape + scheduled dispatch
- `src/announce.ts` (create) — preview/recap generation and posting
- `src/agent.ts` — ONLY to export a small shared helper if needed (e.g. export `buildSystemPrompt`); do not change `handleMention`/`handleDM` behavior
- `src/espn.ts` — ONLY if Step 2 shows a `dates` param is needed on `fetchScoreboard`
- `wrangler.jsonc` — add `triggers.crons` and `ANNOUNCE_CHANNEL_ID` var
- `test/announce.spec.ts` (create)
- `README.md` — document the new var and crons

**Out of scope** (do NOT touch, even though they look related):
- `src/slack.ts` — `postMessage` already does everything needed.
- `src/tools/*` — tool behavior is Plan 001's territory.
- The Slack event route in `src/index.ts` (`app.post('/slack/events', …)`) — no changes to reactive behavior.
- `scripts/build-cache.ts`.

## Git workflow

- Branch: `advisor/002-scheduled-announcements`
- Commit style: short lowercase imperative (match `git log`, e.g. `handle dms`). Commit per step or logical unit.
- Do NOT push, deploy, or open a PR unless the operator instructed it. `npm run deploy` is explicitly forbidden in this plan — the operator deploys.

## Steps

### Step 1: Convert the worker export to `{ fetch, scheduled }`

In `src/index.ts`, replace `export default app;` with:

```ts
export default {
	fetch: app.fetch,
	scheduled: handleScheduled,
} satisfies ExportedHandler<Bindings>;
```

where `handleScheduled` is imported from the new `src/announce.ts` (created in Step 3). You may need to widen `Bindings` with `ANNOUNCE_CHANNEL_ID: string`. If `ExportedHandler` isn't resolvable with the current generated types, use the explicit signature `(controller: ScheduledController, env: Bindings, ctx: ExecutionContext)` instead — both come from `@cloudflare/workers-types`.

**Verify**: `npx vitest run` → the two existing `/health` tests still pass (they call `worker.fetch`, which must keep working through the new export shape).

### Step 2: Confirm the scoreboard covers "yesterday's" completed card

The Sunday recap needs the completed Saturday card. Check whether the plain scoreboard still returns it on the following morning, and whether a `dates` param works:

**Verify**:
`curl -s 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard?dates=YYYYMMDD' | head -c 2000` (use the date of the most recent past UFC event)
→ JSON whose `events[0]` is that past event, with `winner` flags on competitors.

If the `dates` param works, add an optional parameter to `fetchScoreboard(dates?: string)` in `src/espn.ts` that appends `?dates=` when provided. If it does NOT work, and the plain scoreboard also no longer contains the previous day's event, this is a STOP condition (report what the API returned).

### Step 3: Create `src/announce.ts`

Create the module with this shape (signatures are load-bearing; internals may vary):

```ts
import { generateText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getTools } from './tools';
import { postMessage } from './slack';
import { buildSystemPrompt } from './agent'; // add `export` to it in agent.ts

const PREVIEW_CRON = '0 17 * * 6';  // Saturday 17:00 UTC (~1pm ET)
const RECAP_CRON = '0 14 * * 0';    // Sunday 14:00 UTC (~10am ET)

export async function handleScheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void>
async function runAnnouncement(kind: 'preview' | 'recap', env: Env): Promise<void>
```

Behavior requirements:

1. `handleScheduled` dispatches on `controller.cron`: `PREVIEW_CRON` → preview, `RECAP_CRON` → recap, anything else → `console.log` and return. Wrap the work in `ctx.waitUntil(...)` only if you return before completion; otherwise just `await` it — scheduled handlers may run to completion directly.
2. **Guard**: if `env.ANNOUNCE_CHANNEL_ID` is empty/undefined, `console.log('[announce] no channel configured, skipping')` and return. This makes deploys safe before configuration.
3. **Idempotency**: before posting, read KV key `announce:<kind>:<eventName-or-date>` from `env.FIGHTERS_KV`; if present, skip. After a successful post, write it with `expirationTtl: 60 * 60 * 24 * 7` (7 days). Use the event's `name` from the scoreboard (fall back to today's ISO date) as the key suffix.
4. **Relevance gate**: fetch the scoreboard first. For a preview, only post if there is an event whose `date` falls within the next 36 hours; for a recap, only post if there is a completed event (any fight with `completed: true` — field added by Plan 001) within the past 36 hours. Otherwise log and skip — no "nothing this week" spam.
5. **Generation**: call `generateText` exactly like `src/agent.ts` does (same model construction, same `stopWhen: stepCountIs(8)`, same `system: buildSystemPrompt()`, same tools) with a single user message. Preview: `Write a card preview for tonight's event: ${JSON.stringify(eventData)}. Use ANALYSIS MODE. Lead with your headline take.` Recap: `Write a results recap for last night's event: ${JSON.stringify(eventData)}. Use ANALYSIS MODE. Call out who you were right and wrong about.`
6. Truncate to 3900 chars with the same `slice(0, 3897) + '...'` pattern as `agent.ts`, then `postMessage(env.SLACK_BOT_TOKEN, env.ANNOUNCE_CHANNEL_ID, reply)` (no thread ts).
7. Errors: catch, `console.error('[announce] …')`, never post an error to the channel.

Extract the relevance-gate logic into exported pure functions so they're testable without network:

```ts
export function pickPreviewEvent(events: MappedEvent[], now: Date): MappedEvent | null
export function pickRecapEvent(events: MappedEvent[], now: Date): MappedEvent | null
```

(`MappedEvent` from `src/tools/events.ts`, per Plan 001.)

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 4: Wire config

In `wrangler.jsonc` add:

```jsonc
"triggers": { "crons": ["0 17 * * 6", "0 14 * * 0"] },
```

and add `"ANNOUNCE_CHANNEL_ID": ""` to `vars` (empty default = feature off). Keep the two cron strings byte-identical to the constants in `src/announce.ts`.

**Verify**: `npx tsc --noEmit` → exit 0. Then run `npm run dev` and `curl "http://localhost:8787/__scheduled?cron=0+17+*+*+6"` → dev log shows `[announce] no channel configured, skipping` (channel var is empty), no crash.

### Step 5: Update README

In `README.md`, add `ANNOUNCE_CHANNEL_ID` to the Configuration table (description: "Slack channel ID for scheduled previews/recaps; empty disables them") and a short "Scheduled announcements" subsection under "How it works" noting the two cron times (UTC — they drift 1h against ET across DST, accepted) and that the bot must be invited to the channel.

**Verify**: `grep -n "ANNOUNCE_CHANNEL_ID" README.md` → ≥1 match.

### Step 6: Tests

Create `test/announce.spec.ts` (see Test plan).

**Verify**: `npx vitest run` → all pass.

## Test plan

New tests in `test/announce.spec.ts`, pure-function tests (no network, no Slack):

1. `pickPreviewEvent`: event 12h in the future → returned; event 5 days out → null; no events → null.
2. `pickRecapEvent`: event 12h in the past with a `completed: true` fight → returned; past event with no completed fights → null; future-only events → null.
3. Boundary: event exactly at the 36h edge — pick a convention (inclusive) and assert it.

Plus one handler-level test using `cloudflare:test` (model on `test/index.spec.ts`): call `handleScheduled` with a fake controller `{ cron: '0 17 * * 6' }` and an env where `ANNOUNCE_CHANNEL_ID` is `''` → resolves without throwing and without network access (the guard short-circuits first).

Verification: `npx vitest run` → all pass.

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx vitest run` exits 0; `test/announce.spec.ts` exists and passes
- [ ] `grep -n "scheduled" src/index.ts` shows the object export wiring
- [ ] `grep -n "crons" wrangler.jsonc` shows both cron expressions
- [ ] `curl "http://localhost:8787/__scheduled?cron=0+17+*+*+6"` against `npm run dev` logs the skip message and returns without error
- [ ] Existing `/health` tests still pass (export-shape change didn't break `worker.fetch`)
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Plan 001 is not merged (no `winner`/`completed` fields on `mapScoreboardEvents` output) — this plan depends on it.
- Step 2 shows ESPN provides no way to retrieve the previous day's completed card (neither plain scoreboard the morning after, nor `?dates=`) — the recap has no data source; report and deliver preview-only if the operator agrees, otherwise stop.
- Converting the default export breaks the existing Slack event route tests and a fix requires modifying the route handler itself.
- Anything would require running `npm run deploy` or posting to a real Slack channel to verify — that is the operator's step, not yours.

## Maintenance notes

- Cron times are UTC; ET drifts by an hour across DST. If preview timing matters tightly, revisit with a location-aware check inside the handler rather than more cron entries.
- The idempotency marker lives in `FIGHTERS_KV` under the `announce:` prefix — if a dedicated KV namespace is ever added, migrate these keys.
- Reviewer should scrutinize: the 36-hour relevance windows (UFC sometimes runs early-morning international cards — Sunday-morning ET finishes), and that the JSON embedded in the generation prompt stays well under model context limits (a full card is small; fine today).
- Deferred: posting recaps that quote the bot's own Saturday preview ("hold me to my picks") — needs message-history retrieval by the preview's stored `ts`; store `postMessage`'s return value in the KV marker if you pick this up later. Also deferred: a manual trigger route for testing in production.
