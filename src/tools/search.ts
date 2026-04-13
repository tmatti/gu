import { tool } from 'ai';
import { z } from 'zod';

const schema = z.object({
	query: z.string().describe('The search query to look up on the web.'),
});

type Env = { BRAVE_API_KEY: string };

export function webSearch(env: Env) {
	return tool({
		description: 'Search the web via Brave. Use for news, articles, social media posts, or any info not covered by the other tools.',
		inputSchema: schema,
		execute: async (input) => {
			const params = new URLSearchParams({ q: input.query, count: '5' });
			const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
				headers: { 'X-Subscription-Token': env.BRAVE_API_KEY, Accept: 'application/json' },
			});
			if (!res.ok) {
				return { error: `Brave Search API error: ${res.status}` };
			}
			const data = (await res.json()) as { web?: { results?: { title: string; url: string; description: string }[] } };
			const results = (data.web?.results ?? []).map((item) => ({
				title: item.title,
				url: item.url,
				snippet: item.description,
			}));
			return { query: input.query, results };
		},
	});
}
