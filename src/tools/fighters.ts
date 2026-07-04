import { tool } from 'ai';
import { z } from 'zod';
import { searchAthletes } from '../espn';

const schema = z.object({
	name: z.string().describe("Fighter's full name or last name"),
});

type Env = { FIGHTERS_KV: KVNamespace };

export function lookupFighter(env: Env) {
	return tool({
		description:
			'Quick stat lookup for a UFC fighter from a cached ESPN dataset: record, weight class, height, reach, stance, age. Data may be stale or missing. Never use for news, recent results, or analysis — use webSearch for those.',
		inputSchema: schema,
		execute: async (input) => {
			const results = await searchAthletes(env.FIGHTERS_KV, input.name);
			if (results.length === 0) {
				return { found: false, message: `No fighter found matching "${input.name}". The cache may not be populated yet.` };
			}
			return { found: true, fighters: results };
		},
	});
}
