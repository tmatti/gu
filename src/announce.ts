import { generateText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getTools } from './tools';
import { postMessage } from './slack';
import { buildSystemPrompt } from './agent';
import { fetchScoreboard, ScoreboardEvent } from './espn';

// Cloudflare cron day-of-week is 1=Sunday..7=Saturday (not Unix 0-6); day names avoid the ambiguity.
// Must stay byte-identical to triggers.crons in wrangler.jsonc — dispatch matches on the exact string.
export const PREVIEW_CRON = '0 13 * * FRI'; // Friday 13:00 UTC (~8-9am ET)
export const RECAP_CRON = '0 14 * * SUN'; // Sunday 14:00 UTC (~10am ET)

// The Friday-morning preview needs ~1.5 days of reach to cover Saturday cards from early
// international start times through late US main cards that spill into Sunday UTC.
const PREVIEW_AHEAD_MS = 48 * 60 * 60 * 1000;
const RECAP_WINDOW_MS = 36 * 60 * 60 * 1000;

interface Env {
	SLACK_BOT_TOKEN: string;
	OPENROUTER_API_KEY: string;
	MODEL_ID: string;
	FIGHTERS_KV: KVNamespace;
	BRAVE_API_KEY: string;
	ANNOUNCE_CHANNEL_ID: string;
}

type AnnounceKind = 'preview' | 'recap';

/** First event starting within the next 48h of `now` (inclusive at +48h). */
export function pickPreviewEvent(events: ScoreboardEvent[], now: Date): ScoreboardEvent | null {
	const nowMs = now.getTime();
	for (const event of events) {
		const eventMs = new Date(event.date).getTime();
		if (Number.isNaN(eventMs)) continue;
		if (eventMs > nowMs && eventMs - nowMs <= PREVIEW_AHEAD_MS) return event;
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
		if (eventMs > nowMs || nowMs - eventMs > RECAP_WINDOW_MS) continue;
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

// The raw scoreboard event is ~65KB at runtime (broadcasts, links, uids...); project it down to the
// fields the prompt actually needs before embedding it.
function summarizeEvent(event: ScoreboardEvent) {
	return {
		name: event.name,
		date: event.date,
		venue: event.venues?.[0]?.fullName ?? null,
		fights: (event.competitions ?? []).map((comp) => ({
			weightClass: comp.type?.abbreviation ?? '',
			completed: comp.status?.type?.completed ?? false,
			fighters: [...comp.competitors]
				.sort((x, y) => x.order - y.order)
				.map((c) => ({
					name: c.athlete.displayName,
					record: c.records?.[0]?.summary ?? '',
					winner: c.winner ?? false,
				})),
		})),
	};
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
			const data = await fetchScoreboard(`${yyyymmdd(yesterday)}-${yyyymmdd(now)}`);
			eventData = pickRecapEvent(data.events ?? [], now);
		}

		if (!eventData) {
			console.log('[announce] no relevant event, skipping');
			return;
		}

		// Idempotency: don't double-post the same event/kind within a week.
		const key = `announce:${kind}:${eventData.name || now.toISOString().slice(0, 10)}`;
		const seen = await env.FIGHTERS_KV.get(key);
		if (seen !== null) {
			console.log(`[announce] already posted ${key}, skipping`);
			return;
		}

		const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });

		const card = JSON.stringify(summarizeEvent(eventData));
		const prompt =
			kind === 'preview'
				? `Write a card preview for tonight's event: ${card}. Use ANALYSIS MODE. Lead with your headline take.`
				: `Write a results recap for last night's event: ${card}. Use ANALYSIS MODE. Call out who you were right and wrong about.`;

		const result = await generateText({
			model: openrouter(env.MODEL_ID),
			stopWhen: stepCountIs(8),
			tools: getTools(env),
			system: buildSystemPrompt(),
			messages: [{ role: 'user', content: prompt }],
		});

		const text = result.text.trim();
		const reply = text.length > 3900 ? text.slice(0, 3897) + '...' : text;

		if (!reply) {
			console.error(`[announce] ${kind} generation returned empty text, skipping post`);
			return;
		}

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
