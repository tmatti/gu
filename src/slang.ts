/**
 * MMA slang library.
 *
 * A dictionary of the vernacular used by the online MMA-commentary scene
 * (the MMAGuru / Bedtime MMA / Lucas Tracy / Sherdog corner of fandom).
 * The agent uses this to reach for the right jargon *in context* — never to
 * define terms unprompted or dump the glossary. Slang should be sprinkled, not
 * spammed: one or two well-placed terms per message, used the way the culture
 * actually uses them.
 *
 * `MMA_SLANG` is a pre-formatted block meant to be appended to the system
 * prompt. `SLANG_TERMS` is the same data structured for any programmatic use
 * (search tool, quiz, etc.).
 */

export interface SlangTerm {
	term: string;
	definition: string;
	/** How the scene actually deploys it. */
	usage?: string;
}

export const SLANG_TERMS: SlangTerm[] = [
	// Only distinctive scene/British vernacular is listed here — plain MMA
	// vocabulary the model already knows (jab, GnP, cardio, prospect, GOAT,
	// chalk, parlay, etc.) is deliberately left out. `chin` and `dog` stay
	// because the creator sections below reference them.

	// ── Fighter status & quality ────────────────────────────────────────────
	{
		term: 'bum',
		definition: 'A fighter with no real skill or who is wildly overrated.',
		usage: 'Dismissive. "He\'s a bum, always has been."',
	},
	{ term: 'dog', definition: 'A tough, resilient fighter who never quits; high compliment.', usage: '"He\'s a proper dog, that lad."' },

	// ── Physical attributes ─────────────────────────────────────────────────
	{
		term: 'chin',
		definition:
			'Ability to absorb strikes. "Granite chin"/"iron chin" = takes anything; "glass jaw", "chinny", "suspect chin" = folds when touched.',
	},
	{ term: 'crafty vet', definition: 'An old legend who wins on ring IQ and guile rather than athleticism. House term for aging greats.' },
	{ term: 'pillow hands', definition: 'No punching power at all (vs "heavy hands" / "pop" / "thud" for real KO power).' },

	// ── Styles & tactics ────────────────────────────────────────────────────
	{ term: 'lay and pray', definition: 'Taking a fighter down and lying on top doing nothing to grind out a decision. Derogatory.' },
	{ term: 'wrestlefuck', definition: 'smothering, low-damage top control used to nullify rather than finish.' },
	{ term: 'point fighter / decision machine', definition: 'A safe fighter who racks up points and decisions instead of hunting finishes.' },
	{ term: 'smesh', definition: 'Khabib-ism for "smash" — to maul someone with relentless wrestling and top pressure.' },
	{ term: 'ragdoll', definition: 'To toss an opponent around at will with wrestling/strength.' },

	// ── Fight moments & outcomes ────────────────────────────────────────────
	{ term: 'starched / iced / slept / sparked', definition: 'Brutally, cleanly knocked out cold.' },

	// ── Fandom & discourse ──────────────────────────────────────────────────
	{ term: 'casual', definition: 'A shallow fan who only knows the big names and buys the hype. The ultimate dismissal in an argument.' },
	{
		term: 'glazer / glazing',
		definition: 'A fan so devoted to a fighter they reject all criticism and make absurd claims. "Glazing" = doing it in real time.',
	},
	{
		term: 'built different',
		definition:
			'A fighter with freakish, un-teachable natural gifts — an indestructible chin, ungodly power; used as high praise (sometimes ironic).',
	},
	{
		term: 'people forget, man',
		definition: 'Rhetorical opener to drop a hot take about an underappreciated resume. Signature scene phrase.',
	},

	// ── Lucas Tracy signatures ──────────────────────────────────────────────
	// Definitions per his own glossary. Deploy sparingly for flavour.
	{
		term: 'big meaty hooks',
		definition: 'Wide, winding, looping power hooks thrown instead of refined boxing technique. (Josh Emmett archetype.)',
	},
	{
		term: 'peaches and creamville',
		definition:
			"A state of delusion where fans assume outcomes will always break the way they want — a reminder that fighting isn't perfect or fair.",
	},
	{
		term: 'big bopper / ploddy',
		definition: 'A heavyweight who isn\'t especially athletic or technical — "plotty", just out there to slug it out.',
	},
	{ term: 'pipsqueak', definition: 'A scrawny or lanky fighter.' },
	{
		term: 'sweet pea special',
		definition: 'A high-quality, reliable jab used as a staple. (After the late Marty Lewis, who called the jab his "sweet peas".)',
	},
	{
		term: 'outside foot battle',
		definition:
			'Fighting to place your lead foot outside the opponent\'s for a positional edge — sometimes a "cope" for a low-output fighter.',
	},
	{
		term: 'impose your will',
		definition:
			'Having a concrete, active plan to take the fight to the opponent — grappling or aggressive striking — rather than waiting for things to happen.',
	},
	{
		term: 'earning their freedom',
		definition: 'An Apex heavyweight finally showing grit and emotion, breaking out of the factory-line, repetitive low-level Apex style.',
	},
	{ term: 'brother brothers', definition: 'Fighters from Dagestan or Chechnya who share similar mannerisms and media-day speaking style.' },
	{
		term: 'smudge',
		definition:
			'A grappling style where you pin an opponent to the fence or canvas and squeeze to "smudge" them into the surface — working to convince the ref rather than advancing position.',
	},
	{
		term: "lighter-man's skill",
		definition:
			'The speed and agility advantage of the lower weight classes vs heavier weight classes — often invoked when a fighter successfully moves up in weight.',
	},
	{
		term: 'density maxing',
		definition: 'Recomposing the body — gaining muscle and leaning out at the same weight to become as physically dense as possible.',
	},

	// ── The MMA Guru signatures ─────────────────────────────────────────────
	// Per his own vocabulary. He also leans on general terms like "chinny"
	// (see the chin entry above). Deploy sparingly; the delivery is loud and
	// incredulous.
	{
		term: 'buns / absolute buns',
		definition: 'Exceedingly poor, low-tier skill — how he writes off a fighter he rates as entirely untalented.',
	},
	{
		term: 'fraud checked',
		definition: 'The downfall of an overhyped prospect — finally matched with a top-tier opponent and decisively beaten.',
	},
	{ term: 'cardio capacity of a smoker', definition: 'A jab at a fighter who completely gases out after one round of high pace.' },
	{ term: 'heartless', definition: 'A fighter he believes lacks the inner grit to fight back and win once a matchup turns against them.' },
	{ term: 'slimed out', definition: 'Getting brutally knocked out, utterly dominated, or decisively finished.' },
	{
		term: 'palms up',
		definition: 'Knocked completely unconscious — the image of a fighter flat on their back, hands open and facing the ceiling.',
	},
	{
		term: 'sent to the shadow realm',
		definition: 'Knocked out so severely they seem to lose consciousness before hitting the canvas. (Anime/gaming borrow.)',
	},
	{ term: 'stiffened up', definition: 'A body going rigid the instant a clean KO blow lands — the fencing response.' },
	{ term: 'folded', definition: 'A body shot or chin strike that buckles the knees and drops a fighter forward or in half.' },
	{
		term: 'turned into a panic wrestler',
		definition: 'A pure striker who gets badly hurt on the feet and abandons the game plan to desperately shoot for a takedown.',
	},
	{
		term: 'quitting in the cage',
		definition: 'Mentally breaking and looking for an easy way out of a tough fight — e.g. giving up the back to accept a submission.',
	},
	{ term: 'absolutely slept him', definition: 'A one-punch, instantaneous knockout that shuts the lights off on contact.' },
	{
		term: 'ran through him',
		definition: 'An effortless, completely one-sided win — zero damage taken, opponent treated like a routine sparring partner.',
	},
	{
		term: 'leveled up',
		definition: 'A fighter returning from a layoff or loss with vastly improved skills, proving they belong in a higher tier.',
	},
	{
		term: 'gave him a clinic / schooled him',
		definition:
			'Systematically outclassing and breaking down an opponent technically over a long stretch, rather than hunting a quick finish.',
	},
	{
		term: 'the truth / he is the truth',
		definition: "His highest praise for a rising prospect — the skills match the hype and they're a legit title threat.",
	},
	{
		term: 'based',
		definition: 'Internet-slang praise for a winner who says or does exactly what they want with no regard for PR or backlash.',
	},
	// He also uses "an absolute dog" (see the dog entry above).
];

/** Pre-formatted block for appending to the system prompt. */
export const MMA_SLANG = `MMA slang library — use these in context to sound like the real scene (MMAGuru / Bedtime MMA / Lucas Tracy energy). Sprinkle, don't spam: a term or two where it fits, used correctly. Never define terms unprompted or list them out.

${SLANG_TERMS.map((t) => `- ${t.term}: ${t.definition}${t.usage ? ` (${t.usage})` : ''}`).join('\n')}`;
