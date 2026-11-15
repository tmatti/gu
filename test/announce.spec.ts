import { env, createExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import {
	pickPreviewEvent,
	pickRecapEvent,
	handleScheduled,
	formatAnnouncement,
	parseBriefs,
	PREVIEW_CRON,
	RECAP_CRON,
} from '../src/announce';
import type { ScoreboardEvent } from '../src/espn';
import wranglerRaw from '../wrangler.jsonc?raw';

const NOW = new Date('2026-07-07T12:00:00Z');

function makeEvent(overrides: {
	id?: string;
	name?: string;
	date: string;
	completed?: boolean;
}): ScoreboardEvent {
	return {
		id: overrides.id ?? '1',
		name: overrides.name ?? 'UFC Test',
		date: overrides.date,
		competitions: [
			{
				status: overrides.completed === undefined ? undefined : { type: { completed: overrides.completed } },
				competitors: [
					{ order: 0, athlete: { displayName: 'Fighter A' } },
					{ order: 1, athlete: { displayName: 'Fighter B' } },
				],
			},
		],
	};
}

function hoursFromNow(h: number): string {
	return new Date(NOW.getTime() + h * 60 * 60 * 1000).toISOString();
}

describe('pickPreviewEvent', () => {
	it('returns an event 12h in the future', () => {
		const events = [makeEvent({ date: hoursFromNow(12) })];
		expect(pickPreviewEvent(events, NOW)?.date).toBe(hoursFromNow(12));
	});

	it('returns null for an event 5 days out', () => {
		const events = [makeEvent({ date: hoursFromNow(24 * 5) })];
		expect(pickPreviewEvent(events, NOW)).toBeNull();
	});

	it('returns a late Saturday-night card ~40h out', () => {
		const events = [makeEvent({ date: hoursFromNow(40) })];
		expect(pickPreviewEvent(events, NOW)?.date).toBe(hoursFromNow(40));
	});

	it('returns an event exactly at +48h (inclusive boundary)', () => {
		const events = [makeEvent({ date: hoursFromNow(48) })];
		expect(pickPreviewEvent(events, NOW)?.date).toBe(hoursFromNow(48));
	});

	it('returns null for an event just past the +48h boundary', () => {
		const events = [makeEvent({ date: hoursFromNow(49) })];
		expect(pickPreviewEvent(events, NOW)).toBeNull();
	});

	it('returns null for a past event', () => {
		const events = [makeEvent({ date: hoursFromNow(-4) })];
		expect(pickPreviewEvent(events, NOW)).toBeNull();
	});

	it('returns null for an empty list', () => {
		expect(pickPreviewEvent([], NOW)).toBeNull();
	});

	it('returns the first matching event', () => {
		const events = [makeEvent({ id: 'a', date: hoursFromNow(10) }), makeEvent({ id: 'b', date: hoursFromNow(20) })];
		expect(pickPreviewEvent(events, NOW)?.id).toBe('a');
	});

	it('ignores non-UFC promotions and picks the UFC card', () => {
		const events = [
			makeEvent({ id: 'pfl', name: 'PFL 8: Playoffs', date: hoursFromNow(10) }),
			makeEvent({ id: 'ufc', name: 'UFC Fight Night: Whittaker vs. Krylov', date: hoursFromNow(20) }),
		];
		expect(pickPreviewEvent(events, NOW)?.id).toBe('ufc');
	});

	it('returns null when the only in-window event is non-UFC', () => {
		const events = [makeEvent({ name: 'Bellator 320', date: hoursFromNow(12) })];
		expect(pickPreviewEvent(events, NOW)).toBeNull();
	});
});

describe('pickRecapEvent', () => {
	it('returns a past event 12h ago with a completed competition', () => {
		const events = [makeEvent({ date: hoursFromNow(-12), completed: true })];
		expect(pickRecapEvent(events, NOW)?.date).toBe(hoursFromNow(-12));
	});

	it('returns null for a past event with no completed competitions', () => {
		const events = [makeEvent({ date: hoursFromNow(-12), completed: false })];
		expect(pickRecapEvent(events, NOW)).toBeNull();
	});

	it('returns null when competition has no status', () => {
		const events = [makeEvent({ date: hoursFromNow(-12) })];
		expect(pickRecapEvent(events, NOW)).toBeNull();
	});

	it('returns null for future-only events', () => {
		const events = [makeEvent({ date: hoursFromNow(12), completed: true })];
		expect(pickRecapEvent(events, NOW)).toBeNull();
	});

	it('returns an event exactly at -36h with a completed fight (inclusive boundary)', () => {
		const events = [makeEvent({ date: hoursFromNow(-36), completed: true })];
		expect(pickRecapEvent(events, NOW)?.date).toBe(hoursFromNow(-36));
	});

	it('ignores a completed non-UFC card', () => {
		const events = [makeEvent({ name: 'PFL 8: Playoffs', date: hoursFromNow(-12), completed: true })];
		expect(pickRecapEvent(events, NOW)).toBeNull();
	});

	it('returns null for an event more than 36h ago', () => {
		const events = [makeEvent({ date: hoursFromNow(-48), completed: true })];
		expect(pickRecapEvent(events, NOW)).toBeNull();
	});

	it('returns null for an empty list', () => {
		expect(pickRecapEvent([], NOW)).toBeNull();
	});
});

function fight(
	date: string,
	weightClass: string,
	a: [string, string],
	b: [string, string],
	winner?: 'a' | 'b',
): ScoreboardEvent['competitions'][number] {
	return {
		date,
		type: { abbreviation: weightClass },
		status: { type: { completed: winner !== undefined } },
		competitors: [
			// Deliberately out of order: formatting must sort by `order`.
			{ order: 2, winner: winner === 'b', athlete: { displayName: b[0] }, records: [{ summary: b[1] }] },
			{ order: 1, winner: winner === 'a', athlete: { displayName: a[0] }, records: [{ summary: a[1] }] },
		],
	};
}

function makeCard(withResults = false): ScoreboardEvent {
	const w = (x: 'a' | 'b') => (withResults ? x : undefined);
	return {
		id: '1',
		name: 'UFC 334: Gane vs. Hokit',
		date: '2026-11-14T22:00Z',
		venues: [{ fullName: 'Test Arena' }],
		// ESPN order: first fight of the night first, main event last.
		competitions: [
			fight('2026-11-14T22:00Z', 'Lightweight', ['Evan Elder', '11-2-0'], ['Samuel Sanches', '11-2-0'], w('a')),
			fight('2026-11-15T00:00Z', 'Welterweight', ['Stephen Thompson', '18-9-1'], ['Charles Radtke', '12-6-0'], w('b')),
			fight('2026-11-15T02:00Z', 'Middleweight', ['Caio Borralho', '19-2-0'], ['Yousri Belgaroui', '11-4-0'], w('a')),
			fight('2026-11-15T02:00Z', 'W Bantamweight', ['Kayla Harrison', '20-1-0'], ['Amanda Nunes', '23-6-0'], w('b')),
			fight('2026-11-15T02:00Z', 'Heavyweight', ['Ciryl Gane', '15-2-0'], ['Josh Hokit', '10-1-0'], w('a')),
		],
	};
}

describe('formatAnnouncement', () => {
	it('briefs the main and co-main, then lists the main card and prelims', () => {
		const text = formatAnnouncement(makeCard(), 'preview', { main: 'Main brief.', coMain: 'Co-main brief.' });
		expect(text).toBe(
			[
				'*UFC 334: Gane vs. Hokit*',
				'Sat, Nov 14 · Test Arena',
				'',
				'*Main event*: Heavyweight: Ciryl Gane (15-2-0) vs. Josh Hokit (10-1-0)',
				'Main brief.',
				'',
				'*Co-main*: W Bantamweight: Kayla Harrison (20-1-0) vs. Amanda Nunes (23-6-0)',
				'Co-main brief.',
				'',
				'*Main card* (9:00 PM ET)',
				'• Middleweight: Caio Borralho (19-2-0) vs. Yousri Belgaroui (11-4-0)',
				'',
				'*Prelims* (5:00 PM ET)',
				'• Welterweight: Stephen Thompson (18-9-1) vs. Charles Radtke (12-6-0)',
				'• Lightweight: Evan Elder (11-2-0) vs. Samuel Sanches (11-2-0)',
			].join('\n'),
		);
	});

	it('still produces the card when there are no briefs', () => {
		const text = formatAnnouncement(makeCard(), 'preview');
		expect(text).toContain('*Main event*: Heavyweight: Ciryl Gane (15-2-0) vs. Josh Hokit (10-1-0)\n\n*Co-main*');
	});

	it('lists recap results winner-first with "def."', () => {
		const text = formatAnnouncement(makeCard(true), 'recap');
		expect(text).toContain('*UFC 334: Gane vs. Hokit* results');
		expect(text).toContain('*Main event*: Heavyweight: Ciryl Gane (15-2-0) def. Josh Hokit (10-1-0)');
		expect(text).toContain('*Co-main*: W Bantamweight: Amanda Nunes (23-6-0) def. Kayla Harrison (20-1-0)');
		expect(text).toContain('• Welterweight: Charles Radtke (12-6-0) def. Stephen Thompson (18-9-1)');
		expect(text).not.toContain('ET)');
	});

	it('uses a single list when fights have no distinct start times', () => {
		const card = makeCard();
		for (const c of card.competitions) c.date = undefined;
		const text = formatAnnouncement(card, 'preview');
		expect(text).toContain('*Rest of the card*');
		expect(text).not.toContain('*Prelims*');
	});
});

describe('parseBriefs', () => {
	it('splits two paragraphs into main and co-main', () => {
		expect(parseBriefs('Main take.\n\nCo-main take.\n', true)).toEqual({ main: 'Main take.', coMain: 'Co-main take.' });
	});

	it('treats a single paragraph as the main brief', () => {
		expect(parseBriefs('Only one.', true)).toEqual({ main: 'Only one.' });
		expect(parseBriefs('One.\n\nTwo.', false)).toEqual({ main: 'One. Two.' });
	});

	it('returns nothing for empty text', () => {
		expect(parseBriefs('  \n', true)).toEqual({});
	});
});

describe('handleScheduled', () => {
	it('short-circuits when no recipient is configured', async () => {
		const ctx = createExecutionContext();
		const testEnv = { ...env, ANNOUNCE_USER_ID: '' } as Parameters<typeof handleScheduled>[1];
		await expect(handleScheduled({ cron: PREVIEW_CRON } as ScheduledController, testEnv, ctx)).resolves.toBeUndefined();
	});
});

describe('cron config', () => {
	it('wrangler.jsonc crons stay byte-identical to the dispatch constants', () => {
		const json = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
		expect(json.triggers.crons).toEqual([PREVIEW_CRON, RECAP_CRON]);
	});
});
