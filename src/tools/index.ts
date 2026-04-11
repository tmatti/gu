import { lookupFighter } from './fighters';
import { lookupEvents } from './events';
import { lookupRankings } from './rankings';

type Env = { FIGHTERS_KV: KVNamespace };

export function getTools(env: Env) {
	return {
		lookupFighter: lookupFighter(env),
		lookupEvents: lookupEvents(),
		lookupRankings: lookupRankings(),
	};
}
