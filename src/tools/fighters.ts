import { tool } from 'ai';
import { z } from 'zod';
import { searchAthletes } from '../espn';

const schema = z.object({
	name: z.string().describe("Fighter's full name or last name"),
});

type Env = { FIGHTERS_KV: KVNamespace };

export function lookupFighter(env: Env) {
	return tool({
		description: 'Look up a UFC/MMA fighter by name. Returns stats, record, weight class, and physical attributes.',
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
