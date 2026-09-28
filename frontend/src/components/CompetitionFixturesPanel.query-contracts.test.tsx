import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

type QueryResult = { data: any; error: any };

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  queryConfigs: [] as any[],
  queryData: new Map<string, any>(),
  results: new Map<string, QueryResult[]>(),
  calls: [] as Array<{ table: string; method: string; args: any[] }>,
}));

vi.mock("@/integrations/supabase/client", () => ({ supabase: { from: mocks.from } }));
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

describe("Competition fixture and ladder query contracts", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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

  it("rejects a ladder-row failure", async () => {
    seed("competition_ladder", { data: null, error: { message: "ladder unavailable" } });
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
