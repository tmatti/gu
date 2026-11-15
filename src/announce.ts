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
	ANNOUNCE_USER_ID: string;
}

export type AnnounceKind = 'preview' | 'recap';

// The mma/ufc scoreboard is ESPN's default MMA feed and can surface other promotions (PFL, Bellator).
// UFC cards are the only ones we announce, and they always lead with "UFC" (e.g. "UFC 329:",
// "UFC Fight Night:", "UFC on ESPN:").
function isUfcEvent(event: ScoreboardEvent): boolean {
	return /^ufc\b/i.test((event.name ?? '').trim());
}

/** First UFC event starting within the next 48h of `now` (inclusive at +48h). */
export function pickPreviewEvent(events: ScoreboardEvent[], now: Date): ScoreboardEvent | null {
	const nowMs = now.getTime();
	for (const event of events) {
		if (!isUfcEvent(event)) continue;
		const eventMs = new Date(event.date).getTime();
		if (Number.isNaN(eventMs)) continue;
		if (eventMs > nowMs && eventMs - nowMs <= PREVIEW_AHEAD_MS) return event;
	}
	return null;
}

/**
 * First UFC event whose date is within the past 36h of `now` (inclusive at -36h) and has at least
 * one competition marked completed.
 */
export function pickRecapEvent(events: ScoreboardEvent[], now: Date): ScoreboardEvent | null {
	const nowMs = now.getTime();
	for (const event of events) {
		if (!isUfcEvent(event)) continue;
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

type Competition = ScoreboardEvent['competitions'][number];

export interface Briefs {
	main?: string;
	coMain?: string;
}

function sortedFighters(comp: Competition) {
	return [...comp.competitors]
		.sort((x, y) => x.order - y.order)
		.map((c) => ({
			name: c.athlete.displayName,
			record: c.records?.[0]?.summary ?? '',
			winner: c.winner === true,
		}));
}

/** One fight as "Weight class: Name (record) vs. Name (record)"; recaps use "def." with the winner first. */
export function fightLine(comp: Competition, kind: AnnounceKind): string {
	const fighters = sortedFighters(comp);
	const label = (f: (typeof fighters)[number]) => (f.record ? `${f.name} (${f.record})` : f.name);
	const weightClass = comp.type?.abbreviation ? `${comp.type.abbreviation}: ` : '';
	const winner = kind === 'recap' ? fighters.find((f) => f.winner) : undefined;
	if (winner && fighters.length === 2) {
		const loser = fighters.find((f) => f !== winner)!;
		return `${weightClass}${label(winner)} def. ${label(loser)}`;
	}
	const suffix = kind === 'recap' && comp.status?.type?.completed ? ' (no winner listed)' : '';
	return `${weightClass}${fighters.map(label).join(' vs. ')}${suffix}`;
}

function easternTime(iso: string, options: Intl.DateTimeFormatOptions): string {
	const date = new Date(iso);
	if (Number.isNaN(date.getTime())) return '';
	return date.toLocaleString('en-US', { timeZone: 'America/New_York', ...options });
}

/**
 * Builds the whole Slack message. Everything except the two briefs is deterministic, straight
 * from ESPN: ESPN lists fights first-to-last, so the last one is the main event, and the fights
 * sharing the latest start time are the main card (everything earlier is prelims).
 */
export function formatAnnouncement(event: ScoreboardEvent, kind: AnnounceKind, briefs: Briefs = {}): string {
	const fights = [...(event.competitions ?? [])].reverse(); // main event first
	const [main, coMain, ...rest] = fights;

	const header = [`*${event.name}*${kind === 'recap' ? ' results' : ''}`];
	const day = easternTime(event.date, { weekday: 'short', month: 'short', day: 'numeric' });
	const venue = event.venues?.[0]?.fullName;
	const where = [day, venue].filter(Boolean).join(' · ');
	if (where) header.push(where);
	const sections: string[] = [header.join('\n')];

	const featured = (title: string, comp: Competition | undefined, brief: string | undefined) => {
		if (!comp) return;
		const lines = [`*${title}*: ${fightLine(comp, kind)}`];
		if (brief?.trim()) lines.push(brief.trim());
		sections.push(lines.join('\n'));
	};
	featured('Main event', main, briefs.main);
	featured('Co-main', coMain, briefs.coMain);

	const mainCardDate = main?.date;
	const split = mainCardDate !== undefined && fights.some((f) => f.date !== mainCardDate);
	const list = (title: string, comps: Competition[], startIso?: string) => {
		if (comps.length === 0) return;
		const start = kind === 'preview' && startIso ? easternTime(startIso, { hour: 'numeric', minute: '2-digit' }) : '';
		const heading = start ? `*${title}* (${start} ET)` : `*${title}*`;
		sections.push([heading, ...comps.map((c) => `• ${fightLine(c, kind)}`)].join('\n'));
	};
	if (split) {
		const prelims = rest.filter((f) => f.date !== mainCardDate);
		list('Main card', rest.filter((f) => f.date === mainCardDate), mainCardDate);
		list('Prelims', prelims, prelims[prelims.length - 1]?.date);
	} else {
		// ESPN gave no per-fight start times to split on.
		list('Rest of the card', rest);
	}

	return sections.join('\n\n');
}

/** The model is asked for one paragraph per featured fight; anything else is treated as a single brief. */
export function parseBriefs(text: string, hasCoMain: boolean): Briefs {
	const paragraphs = text
		.split(/\n\s*\n/)
		.map((p) => p.trim())
		.filter(Boolean);
	if (paragraphs.length === 0) return {};
	if (!hasCoMain || paragraphs.length === 1) return { main: paragraphs.join(' ') };
	return { main: paragraphs[0], coMain: paragraphs.slice(1).join(' ') };
}

async function generateBriefs(kind: AnnounceKind, event: ScoreboardEvent, env: Env): Promise<Briefs> {
	const [main, coMain] = [...(event.competitions ?? [])].reverse();
	if (!main) return {};

	const describe = (comp: Competition) => ({ weightClass: comp.type?.abbreviation ?? '', fighters: sortedFighters(comp) });
	const fightsJson = JSON.stringify({
		event: event.name,
		mainEvent: describe(main),
		...(coMain ? { coMain: describe(coMain) } : {}),
	});
	const count = coMain ? 'exactly two paragraphs separated by one blank line: the main event first, then the co-main' : 'exactly one paragraph';
	const task =
		kind === 'preview'
			? 'Brief me on these upcoming fights: the key angle and your pick for each.'
			: 'Brief me on how these fights from last night went: the result, how it happened, and what it means.';
	const prompt = `${task} ${fightsJson}
Write ${count}. Two sentences per fight, three at most for a title fight. Do not restate names, records, or weight classes as a heading, they are already shown above your text. Do not mention any other fight on the card. No labels, no lists, no preamble.`;

	const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });
	const result = await generateText({
		model: openrouter(env.MODEL_ID),
		stopWhen: stepCountIs(5),
		tools: getTools(env),
		system: buildSystemPrompt(),
		messages: [{ role: 'user', content: prompt }],
	});
	return parseBriefs(result.text, coMain !== undefined);
}

async function runAnnouncement(kind: AnnounceKind, env: Env): Promise<void> {
	// Guard first, before any network call.
	if (!env.ANNOUNCE_USER_ID) {
		console.log('[announce] no recipient configured, skipping');
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

		// The card itself needs no model; if the briefs fail, still send the card.
		let briefs: Briefs = {};
		try {
			briefs = await generateBriefs(kind, eventData, env);
		} catch (err) {
			console.error(`[announce] ${kind} briefs failed, sending card only: ${err instanceof Error ? err.message : String(err)}`);
		}

		const text = formatAnnouncement(eventData, kind, briefs);
		const reply = text.length > 3900 ? text.slice(0, 3897) + '...' : text;

		// Slack accepts a user ID as the channel and delivers it as a DM from the bot.
		await postMessage(env.SLACK_BOT_TOKEN, env.ANNOUNCE_USER_ID, reply);

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
