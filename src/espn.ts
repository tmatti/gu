const ESPN_CORE = "https://sports.core.api.espn.com/v2/sports/mma/leagues/ufc";
const ESPN_SITE = "https://site.api.espn.com/apis/site/v2/sports/mma/ufc";
const ESPN_WEB = "https://site.web.api.espn.com/apis/common/v3/sports/mma/athletes";

export interface AthleteData {
  id: string;
  name: string;
  weightClass: string;
  record: string;
  height: string;
  weight: string;
  reach: string;
  stance: string;
  age: number | null;
  country: string;
  active: boolean;
}

export interface NameIndexEntry {
  id: string;
  name: string;
}

interface CoreAthleteRef {
  $ref: string;
}

interface CoreAthleteListResponse {
  count: number;
  pageIndex: number;
  pageSize: number;
  pageCount: number;
  items: CoreAthleteRef[];
}

interface WebAthleteResponse {
  athlete: {
    id: string;
    displayName: string;
    fullName?: string;
    active?: boolean;
    displayHeight?: string;
    displayWeight?: string;
    displayReach?: string;
    stance?: string;
    age?: number;
    weightClass?: { text: string };
    flag?: { description?: string };
    statsSummary?: {
      statistics?: { name: string; displayValue: string }[];
    };
  };
}

interface ScoreboardResponse {
  leagues: {
    calendar: { label: string; startDate: string; endDate: string }[];
  }[];
  events: {
    id: string;
    name: string;
    date: string;
    venues?: { fullName: string; address?: { city?: string; country?: string } }[];
    competitions: {
      type?: { abbreviation: string };
      competitors: {
        order: number;
        winner?: boolean;
        athlete: { displayName: string; flag?: { description?: string } };
        records?: { summary: string }[];
      }[];
    }[];
  }[];
}

interface RankingsResponse {
  rankings: {
    id: string;
    name: string;
    type: string;
    ranks: {
      current: number;
      hasAccolade: boolean;
      recordSummary: string;
      defenses?: number;
      athlete: {
        id: string;
        displayName: string;
        age?: number;
        citizenshipCountry?: { name?: string };
      };
    }[];
  }[];
}

export async function fetchAllAthleteIds(): Promise<string[]> {
  const ids: string[] = [];
  let page = 1;
  let totalPages = 1;

  do {
    const res = await fetch(
      `${ESPN_CORE}/athletes?limit=100&page=${page}`
    );
    const data = (await res.json()) as CoreAthleteListResponse;
    totalPages = data.pageCount;

    for (const item of data.items) {
      // Extract ID from $ref URL like "http://sports.core.api.espn.com/v2/sports/mma/athletes/12345?..."
      const match = item.$ref.match(/\/athletes\/(\d+)/);
      if (match) ids.push(match[1]);
    }

    page++;
  } while (page <= totalPages);

  return ids;
}

export async function fetchAthleteDetail(id: string): Promise<AthleteData | null> {
  try {
    const res = await fetch(`${ESPN_WEB}/${id}`);
    if (!res.ok) return null;
    const data = (await res.json()) as WebAthleteResponse;
    const a = data.athlete;

    const record =
      a.statsSummary?.statistics?.find((s) => s.name === "wins-losses-draws")
        ?.displayValue ?? "";

    return {
      id: a.id,
      name: a.displayName ?? a.fullName ?? "",
      weightClass: a.weightClass?.text ?? "",
      record,
      height: a.displayHeight ?? "",
      weight: a.displayWeight ?? "",
      reach: a.displayReach ?? "",
      stance: a.stance ?? "",
      age: a.age ?? null,
      country: a.flag?.description ?? "",
      active: a.active ?? false,
    };
  } catch {
    return null;
  }
}

export async function buildAthleteCache(
  kv: KVNamespace
): Promise<{ count: number }> {
  const ids = await fetchAllAthleteIds();
  const nameIndex: NameIndexEntry[] = [];
  let count = 0;

  // Process in batches of 10 to avoid overwhelming ESPN
  for (let i = 0; i < ids.length; i += 10) {
    const batch = ids.slice(i, i + 10);
    const results = await Promise.all(batch.map(fetchAthleteDetail));

    for (const athlete of results) {
      if (!athlete || !athlete.name) continue;
      await kv.put(`athlete:${athlete.id}`, JSON.stringify(athlete));
      nameIndex.push({ id: athlete.id, name: athlete.name });
      count++;
    }
  }

  await kv.put("__name_index", JSON.stringify(nameIndex));
  return { count };
}

export async function searchAthletes(
  kv: KVNamespace,
  query: string
): Promise<AthleteData[]> {
  const raw = await kv.get("__name_index");
  if (!raw) return [];

  const index = JSON.parse(raw) as NameIndexEntry[];
  const q = query.toLowerCase();
  const matches = index
    .filter((e) => e.name.toLowerCase().includes(q))
    .slice(0, 3);

  const results = await Promise.all(
    matches.map(async (m) => {
      const raw = await kv.get(`athlete:${m.id}`);
      return raw ? (JSON.parse(raw) as AthleteData) : null;
    })
  );

  return results.filter((r): r is AthleteData => r !== null);
}

export async function fetchScoreboard(): Promise<ScoreboardResponse> {
  const res = await fetch(`${ESPN_SITE}/scoreboard`);
  return res.json() as Promise<ScoreboardResponse>;
}

export async function fetchRankings(): Promise<RankingsResponse> {
  const res = await fetch(`${ESPN_SITE}/rankings`);
  return res.json() as Promise<RankingsResponse>;
}
