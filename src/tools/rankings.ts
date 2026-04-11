import { tool } from 'ai';
import { z } from 'zod';
import { fetchRankings } from '../espn';

// Values match ESPN's `type` field in the rankings response
const WEIGHT_CLASSES = [
	'pound-for-pound',
	'womens-pound-for-pound',
	'heavyweight',
	'light-heavyweight',
	'middleweight',
	'welterweight',
	'lightweight',
	'featherweight',
	'bantamweight',
	'flyweight',
	'womens-bantamweight',
	'womens-strawweight',
	'womens-flyweight',
] as const;

const schema = z.object({
	weightClass: z.enum(WEIGHT_CLASSES).describe('The weight class or ranking category to look up'),
});

export function lookupRankings() {
	return tool({
		description: 'Look up current UFC rankings for a weight class or pound-for-pound list.',
		inputSchema: schema,
		execute: async (input) => {
			const data = await fetchRankings();

			// Find the matching division (prefer the division rankings over champions-only)
			const division = data.rankings.find((r) => r.type === input.weightClass);
			if (!division) {
				return { found: false, message: `No rankings found for "${input.weightClass}"` };
			}

			const champion = division.ranks.find((r) => r.hasAccolade);
			const ranked = division.ranks.filter((r) => !r.hasAccolade);

			return {
				division: division.name,
				champion: champion
					? {
							name: champion.athlete.displayName,
							record: champion.recordSummary,
							defenses: champion.defenses ?? 0,
							age: champion.athlete.age ?? null,
							country: champion.athlete.citizenshipCountry?.name ?? '',
						}
					: null,
				rankings: ranked.map((r) => ({
					rank: r.current,
					name: r.athlete.displayName,
					record: r.recordSummary,
					age: r.athlete.age ?? null,
					country: r.athlete.citizenshipCountry?.name ?? '',
				})),
			};
		},
	});
}
