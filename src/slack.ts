const SLACK_API = "https://slack.com/api";

export async function verifySlackSignature(
  request: Request,
  body: string,
  signingSecret: string
): Promise<boolean> {
  const timestamp = request.headers.get("X-Slack-Request-Timestamp");
  const signature = request.headers.get("X-Slack-Signature");
  if (!timestamp || !signature) return false;

  // Reject requests older than 5 minutes
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp)) > 300) return false;

  const encoder = new TextEncoder();
  const baseString = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const mac = await crypto.subtle.sign("HMAC", key, encoder.encode(baseString));
  const hex = Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  const expected = `v0=${hex}`;

  // Constant-time comparison
  if (expected.length !== signature.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) {
    diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  }
  return diff === 0;
}

export async function postMessage(
  token: string,
  channel: string,
  text: string,
  threadTs?: string
): Promise<string> {
  const body: Record<string, string> = { channel, text };
  if (threadTs) body.thread_ts = threadTs;

  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const data = (await res.json()) as { ok: boolean; ts: string; error?: string };
  if (!data.ok) throw new Error(`chat.postMessage failed: ${data.error}`);
  return data.ts;
}

export async function updateMessage(
  token: string,
  channel: string,
  ts: string,
  text: string
): Promise<void> {
  const res = await fetch(`${SLACK_API}/chat.update`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel, ts, text }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`chat.update failed: ${data.error}`);
}

export interface SlackMessage {
  user?: string;
  bot_id?: string;
  text: string;
  ts: string;
}

export async function getThreadMessages(
  token: string,
  channel: string,
  threadTs: string
): Promise<SlackMessage[]> {
  const params = new URLSearchParams({ channel, ts: threadTs, limit: "20" });
  const res = await fetch(`${SLACK_API}/conversations.replies?${params}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = (await res.json()) as {
    ok: boolean;
    messages?: SlackMessage[];
    error?: string;
  };
  if (!data.ok) throw new Error(`conversations.replies failed: ${data.error}`);
  return data.messages ?? [];
}
