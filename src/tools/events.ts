import { tool } from 'ai';
import { z } from 'zod';
import { fetchScoreboard } from '../espn';

const schema = z.object({
	query: z.string().optional().describe("Optional search term (e.g. 'UFC 300', 'next event'). Leave empty for the nearest upcoming event."),
});

export function lookupEvents() {
	return tool({
		description: 'Look up upcoming or past UFC/MMA events. Returns event name, date, location, and main card fights.',
		inputSchema: schema,
		execute: async (input) => {
			const data = await fetchScoreboard();

			// If a query is provided, search the full year calendar
			if (input.query) {
				const q = input.query.toLowerCase();
				const matches = (data.leagues[0]?.calendar ?? [])
					.filter((e) => e.label.toLowerCase().includes(q))
					.slice(0, 5)
					.map((e) => ({ name: e.label, startDate: e.startDate, endDate: e.endDate }));
				return { query: input.query, calendarMatches: matches };
			}

			// Otherwise return nearest event(s) with full fight card
			const events = (data.events ?? []).map((event) => ({
				name: event.name,
				date: event.date,
				venue: event.venues?.[0]
					? `${event.venues[0].fullName}, ${event.venues[0].address?.city ?? ''} ${event.venues[0].address?.country ?? ''}`.trim()
					: null,
				fights: event.competitions.map((comp) => {
					const [a, b] = comp.competitors.sort((x, y) => x.order - y.order);
					return {
						weightClass: comp.type?.abbreviation ?? '',
						fighterA: {
							name: a?.athlete.displayName ?? '',
							record: a?.records?.[0]?.summary ?? '',
							country: a?.athlete.flag?.description ?? '',
						},
						fighterB: {
							name: b?.athlete.displayName ?? '',
							record: b?.records?.[0]?.summary ?? '',
							country: b?.athlete.flag?.description ?? '',
						},
					};
				}),
			}));

			return { events };
		},
	});
}
