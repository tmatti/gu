# gu

A Slack bot for MMA questions, deployed on Cloudflare Workers. Mention it in a channel and ask anything about fighters, events, or rankings.

## Stack

- **Runtime**: Cloudflare Workers (TypeScript)
- **Router**: Hono
- **LLM**: Vercel AI SDK + OpenRouter (`anthropic/claude-sonnet-4-20250514` by default)
- **Data**: ESPN unofficial MMA API (stub tools — not yet wired up)

## Setup

### 1. Install dependencies

```sh
npm install
```

### 2. Set secrets

```sh
wrangler secret put SLACK_SIGNING_SECRET
wrangler secret put SLACK_BOT_TOKEN
wrangler secret put OPENROUTER_API_KEY
```

### 3. Configure the Slack app

In [api.slack.com](https://api.slack.com):

- **OAuth scopes**: `app_mentions:read`, `chat:write`, `channels:history`
- **Event subscriptions URL**: `https://gu.<account>.workers.dev/slack/events`
- **Subscribe to events**: `app_mention`

### 4. Deploy

```sh
npm run deploy
```

## Development

```sh
npm run dev       # local dev server on http://localhost:8787
npm run test      # run tests
npx tsc --noEmit  # type check
```

### Populating the fighter cache

Run the local build script — it fetches all ~1800 athletes from ESPN and writes directly to Cloudflare KV in one pass.

```sh
npm run build-cache       # write to production KV
npm run build-cache:dev   # write to preview KV (used by wrangler dev)
```

The script reads the KV namespace IDs from `wrangler.jsonc` automatically. It takes a few minutes to run.

### Testing locally

Test a fighter lookup via a mock Slack event:
```sh
curl -X POST http://localhost:8787/slack/events \
  -H "Content-Type: application/json" \
  -d '{"type":"url_verification","challenge":"test123"}'
```

## Configuration

| Variable | Where | Description |
|---|---|---|
| `MODEL_ID` | `wrangler.jsonc` `[vars]` | OpenRouter model ID |
| `SLACK_SIGNING_SECRET` | Wrangler secret | From Slack app settings |
| `SLACK_BOT_TOKEN` | Wrangler secret | Bot OAuth token (`xoxb-...`) |
| `OPENROUTER_API_KEY` | Wrangler secret | From openrouter.ai |

## How it works

1. Slack sends an `app_mention` event to `/slack/events`
2. The worker verifies the Slack signature and returns 200 immediately
3. A "thinking..." message is posted in the thread
4. The agent calls `generateText` with tool access (fighter lookup, events, rankings)
5. The "thinking..." message is updated with the final response
6. Thread context from prior messages is included for multi-turn conversations
