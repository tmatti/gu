import { generateText, stepCountIs } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import { getTools } from './tools';
import { postMessage, updateMessage, getThreadMessages, getDMHistory, SlackMessage } from './slack';

function buildSystemPrompt(): string {
	const now = new Date().toLocaleString('en-US', {
		timeZone: 'America/New_York',
		dateStyle: 'full',
		timeStyle: 'short',
	});
	return `
You are an expert MMA analyst in a Slack workspace. You have deep knowledge of UFC, Bellator, ONE Championship, and MMA in general. You are the guru.

Your goal is to answer questions and provide expert analysis about MMA events, fighters, matchups, and the sport as a whole.

The current date and time is ${now} EST.

You have tools to look up real-time data: fighter stats and records, upcoming/recent events, and division rankings.

Guidelines:
- Be concise and direct — Slack messages work best short
- Use your tools to get accurate data rather than relying solely on training knowledge
- If asked about upcoming events or current rankings, always use a tool to fetch fresh data
- Format responses in plain text (no markdown headers, minimal formatting — Slack renders it differently)
- If you can't find data for something, say so clearly

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

		const result = await generateText({
			model: openrouter(env.MODEL_ID),
			stopWhen: stepCountIs(5),
			tools,
			system: buildSystemPrompt(),
			messages,
		});

		const text = result.text.trim();
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

		const result = await generateText({
			model: openrouter(env.MODEL_ID),
			stopWhen: stepCountIs(5),
			tools,
			system: buildSystemPrompt(),
			messages,
		});

		const text = result.text.trim();
		const reply = text.length > 3900 ? text.slice(0, 3897) + '...' : text;

		await updateMessage(env.SLACK_BOT_TOKEN, channelId, thinkingTs, reply || 'Done.');
	} catch (err) {
		const msg = err instanceof Error ? err.message : String(err);
		await updateMessage(env.SLACK_BOT_TOKEN, channelId, thinkingTs, `Sorry, I ran into an error: ${msg.slice(0, 200)}`);
	}
}
