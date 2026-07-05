import { tool } from 'ai';
import { z } from 'zod';

const schema = z.object({
	query: z.string().describe('The search query to look up on the web.'),
});

type Env = { BRAVE_API_KEY: string };

export function webSearch(env: Env) {
	return tool({
		description:
			'Primary research tool. Search the web via Brave for anything current or analytical: fight news, results, injuries, odds, matchup analysis, fighter form, event cards. Prefer this over the lookup tools unless you only need a single structured stat. Follow up with readPage on promising results to get full article text.',
		inputSchema: schema,
		execute: async (input) => {
			const params = new URLSearchParams({ q: input.query, count: '8', extra_snippets: 'true' });
			const res = await fetch(`https://api.search.brave.com/res/v1/web/search?${params}`, {
				headers: { 'X-Subscription-Token': env.BRAVE_API_KEY, Accept: 'application/json' },
			});
			if (!res.ok) {
				return { error: `Brave Search API error: ${res.status}` };
			}
			const data = (await res.json()) as {
				web?: { results?: { title: string; url: string; description: string; extra_snippets?: string[] }[] };
			};
			const results = (data.web?.results ?? []).map((item) => ({
				title: item.title,
				url: item.url,
				snippet: item.description,
				extraSnippets: item.extra_snippets ?? [],
			}));
			return { query: input.query, results };
		},
	});
}
