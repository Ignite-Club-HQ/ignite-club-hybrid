import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: any; error: any };

const mocks = vi.hoisted(() => ({
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  listMatches: vi.fn(),
  listEntries: vi.fn(),
  icpGetTeam: vi.fn(),
  from: vi.fn(),
  queryConfigs: [] as any[],
  queryData: new Map<string, any>(),
  results: new Map<string, QueryResult[]>(),
  calls: [] as Array<{ table: string; method: string; args: any[] }>,
}));
const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mocks.backend === "icp" ? providers.icp({ identity: {}, target: { alias: "test" } }) : providers.supabase(),
}));
vi.mock("@/live/features/competitions", () => ({
  listLiveCompetitionMatches: (...args: unknown[]) => mocks.listMatches(...args),
  listLiveCompetitionEntries: (...args: unknown[]) => mocks.listEntries(...args),
}));
vi.mock("@/lib/icpClubTeamLookup", () => ({
  icpGetTeam: (...args: unknown[]) => mocks.icpGetTeam(...args),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "admin-1" } }) }));
vi.mock("@/components/AddressAutocomplete", () => ({ AddressAutocomplete: () => null }));
vi.mock("@tanstack/react-query", async importOriginal => {
  const actual = await importOriginal<typeof import("@tanstack/react-query")>();
  return {
    ...actual,
    useQuery: (config: any) => {
      mocks.queryConfigs.push(config);
      return {
        data: mocks.queryData.get(config.queryKey?.[0]) ?? config.initialData ?? [],
        isLoading: false,
      };
    },
    useQueryClient: () => ({ invalidateQueries: vi.fn() }),
  };
});

import { CompetitionFixturesPanel, CompetitionLadderPanel } from "./CompetitionFixturesPanel";

function result(table: string): QueryResult {
  const queue = mocks.results.get(table) ?? [];
  return queue.shift() ?? { data: [], error: null };
}

function queryFor(table: string) {
  const query: any = {};
  for (const method of ["select", "eq", "in", "order", "limit", "is"]) {
    query[method] = vi.fn((...args: any[]) => {
      mocks.calls.push({ table, method, args });
      return query;
    });
  }
  Object.defineProperty(query, "then", {
    value: (resolve: any, reject: any) => Promise.resolve(result(table)).then(resolve, reject),
  });
  return query;
}

function configFor(key: string) {
  const config = mocks.queryConfigs.find(item => item.queryKey?.[0] === key);
  if (!config) throw new Error(`Missing query config: ${key}`);
  return config;
}

function seed(table: string, ...responses: QueryResult[]) {
  mocks.results.set(table, responses);
}

describe.runIf(supabaseMode)("Competition fixture and ladder query contracts — Supabase", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backend = "supabase";
    mocks.queryConfigs = [];
    mocks.queryData = new Map();
    mocks.results = new Map();
    mocks.calls = [];
    mocks.from.mockImplementation((table: string) => queryFor(table));
  });

  it("reads fixtures only for the requested competition in round then scheduled order", async () => {
    seed("competition_matches", { data: [{ id: "match-1" }], error: null });
    render(<CompetitionFixturesPanel competitionId="competition-1" isAdmin divisions={[]} entries={[]} />);

    await expect(configFor("competition-matches").queryFn()).resolves.toEqual([{ id: "match-1" }]);
    expect(mocks.calls.filter(call => call.table === "competition_matches")).toEqual([
      expect.objectContaining({ method: "select" }),
      { table: "competition_matches", method: "eq", args: ["competition_id", "competition-1"] },
      { table: "competition_matches", method: "order", args: ["round_number", { ascending: true, nullsFirst: false }] },
      { table: "competition_matches", method: "order", args: ["scheduled_at", { ascending: true, nullsFirst: false }] },
    ]);
  });

  it("rejects a fixture read failure instead of presenting it as a genuinely empty competition", async () => {
    seed("competition_matches", { data: null, error: { message: "fixtures unavailable" } });
    render(<CompetitionFixturesPanel competitionId="competition-1" isAdmin divisions={[]} entries={[]} />);

    await expect(configFor("competition-matches").queryFn()).rejects.toMatchObject({
      message: "fixtures unavailable",
    });
  });

  it("keeps linked PlayHQ enrichment failure explicit rather than corrupting the base fixture list", async () => {
    const match = {
      id: "match-1",
      external_home_team_id: "playhq-home",
      external_away_team_id: "playhq-away",
      home_team_name: "Home",
      away_team_name: "Away",
    };
    seed("teams", { data: null, error: { message: "linked teams unavailable" } });
    mocks.queryData.set("competition-matches", [match]);
    render(<CompetitionFixturesPanel competitionId="competition-1" isAdmin divisions={[]} entries={[]} />);
    const linked = configFor("competition-linked-teams");

    await expect(linked.queryFn()).rejects.toMatchObject({ message: "linked teams unavailable" });
  });

  it("rejects a protected fixture-result failure", async () => {
    seed("competition_matches", { data: null, error: { message: "ladder unavailable" } });
    seed("competition_entries", { data: [], error: null });
    render(<CompetitionLadderPanel competitionId="competition-1" divisions={[]} />);

    await expect(configFor("competition-ladder").queryFn()).rejects.toMatchObject({ message: "ladder unavailable" });
  });

  it("rejects an accepted-entry failure instead of constructing an incomplete ladder", async () => {
    seed("competition_ladder", { data: [], error: null });
    seed("competition_entries", { data: null, error: { message: "entries unavailable" } });
    render(<CompetitionLadderPanel competitionId="competition-1" divisions={[]} />);

    await expect(configFor("competition-ladder").queryFn()).rejects.toMatchObject({ message: "entries unavailable" });
  });

  it("rejects team-enrichment failure instead of returning anonymous ladder rows", async () => {
    seed("competition_ladder", {
      data: [{ competition_id: "competition-1", team_id: "team-1", division_id: null, points: 3 }],
      error: null,
    });
    seed("competition_entries", { data: [], error: null });
    seed("teams", { data: null, error: { message: "teams unavailable" } });
    render(<CompetitionLadderPanel competitionId="competition-1" divisions={[]} />);

    await expect(configFor("competition-ladder").queryFn()).rejects.toMatchObject({ message: "teams unavailable" });
  });
});

describe.runIf(!supabaseMode)("Competition fixture query contract — ICP", () => {
  beforeEach(() => {
    mocks.backend = "icp";
    mocks.queryConfigs = [];
    mocks.queryData = new Map();
    mocks.calls = [];
    mocks.listMatches.mockReset();
    mocks.listEntries.mockReset();
    mocks.icpGetTeam.mockReset();
  });

  it("reads and maps fixture rows through competition_domain", async () => {
    mocks.listMatches.mockResolvedValue([{
      id: "match-icp",
      competition_id: "competition-1",
      home_team: "team-home",
      away_team: "team-away",
      division_id: [],
      round_number: [1n],
      home_score: 0n,
      away_score: 0n,
      status: "scheduled",
      scheduled_at_ms: [1_786_032_000_000n],
      venue: ["Ground"],
      pitch_number: ["2"],
      duration_minutes: [60],
      arrival_minutes_before: [20],
      notes: [],
      revision: 1n,
    }]);
    render(<CompetitionFixturesPanel competitionId="competition-1" isAdmin divisions={[]} entries={[]} />);

    await expect(configFor("competition-matches").queryFn()).resolves.toMatchObject([{
      id: "match-icp",
      home_team_id: "team-home",
      away_team_id: "team-away",
      home: { id: "team-home", name: "team-home" },
      away: { id: "team-away", name: "team-away" },
      scheduled_at: new Date(1_786_032_000_000).toISOString(),
      venue: "Ground",
      pitch_number: "2",
      round_number: 1,
    }]);
    expect(mocks.listMatches).toHaveBeenCalledWith(expect.anything(), "competition-1");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it("builds an ICP ladder from accepted entries, completed scores, and configured points", async () => {
    mocks.listEntries.mockResolvedValue([
      { competition_id: "competition-1", team_id: "team-home", club_id: "club-1", status: "accepted", division_id: ["division-1"] },
      { competition_id: "competition-1", team_id: "team-away", club_id: "club-2", status: "accepted", division_id: ["division-1"] },
      { competition_id: "competition-1", team_id: "team-waiting", club_id: "club-3", status: "invited", division_id: ["division-1"] },
    ]);
    mocks.listMatches.mockResolvedValue([
      { id: "match-complete", home_team: "team-home", away_team: "team-away", home_score: 2n, away_score: 0n, status: "completed", division_id: ["division-1"] },
      { id: "match-scheduled", home_team: "team-away", away_team: "team-home", home_score: 0n, away_score: 0n, status: "scheduled", division_id: ["division-1"] },
    ]);
    mocks.icpGetTeam.mockImplementation(async (id: string) => ({
      id,
      name: id === "team-home" ? "Home" : "Away",
      club_id: id === "team-home" ? "club-1" : "club-2",
    }));
    render(
      <CompetitionLadderPanel
        competitionId="competition-1"
        divisions={[]}
        pointsWin={5}
        pointsDraw={2}
        pointsLoss={1}
      />,
    );

    const rows = await configFor("competition-ladder").queryFn();

    expect(mocks.listEntries).toHaveBeenCalledWith(expect.anything(), "competition-1");
    expect(mocks.listMatches).toHaveBeenCalledWith(expect.anything(), "competition-1");
    expect(rows.masked).toBe(false);
    expect(rows.rows).toEqual([
      expect.objectContaining({
        team_id: "team-home", division_id: "division-1", played: 1,
        wins: 1, draws: 0, losses: 0, goals_for: 2, goals_against: 0,
        goal_diff: 2, points: 5, teams: expect.objectContaining({ name: "Home" }),
      }),
      expect.objectContaining({
        team_id: "team-away", division_id: "division-1", played: 1,
        wins: 0, draws: 0, losses: 1, goals_for: 0, goals_against: 2,
        goal_diff: -2, points: 1, teams: expect.objectContaining({ name: "Away" }),
      }),
    ]);
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
