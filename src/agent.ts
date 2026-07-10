import { generateText, stepCountIs, LanguageModel, ToolSet } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getTools } from './tools';
import { postMessage, updateMessage, getThreadMessages, getDMHistory, SlackMessage } from './slack';

type ChatMessage = { role: 'user' | 'assistant'; content: string };

/**
 * Run the agent loop and always return a written answer.
 *
 * If the loop ends on a tool-call step (because it hit the step limit
 * mid-research), `result.text` is empty. Rather than surface a bare "Done.", we
 * make one more call with the tool results already in context and tools
 * disabled, forcing the model to write the final reply.
 *
 * The step budget is deliberately capped: this whole loop runs inside a
 * Cloudflare `waitUntil()`, which the runtime cancels if it runs too long, so
 * we trade a longer research chain for reliably finishing before that cutoff.
 */
async function generateReply(model: LanguageModel, system: string, messages: ChatMessage[], tools: ToolSet): Promise<string> {
	const result = await generateText({
		model,
		stopWhen: stepCountIs(12),
		tools,
		system,
		messages,
	});

	let text = result.text.trim();
	if (!text) {
		const followUp = await generateText({
			model,
			system,
			messages: [...messages, ...result.response.messages],
		});
		text = followUp.text.trim();
	}

	return text;
}

export function buildSystemPrompt(): string {
	const now = new Date().toLocaleString('en-US', {
		timeZone: 'America/New_York',
		dateStyle: 'full',
		timeStyle: 'short',
	});
	return `
You are an expert MMA analyst in a Slack workspace. You have deep knowledge of UFC, Bellator, ONE Championship, and MMA in general. You are the guru.

Your goal is to answer questions and provide expert analysis about MMA events, fighters, matchups, and the sport as a whole.

The current date and time is ${now} EST.

Tool routing:
- webSearch is your default for anything time-sensitive or analytical: fight news, results, injuries, odds, fighter form, event cards, matchup analysis. When a search result looks promising, use readPage to read the full article — snippets alone are not enough for a real breakdown.
- The lookup tools (lookupFighter, lookupEvents, lookupRankings) only hold basic cached stats and may be stale or incomplete. Use them for a quick structured stat (record, reach, ranking number), then cross-check anything important with webSearch.
- If you can't find data for something, say so clearly rather than guessing.

Response length — pick a mode before you write:

BANTER MODE (default): general chat, hot takes, one-off questions, reactions.
1-3 sentences, tweet-length. No lists, no headers. One take, land it, done.

ANALYSIS MODE: only when the user explicitly asks for a breakdown, prediction, card preview, or fighter comparison. Go long enough to actually cover it — 2-4 sentences per fight for a card, a few short paragraphs for a matchup. Blank line between fights. Every line is a stat, an angle, or a take — no filler, no preamble.

If unsure which mode, use banter mode. Never respond to a one-line message with a wall of text.

Format responses in plain text (no markdown headers, minimal formatting).

Your personality :
- British
- Brash and provocative
- Hyperbolic takes
- Raw, unfiltered voice that says what a certain section of the fan base is thinking
- Respect for wrestlers from Dagestan and Russia despite having a huge bias against them
- Extremely biased toward fan-favorite strikers and openly hostile toward wrestlers
- Villain energy
- You hate Jon Jones
- Refer to old legends as 'crafty vet'
- "People forget man"
- Make fun of Joe Rogan
`;
}

interface Env {
	SLACK_BOT_TOKEN: string;
	OPENROUTER_API_KEY: string;
	MODEL_ID: string;
	FIGHTERS_KV: KVNamespace;
	BRAVE_API_KEY: string;
}

function convertToMessages(slackMessages: SlackMessage[], botUserId: string): { role: 'user' | 'assistant'; content: string }[] {
	return slackMessages
		.filter((m) => m.text?.trim())
		.map((m) => ({
			role: m.bot_id || m.user === botUserId ? 'assistant' : 'user',
			content: m.text,
		}));
}

export async function handleMention(
	userText: string,
	channelId: string,
	eventTs: string,
	threadTs: string | undefined,
	env: Env,
): Promise<void> {
	// Post "thinking..." immediately in thread
	const thinkingTs = await postMessage(env.SLACK_BOT_TOKEN, channelId, 'thinking...', threadTs ?? eventTs);

	try {
		const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });

		// Build message history from thread if this is a reply in a thread
		let messages: { role: 'user' | 'assistant'; content: string }[] = [];
		if (threadTs) {
			const threadMessages = await getThreadMessages(env.SLACK_BOT_TOKEN, channelId, threadTs);
			// Exclude the last message (the current one) to avoid duplication
			const history = threadMessages.slice(0, -1);
			messages = convertToMessages(history, '');
		}

		// Always append the current user message
		messages.push({ role: 'user', content: userText });

		const tools = getTools(env);

		const text = await generateReply(openrouter(env.MODEL_ID), buildSystemPrompt(), messages, tools);
		const reply = text.length > 3900 ? text.slice(0, 3897) + '...' : text;

		await updateMessage(env.SLACK_BOT_TOKEN, channelId, thinkingTs, reply || 'Done.');
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await updateMessage(env.SLACK_BOT_TOKEN, channelId, thinkingTs, `Sorry, I ran into an error: ${msg.slice(0, 200)}`);
	}
}

export async function handleDM(userText: string, channelId: string, eventTs: string, env: Env): Promise<void> {
	const thinkingTs = await postMessage(env.SLACK_BOT_TOKEN, channelId, 'thinking...');

	try {
		const openrouter = createOpenRouter({ apiKey: env.OPENROUTER_API_KEY });

		// Load recent DM history (up to 20 messages within the last hour), excluding the current message
		const dmHistory = await getDMHistory(env.SLACK_BOT_TOKEN, channelId);
		const history = dmHistory.filter((m) => m.ts !== eventTs);
		const messages = convertToMessages(history, '');

		messages.push({ role: 'user', content: userText });

		const tools = getTools(env);

		const text = await generateReply(openrouter(env.MODEL_ID), buildSystemPrompt(), messages, tools);
		const reply = text.length > 3900 ? text.slice(0, 3897) + '...' : text;

		await updateMessage(env.SLACK_BOT_TOKEN, channelId, thinkingTs, reply || 'Done.');
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await updateMessage(env.SLACK_BOT_TOKEN, channelId, thinkingTs, `Sorry, I ran into an error: ${msg.slice(0, 200)}`);
	}
}
