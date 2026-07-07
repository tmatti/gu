import { generateText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getTools } from './tools';
import { postMessage } from './slack';
import { buildSystemPrompt } from './agent';
import { fetchScoreboard, ScoreboardEvent } from './espn';

const PREVIEW_CRON = '0 17 * * 6'; // Saturday 17:00 UTC (~1pm ET)
const RECAP_CRON = '0 14 * * 0'; // Sunday 14:00 UTC (~10am ET)

const HOURS_36_MS = 36 * 60 * 60 * 1000;

interface Env {
	SLACK_BOT_TOKEN: string;
	OPENROUTER_API_KEY: string;
	MODEL_ID: string;
	FIGHTERS_KV: KVNamespace;
	BRAVE_API_KEY: string;
	ANNOUNCE_CHANNEL_ID: string;
}

type AnnounceKind = 'preview' | 'recap';

/** First event whose date is in the future and within the next 36h of `now` (inclusive at +36h). */
export function pickPreviewEvent(events: ScoreboardEvent[], now: Date): ScoreboardEvent | null {
	const nowMs = now.getTime();
	for (const event of events) {
		const eventMs = new Date(event.date).getTime();
		if (Number.isNaN(eventMs)) continue;
		if (eventMs > nowMs && eventMs - nowMs <= HOURS_36_MS) return event;
	}
	return null;
}

/**
 * First event whose date is within the past 36h of `now` (inclusive at -36h) and has at least one
 * competition marked completed.
 */
export function pickRecapEvent(events: ScoreboardEvent[], now: Date): ScoreboardEvent | null {
	const nowMs = now.getTime();
	for (const event of events) {
		const eventMs = new Date(event.date).getTime();
		if (Number.isNaN(eventMs)) continue;
		if (eventMs > nowMs || nowMs - eventMs > HOURS_36_MS) continue;
		const hasCompleted = event.competitions?.some((c) => c.status?.type?.completed === true);
		if (hasCompleted) return event;
	}
	return null;
}

function yyyymmdd(date: Date): string {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, '0');
	const d = String(date.getUTCDate()).padStart(2, '0');
	return `${y}${m}${d}`;
}

async function runAnnouncement(kind: AnnounceKind, env: Env): Promise<void> {
	// Guard first, before any network call.
	if (!env.ANNOUNCE_CHANNEL_ID) {
		console.log('[announce] no channel configured, skipping');
		return;
	}

	try {
		const now = new Date();
		let eventData: ScoreboardEvent | null;

		if (kind === 'preview') {
			const data = await fetchScoreboard();
			eventData = pickPreviewEvent(data.events ?? [], now);
		} else {
			const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
			const [a, b] = await Promise.all([fetchScoreboard(yyyymmdd(yesterday)), fetchScoreboard(yyyymmdd(now))]);
			const byId = new Map<string, ScoreboardEvent>();
			for (const event of [...(a.events ?? []), ...(b.events ?? [])]) {
				if (!byId.has(event.id)) byId.set(event.id, event);
			}
			eventData = pickRecapEvent([...byId.values()], now);
		}

		if (!eventData) {
			console.log('[announce] no relevant event, skipping');
			return;
		}

		// Idempotency: don't double-post the same event/kind within a week.
		const key = `announce:${kind}:${eventData.name || now.toISOString()}`;
		const seen = await env.FIGHTERS_KV.get(key);
		if (seen !== null) {
			console.log(`[announce] already posted ${key}, skipping`);
			return;
		}

		const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });

		const prompt =
			kind === 'preview'
				? `Write a card preview for tonight's event: ${JSON.stringify(eventData)}. Use ANALYSIS MODE. Lead with your headline take.`
				: `Write a results recap for last night's event: ${JSON.stringify(eventData)}. Use ANALYSIS MODE. Call out who you were right and wrong about.`;

		const result = await generateText({
			model: openrouter(env.MODEL_ID),
			stopWhen: stepCountIs(8),
			tools: getTools(env),
			system: buildSystemPrompt(),
			messages: [{ role: 'user', content: prompt }],
		});

		const text = result.text.trim();
		const reply = text.length > 3900 ? text.slice(0, 3897) + '...' : text;

		await postMessage(env.SLACK_BOT_TOKEN, env.ANNOUNCE_CHANNEL_ID, reply);

		await env.FIGHTERS_KV.put(key, '1', { expirationTtl: 60 * 60 * 24 * 7 });
	} catch (err) {
		console.error(`[announce] ${kind} failed: ${err instanceof Error ? err.message : String(err)}`);
	}
}

export async function handleScheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
	switch (controller.cron) {
		case PREVIEW_CRON:
			await runAnnouncement('preview', env);
			break;
		case RECAP_CRON:
			await runAnnouncement('recap', env);
			break;
		default:
			console.log(`[announce] unrecognized cron ${controller.cron}, skipping`);
	}
}
