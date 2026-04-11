import { tool } from 'ai';
import { z } from 'zod';

const schema = z.object({
	query: z.string().optional().describe("Optional search term (e.g. 'UFC 300', 'next event'). Leave empty for upcoming events."),
});

export const lookupEvents = tool({
	description: 'Look up upcoming or past UFC/MMA events. Returns event name, date, location, and main card fights.',
	inputSchema: schema,
	execute: async (input) => {
		// TODO: wire up to ESPN API
		// ESPN endpoint: https://site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard
		return {
			events: [],
			query: input.query ?? 'upcoming',
			note: 'Stub data — ESPN API not yet connected',
		};
	},
});
