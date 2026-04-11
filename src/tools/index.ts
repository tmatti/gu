// eslint-disable-next-line @typescript-eslint/no-explicit-any
import { type Tool } from 'ai';
import { lookupFighter } from './fighters';
import { lookupEvents } from './events';
import { lookupRankings } from './rankings';

type Env = { FIGHTERS_KV: KVNamespace };

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function withLogging<T extends Tool<any, any>>(name: string, t: T): T {
	return {
		...t,
		execute: async (input: unknown, opts: unknown) => {
			console.log(`[tool] ${name}`, JSON.stringify(input));
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			const result = await (t.execute as any)(input, opts);
			console.log(`[tool] ${name} done`);
			return result;
		},
	} as T;
}

export function getTools(env: Env) {
	return {
		lookupFighter: withLogging('lookupFighter', lookupFighter(env)),
		lookupEvents: withLogging('lookupEvents', lookupEvents()),
		lookupRankings: withLogging('lookupRankings', lookupRankings()),
	};
}
