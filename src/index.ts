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

app.get("/health", (c) => c.json({ ok: true }));

app.post("/slack/events", async (c) => {
  // Ignore Slack retries to prevent duplicate responses
  if (c.req.header("X-Slack-Retry-Num")) {
    return c.json({ ok: true });
  }

  const body = await c.req.text();

  const payload = JSON.parse(body) as {
    type: string;
    challenge?: string;
    event?: {
      type: string;
      text?: string;
      channel?: string;
      channel_type?: string;
      bot_id?: string;
      subtype?: string;
      ts: string;
      thread_ts?: string;
    };
  };

  // Handle Slack's URL verification challenge (no signature needed)
  if (payload.type === "url_verification") {
    return c.json({ challenge: payload.challenge });
  }

  // Verify Slack signature for all other requests
  const valid = await verifySlackSignature(
    c.req.raw,
    body,
    c.env.SLACK_SIGNING_SECRET
  );
  if (!valid) {
    return c.json({ error: "invalid signature" }, 401);
  }

  // Handle app_mention events
  if (payload.type === "event_callback" && payload.event?.type === "app_mention") {
    const event = payload.event;
    const text = (event.text ?? "").replace(/<@[A-Z0-9]+>/g, "").trim();
    const channel = event.channel ?? "";
    const eventTs = event.ts;
    const threadTs = event.thread_ts;

    c.executionCtx.waitUntil(
      handleMention(text, channel, eventTs, threadTs, c.env)
    );
  }

  // Handle direct messages (message.im events)
  if (
    payload.type === "event_callback" &&
    payload.event?.type === "message" &&
    payload.event?.channel_type === "im" &&
    !payload.event?.bot_id &&
    !payload.event?.subtype
  ) {
    const event = payload.event;
    const text = (event.text ?? "").trim();
    const channel = event.channel ?? "";
    const eventTs = event.ts;

    c.executionCtx.waitUntil(
      handleDM(text, channel, eventTs, c.env)
    );
  }

  return c.json({ ok: true });
});

export default app;
