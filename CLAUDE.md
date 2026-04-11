# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```sh
npm run dev       # local dev server (http://localhost:8787)
npm run deploy    # deploy to Cloudflare Workers
npm run test      # run tests with vitest
npx tsc --noEmit  # type check
npm run cf-typegen  # regenerate Env types from wrangler.jsonc bindings
```

## Architecture

A single Cloudflare Worker that handles Slack `app_mention` events and responds using an LLM agent loop.

**Request flow:**
1. `src/index.ts` — Hono router receives `POST /slack/events`
2. Ignores Slack retries (`X-Slack-Retry-Num` header) to prevent duplicate responses
3. Verifies Slack signature via `src/slack.ts`
4. Returns 200 immediately; defers processing via `ctx.executionCtx.waitUntil()`
5. `src/agent.ts` posts a "thinking..." message, fetches thread history if in a thread, calls `generateText`, then updates the message with the final response

**LLM integration:**
- Uses Vercel AI SDK v6 (`ai`) with OpenRouter (`@openrouter/ai-sdk-provider`)
- `generateText` with `stopWhen: stepCountIs(5)` — note: AI SDK v6 replaced `maxSteps` with this
- Tools use `inputSchema` (not `parameters`) — AI SDK v6 change
- Model is configurable via `MODEL_ID` in `wrangler.jsonc [vars]`

**Tools (`src/tools/`):**
- Each tool is defined with `tool({ inputSchema: zodSchema, execute })` from `ai`
- Currently stubs — ESPN API endpoints are commented in each file for when they're wired up
- ESPN base URL: `https://site.api.espn.com/apis/site/v2/sports/mma/ufc/`

**Runtime constraints:**
- No Node.js built-ins — uses Web APIs only (`fetch`, `crypto.subtle`, `URLSearchParams`)
- Secrets (`SLACK_SIGNING_SECRET`, `SLACK_BOT_TOKEN`, `OPENROUTER_API_KEY`) are Wrangler secrets, never in code
