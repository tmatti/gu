# Plan 003: Spike — automate the fighter KV cache refresh (design decision, not a build)

> **Executor instructions**: This is a SPIKE plan. The deliverable is a written
> report (`plans/003-spike-report.md`) with measurements and a recommended
> design — NOT merged production code. You may write throwaway probe scripts
> under `plans/probes/` and run read-only commands, but you must not modify
> anything under `src/`, `scripts/`, or `wrangler.jsonc`. Follow the steps,
> run every verification, honor the STOP conditions, and update this plan's
> row in `plans/README.md` when done.
>
> **Drift check (run first)**: `git diff --stat 0e964c2..HEAD -- src/espn.ts scripts/build-cache.ts`
> If either file changed since this plan was written, compare the "Current
> state" excerpts against the live code before proceeding; on a mismatch,
> treat it as a STOP condition.

## Status

- **Priority**: P2
- **Effort**: M (spike only; implementation is a follow-up plan)
- **Risk**: LOW (read-only investigation; no production changes)
- **Depends on**: none
- **Category**: direction
- **Planned at**: commit `0e964c2`, 2026-07-07
- **Issue**: https://github.com/tmatti/gu/issues/11

## Why this matters

The bot's fastest tool (`lookupFighter`) reads a KV cache of ~1800 UFC fighters that is built **by hand, from a laptop** (`scripts/build-cache.ts`; README: "It takes a few minutes to run"). Because the data rots after every fight card, the codebase hedges in three places — "may be stale or missing" (`src/tools/fighters.ts:14`), "may be stale or incomplete" (`src/agent.ts:21`), "cache may not be populated yet" (`src/tools/fighters.ts:19`) — and the system prompt actively steers the model away from its own cache toward slower web search. Automating the refresh inside the Worker removes an operational chore and lets the cache be trusted. But a naive port collides with Cloudflare platform limits (subrequests per invocation, KV write quotas, CPU time), so the right mechanism must be chosen with real numbers first. This spike produces those numbers and a go/no-go design.

## Current state

Relevant files (read-only for this spike):

- `scripts/build-cache.ts` — the manual pipeline: `fetchAllAthleteIds()` (paginated list, ~18 pages of 100), then `fetchAthleteDetail(id)` per athlete in batches of 10, then one `wrangler kv bulk put` of ~1800 `athlete:<id>` entries plus one `__name_index` entry.
- `src/espn.ts` — `fetchAllAthleteIds` (lines 96–125), `fetchAthleteDetail` (lines 127–158); both are plain `fetch` and already runtime-agnostic (usable from a Worker as-is).
- `src/tools/fighters.ts` / `searchAthletes` in `src/espn.ts:161-182` — the read path: `__name_index` is one KV value scanned in memory; each hit is one `kv.get('athlete:<id>')`.
- `wrangler.jsonc` — one KV namespace `FIGHTERS_KV` (id + preview_id). As of commit `0e964c2` there are no cron `triggers` (Plan 002 adds two for announcements — coordinate if both land).

Key excerpt — `scripts/build-cache.ts:51-63` (the loop that must move to the Worker, or not):

```ts
for (let i = 0; i < ids.length; i += 10) {
  const batch = ids.slice(i, i + 10);
  const results = await Promise.all(batch.map(fetchAthleteDetail));
  for (const athlete of results) {
    if (!athlete || !athlete.name) { skipped++; continue; }
    kvEntries.push({ key: `athlete:${athlete.id}`, value: JSON.stringify(athlete) });
    nameIndex.push({ id: athlete.id, name: athlete.name });
    stored++;
  }
}
```

Platform constraints to verify (do not trust these numbers — verifying them IS the spike):

- Subrequests per Worker invocation: 50 (free) / 1000 (paid). KV operations via bindings count toward this. A full refresh is ~18 list fetches + ~1800 detail fetches + ~1800 KV writes ≈ 3600+ subrequests — over the limit even on paid, hence chunking.
- KV writes: free plan has a daily write quota (~1000/day) that a full nightly refresh would exceed on its own; paid is usage-billed.
- Cron Triggers: available on free and paid; a Worker can have multiple cron expressions and dispatch on `controller.cron`.
- Same-key KV write rate: max 1 write/second per key — relevant for `__name_index` if chunks each rewrite it (they shouldn't; see candidate designs).

## Commands you will need

| Purpose | Command | Expected on success |
|---|---|---|
| Install | `npm install` | exit 0 |
| Typecheck (unchanged tree) | `npx tsc --noEmit` | exit 0 |
| Account plan check | `npx wrangler whoami` | prints account; note plan tier if shown |
| Run a probe script | `npx tsx plans/probes/<name>.ts` | script-defined |

## Scope

**In scope** (the only files you may create/modify):
- `plans/003-spike-report.md` (create — the deliverable)
- `plans/probes/*.ts` (create — throwaway measurement scripts, clearly marked as such)
- `plans/README.md` (status row update)

**Out of scope** (do NOT touch):
- Everything under `src/` and `scripts/` — this spike changes no production code.
- `wrangler.jsonc` — no bindings, vars, or triggers changes.
- Cloudflare state: do NOT write to either KV namespace (production `id` or `preview_id`), do NOT deploy. Probes hit the ESPN API and read public docs only.

## Git workflow

- Branch: `advisor/003-cache-refresh-spike`
- Commit style: short lowercase imperative (match `git log`). One or two commits.
- Do NOT push or open a PR unless the operator instructed it.

## Steps

### Step 1: Pin down the actual platform limits

Determine, with citations (Cloudflare docs URLs) in the report:

1. The account's plan tier (`npx wrangler whoami`; if tier isn't shown, record "unknown — operator must confirm" — do NOT guess).
2. Subrequests per invocation for that tier, and whether KV binding operations count toward it.
3. KV write quota per day for that tier, and the 1-write/sec/key rule.
4. Cron Trigger availability and any per-account cron count limits.
5. Worker wall-clock/CPU limits for cron-invoked runs on that tier.

**Verify**: the five numbers appear in `plans/003-spike-report.md` under "## Limits", each with a source URL or "operator must confirm".

### Step 2: Measure the ESPN workload

Write `plans/probes/measure-espn.ts` (run with `npx tsx`) that:

1. Calls `fetchAllAthleteIds()` (import from `../../src/espn.ts` — imports are fine; modification is not) and records: total ID count, page count, elapsed ms.
2. Fetches detail for a sample of 50 IDs and records: median/p95 latency per `fetchAthleteDetail`, failure rate, average JSON payload size.
3. Prints a summary table.

**Verify**: `npx tsx plans/probes/measure-espn.ts` → prints the summary; numbers are copied into the report under "## Workload measurements".

### Step 3: Check for a cheaper "active fighters" source

The full 1800-athlete sweep may be unnecessary: most questions concern ranked fighters and upcoming-card fighters. Investigate whether ESPN offers a filtered listing (e.g. an `active=true` query param on the core athletes endpoint, or deriving a priority set from the rankings + scoreboard endpoints already used in `src/espn.ts:184-192`). Record what works, with sample URLs and result counts, under "## Priority-subset option".

**Verify**: the report section exists and states either a working filtered endpoint (with URL and count) or "none found — subset must be derived from rankings + scoreboard (~N fighters)".

### Step 4: Evaluate the three candidate designs and recommend one

Score each against the Step 1 limits and Step 2/3 measurements. Required candidates (add others if the data suggests them):

- **A. Chunked cursor walk (cron)**: a cron every N minutes processes a slice of athlete IDs (cursor + ID list stored in KV under e.g. `refresh:cursor`), writing `athlete:<id>` entries as it goes; `__name_index` rebuilt once per full cycle (single write — respects the 1/sec/key rule). Full cycle spread over hours; runs continuously.
- **B. Priority-subset refresh (cron)**: daily cron refreshes only ranked fighters + both cards adjacent to today (from Step 3), staying under even free-tier limits; full 1800-fighter rebuild stays a manual/occasional `npm run build-cache`.
- **C. Keep it manual, reduce the pain**: GitHub Actions weekly job running the existing `scripts/build-cache.ts` with `CLOUDFLARE_API_TOKEN` as a repo secret — zero Worker changes, but adds a CI dependency and a token to manage.

For each: subrequest math per invocation, KV writes per day, staleness window achieved, failure/retry story, and blast radius (files touched) for the eventual implementation. End with "## Recommendation" — one design, one paragraph of rationale, and a bullet list of the implementation steps a follow-up plan would contain. If tier is unknown and the answer differs by tier, give a recommendation per tier.

**Verify**: `grep -n "## Recommendation" plans/003-spike-report.md` → 1 match; all three candidates have a filled-in comparison row/section.

### Step 5: Flag interactions

Add a "## Interactions" section covering: Plan 002 also adds `triggers.crons` to `wrangler.jsonc` (merging both means multiple cron expressions dispatched on `controller.cron` — confirm the count is within the per-Worker cron limit from Step 1), and the tool/prompt hedging ("may be stale") in `src/tools/fighters.ts` and `src/agent.ts` that a trusted cache would let a follow-up plan soften.

**Verify**: `grep -n "## Interactions" plans/003-spike-report.md` → 1 match.

## Test plan

Not applicable — spike produces a report, not production code. The probe script is throwaway and needs no tests; `npx tsc --noEmit` must still exit 0 on the unchanged production tree (probes under `plans/` are outside `tsconfig` include — verify they don't break the typecheck).

## Done criteria

Machine-checkable. ALL must hold:

- [ ] `plans/003-spike-report.md` exists with sections: Limits, Workload measurements, Priority-subset option, candidate comparison, Recommendation, Interactions
- [ ] Every limit cited has a source URL or an explicit "operator must confirm"
- [ ] `npx tsc --noEmit` exits 0 (production tree untouched)
- [ ] `git status` shows changes only under `plans/`
- [ ] Neither KV namespace was written to (no `wrangler kv` write commands in your history)
- [ ] `plans/README.md` status row updated

## STOP conditions

Stop and report back (do not improvise) if:

- ESPN's athlete endpoints are unreachable, rate-limit the probe (HTTP 429), or return a shape that no longer matches `src/espn.ts`'s interfaces — measurements would be fiction.
- `fetchAllAthleteIds()` returns a wildly different count than ~1800 (e.g. >5000) — the workload assumption changed; report the new number first.
- You find yourself wanting to modify anything under `src/`, `scripts/`, or `wrangler.jsonc` — that means the spike is drifting into implementation.

## Maintenance notes

- The follow-up implementation plan should be written against this report's Recommendation section and stamped with the then-current commit.
- Whoever implements should also revisit the stale-cache hedging in `src/tools/fighters.ts:14,19` and `src/agent.ts:21` — leaving "may be stale" in place after automating freshness wastes the win.
- If Plan 002 lands first, the implementation must merge its cron expressions into the existing `triggers.crons` array and extend the `controller.cron` dispatch, not replace it.
