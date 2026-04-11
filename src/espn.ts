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
    console.log(`[espn] fetching athlete list page ${page}/${totalPages}`);
    const res = await fetch(
      `${ESPN_CORE}/athletes?limit=100&page=${page}`
    );
    if (!res.ok) {
      console.error(`[espn] athlete list page ${page} failed: ${res.status} ${res.statusText}`);
      break;
    }
    const data = (await res.json()) as CoreAthleteListResponse;
    totalPages = data.pageCount;
    console.log(`[espn] page ${page}/${totalPages}: ${data.items.length} refs, total athletes so far: ${ids.length}`);

    for (const item of data.items) {
      // Extract ID from $ref URL like "http://sports.core.api.espn.com/v2/sports/mma/athletes/12345?..."
      const match = item.$ref.match(/\/athletes\/(\d+)/);
      if (match) ids.push(match[1]);
    }

    page++;
  } while (page <= totalPages);

  console.log(`[espn] fetchAllAthleteIds complete: ${ids.length} total IDs`);
  return ids;
}

export async function fetchAthleteDetail(id: string): Promise<AthleteData | null> {
  try {
    const res = await fetch(`${ESPN_WEB}/${id}`);
    if (!res.ok) {
      console.warn(`[espn] athlete ${id} returned ${res.status} ${res.statusText}`);
      return null;
    }
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
  } catch (err) {
    console.error(`[espn] fetchAthleteDetail(${id}) threw: ${err}`);
    return null;
  }
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
