# Plan 001: Expose fight results (winners) in the lookupEvents tool

> **Executor instructions**: Follow this plan step by step. Run every
> verification command and confirm the expected result before moving to the
> next step. If anything in the "STOP conditions" section occurs, stop and
> report — do not improvise. When done, update the status row for this plan
> in `plans/README.md` — unless a reviewer dispatched you and told you they
> maintain the index.
>
> **Drift check (run first)**: `git diff --stat 0e964c2..HEAD -- src/espn.ts src/tools/events.ts test/`
> If any in-scope file changed since this plan was written, compare the
> "Current state" excerpts against the live code before proceeding; on a
> mismatch, treat it as a STOP condition.

## Status

- **Priority**: P1
- **Effort**: S
- **Risk**: LOW
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `0e964c2`, 2026-07-07
- **Issue**: https://github.com/tmatti/gu/issues/9

## Why this matters

This repo is a Slack bot ("gu") that answers MMA questions using an LLM agent loop with tools. Its `lookupEvents` tool returns the upcoming UFC card from ESPN's scoreboard API, but it silently drops the result data: the `ScoreboardResponse` type in `src/espn.ts` already parses a `winner?: boolean` field per competitor, and the tool never surfaces it. "Who won last night?" is the highest-frequency question an MMA bot gets, and today the agent always falls back to a slower, less reliable web search. This plan makes `lookupEvents` return fight status and winners, so completed cards answer instantly from structured data. It is also a prerequisite for Plan 002 (scheduled results recaps).

## Current state

Relevant files:

- `src/espn.ts` — ESPN API client and response types. `ScoreboardResponse` (lines 55–74) types the scoreboard payload; `fetchScoreboard()` (lines 184–187) fetches it.
- `src/tools/events.ts` — the `lookupEvents` tool. Its `execute` maps scoreboard events to a compact shape (lines 28–50) and drops `winner`.
- `test/index.spec.ts` — the only existing test file; tests `/health` using `cloudflare:test` + vitest. Use it as the structural pattern for imports/style.

Excerpt — `src/espn.ts:55-74` (note `winner?: boolean` is parsed today):

```ts
interface ScoreboardResponse {
  leagues: {
    calendar: { label: string; startDate: string; endDate: string }[];
  }[];
  events: {
    id: string;
    name: string;
    date: string;
    venues?: { fullName: string; address?: { city?: string; country?: string } }[];
    competitions: {
      type?: { abbreviation: string };
      competitors: {
        order: number;
        winner?: boolean;
        athlete: { displayName: string; flag?: { description?: string } };
        records?: { summary: string }[];
      }[];
    }[];
  };
}
```

(The real file has `events` as an array — `events: { ... }[]` — confirm against the live file.)

Excerpt — `src/tools/events.ts:28-50` (the mapping that drops results):

```ts
const events = (data.events ?? []).map((event) => ({
	name: event.name,
	date: event.date,
	venue: event.venues?.[0]
		? `${event.venues[0].fullName}, ${event.venues[0].address?.city ?? ''} ${event.venues[0].address?.country ?? ''}`.trim()
		: null,
	fights: event.competitions.map((comp) => {
		const [a, b] = comp.competitors.sort((x, y) => x.order - y.order);
		return {
			weightClass: comp.type?.abbreviation ?? '',
			fighterA: {
				name: a?.athlete.displayName ?? '',
				record: a?.records?.[0]?.summary ?? '',
				country: a?.athlete.flag?.description ?? '',
			},
			fighterB: { /* same shape */ },
		};
	}),
}));
```

Repo conventions:

- Formatting per `.prettierrc`: tabs, single quotes, semicolons, print width 140. `src/tools/*.ts` uses tabs + single quotes — match the file you're editing.
- Tools are factory functions returning `tool({ description, inputSchema, execute })` from the `ai` package (AI SDK v6: the key is `inputSchema`, NOT `parameters`). See `src/tools/rankings.ts` for the pattern.
- The Worker runtime has no Node built-ins; Web APIs only. (Tests run under `@cloudflare/vitest-pool-workers`.)

## Commands you will need

| Purpose   | Command                  | Expected on success |
|-----------|--------------------------|---------------------|
| Install   | `npm install`            | exit 0              |
| Typecheck | `npx tsc --noEmit`       | exit 0, no errors   |
| Tests     | `npx vitest run`         | all pass            |

Note: `npm run test` starts vitest in watch mode — use `npx vitest run` for a one-shot run.

## Scope

**In scope** (the only files you should modify):
- `src/espn.ts` — extend `ScoreboardResponse` with the status field
- `src/tools/events.ts` — expose winner/status in the mapping; update the tool description
- `test/events.spec.ts` (create)

**Out of scope** (do NOT touch, even though they look related):
- `src/tools/rankings.ts`, `src/tools/fighters.ts`, `src/tools/search.ts`, `src/tools/readpage.ts` — unrelated tools.
- `src/agent.ts` — the system prompt's tool-routing text still holds ("lookup tools hold basic cached stats"); do not rewrite it in this plan.
- `scripts/build-cache.ts` — unrelated to the scoreboard.

## Git workflow

- Branch: `advisor/001-expose-fight-results`
- Commit style: short lowercase imperative, matching `git log` (e.g. `add websearch tool`, `handle dms`). One commit is fine for this plan.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Confirm the live scoreboard payload carries status + winner

Fetch the real endpoint and inspect one competition:

**Verify**: `curl -s 'https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard' | head -c 3000`
→ JSON containing an `events` array; each competition object should contain a `status` object (expected shape: `"status": { "type": { "completed": false, "description": "Scheduled", ... } }`) and competitors that gain `"winner": true/false` once a fight is final. If the payload has no `status` field on competitions at all, see STOP conditions.

### Step 2: Extend `ScoreboardResponse` in `src/espn.ts`

Inside the `competitions` array element type (currently `type?` and `competitors`), add an optional status field matching what you observed in Step 1:

```ts
status?: { type?: { completed?: boolean; description?: string } };
```

Keep it optional — ESPN payloads are inconsistent and nothing must crash when it's absent.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 3: Extract the event mapping into an exported pure function in `src/tools/events.ts`

Move the body of the `(data.events ?? []).map(...)` expression into an exported function so it can be unit-tested:

```ts
export function mapScoreboardEvents(data: ScoreboardResponse): MappedEvent[]
```

You will need to export `ScoreboardResponse` from `src/espn.ts` (it is currently a non-exported interface) — add `export` to the interface, change nothing else about it. Define `MappedEvent` (or inline the return type) in `events.ts`. The tool's `execute` then becomes `return { events: mapScoreboardEvents(data) };` for the no-query branch. The query/calendar branch (lines 18–25) is unchanged.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 4: Add result fields to the mapped shape

In `mapScoreboardEvents`, extend each fight object:

- On each fighter: `winner: a?.winner ?? false` (and likewise for `b`).
- On each fight: `completed: comp.status?.type?.completed ?? (a?.winner != null || b?.winner != null)` — treat presence of a winner flag as completion fallback, and `status: comp.status?.type?.description ?? ''`.

Keep field names exactly `winner`, `completed`, `status` — Plan 002 will consume them.

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 5: Update the tool description

In `src/tools/events.ts`, the current description reads:

> 'Basic ESPN event data: name, date, venue, and fight card for the nearest UFC event, or calendar dates for a named event. Limited and may lag reality. For previews, results, or anything analytical, use webSearch instead.'

Replace with wording that tells the model results ARE available here, e.g.:

> 'Basic ESPN event data: name, date, venue, and fight card for the nearest UFC event, including winners once fights are final — use this first for "who won" questions about the most recent card. Also returns calendar dates for a named event. May lag reality slightly; for deeper analysis or older events, use webSearch.'

**Verify**: `npx tsc --noEmit` → exit 0.

### Step 6: Write unit tests

Create `test/events.spec.ts` testing `mapScoreboardEvents` with an inline canned fixture (no network). Model imports/structure after `test/index.spec.ts` (plain `describe`/`it`/`expect` from vitest; no `cloudflare:test` helpers are needed for a pure function).

**Verify**: `npx vitest run` → all tests pass, including the new file.

## Test plan

New tests in `test/events.spec.ts`, all against inline fixture objects typed as `ScoreboardResponse`:

1. Upcoming card: competitors without `winner`, no `status` → fights have `completed: false`, both fighters `winner: false`.
2. Completed card: `status.type.completed: true` and one competitor `winner: true` → fight `completed: true`, correct fighter flagged.
3. Winner-only fallback: no `status` field but `winner: true/false` present → `completed: true`.
4. Empty/missing data: `events: []` → `[]`; a competition with a single competitor does not throw.

Verification: `npx vitest run` → all pass (2 existing + 4+ new).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `npx tsc --noEmit` exits 0
- [ ] `npx vitest run` exits 0; `test/events.spec.ts` exists with ≥4 tests
- [ ] `grep -n "winner" src/tools/events.ts` returns matches (results are surfaced)
- [ ] `grep -n "export interface ScoreboardResponse" src/espn.ts` returns a match
- [ ] No files outside the in-scope list are modified (`git status`)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- Step 1 shows the live scoreboard payload has no `status` object on competitions AND no `winner` flags on competitors of past events — the feature has no data source.
- The excerpts in "Current state" don't match the live code (drift since `0e964c2`).
- Exporting `ScoreboardResponse` causes type errors elsewhere that require touching out-of-scope files.
- A step's verification fails twice after a reasonable fix attempt.

## Maintenance notes

- Plan 002 (scheduled recaps) consumes the `winner`/`completed`/`status` fields by these exact names — renaming them later breaks that plan.
- Reviewer should scrutinize: the completion fallback logic (winner-flag presence implying completion) and that the description change doesn't over-promise (ESPN's scoreboard only covers the nearest event window, not historical cards).
- Deferred: a `dates` query parameter on `fetchScoreboard()` to fetch a specific day's card — Plan 002 investigates whether it's needed.
