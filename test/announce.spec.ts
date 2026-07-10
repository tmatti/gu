import { env, createExecutionContext } from 'cloudflare:test';
import { describe, it, expect } from 'vitest';
import { pickPreviewEvent, pickRecapEvent, handleScheduled, PREVIEW_CRON, RECAP_CRON } from '../src/announce';
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

describe('handleScheduled', () => {
	it('short-circuits when no channel is configured', async () => {
		const ctx = createExecutionContext();
		const testEnv = { ...env, ANNOUNCE_CHANNEL_ID: '' } as Parameters<typeof handleScheduled>[1];
		await expect(handleScheduled({ cron: PREVIEW_CRON } as ScheduledController, testEnv, ctx)).resolves.toBeUndefined();
	});
});

describe('cron config', () => {
	it('wrangler.jsonc crons stay byte-identical to the dispatch constants', () => {
		const json = JSON.parse(wranglerRaw.replace(/^\s*\/\/.*$/gm, '').replace(/,(\s*[}\]])/g, '$1'));
		expect(json.triggers.crons).toEqual([PREVIEW_CRON, RECAP_CRON]);
	});
});
