import { describe, it, expect, vi, beforeEach } from "vitest";

const tables: Record<string, any[]> = {
  children: [],
  child_guardians: [],
  child_team_assignments: [],
  teams: [],
};
const backendMocks = vi.hoisted(() => ({
  mode: process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase",
  context: { identity: {}, target: {} },
  children: vi.fn(),
  assignments: vi.fn(),
  piiNames: vi.fn(),
  supabaseTables: [] as string[],
}));

/** Minimal PostgREST-ish stub: filters are applied over the in-memory tables. */
function makeQuery(table: string) {
  let rows = [...(tables[table] || [])];
  const api: any = {
    select: () => api,
    eq: (col: string, val: any) => {
      rows = rows.filter((r) => r[col] === val);
      return api;
    },
    in: (col: string, vals: any[]) => {
      rows = rows.filter((r) => vals.includes(r[col]));
      return api;
    },
    then: (resolve: any) => resolve({ data: rows, error: null }),
  };
  return api;
}

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (t: string) => {
    backendMocks.supabaseTables.push(t);
    return makeQuery(t);
  } },
}));
vi.mock("@/live/loadBackendRouting", () => ({
  isFeatureRoutedToIcp: () => backendMocks.mode === "icp",
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    backendMocks.mode === "icp" ? providers.icp(backendMocks.context) : providers.supabase(),
}));
vi.mock("@/live/features/events", () => ({
  getLiveMyChildren: (...args: unknown[]) => backendMocks.children(...args),
  getLiveMyChildTeamAssignments: (...args: unknown[]) => backendMocks.assignments(...args),
}));
vi.mock("@/live/features/vault", () => ({
  resolveLivePiiTextBatch: (...args: unknown[]) => backendMocks.piiNames(...args),
}));

import { resolveRsvpChildren, resolveEventChildRoster } from "./resolveEventChildScope";

const base = { club_id: "club1", team_id: null as string | null };

beforeEach(() => {
  tables.children = [
    { id: "kidA", name: "A", parent_id: "me" },
    { id: "kidB", name: "B", parent_id: "me" },
    { id: "kidX", name: "X", parent_id: "other" },
  ];
  tables.child_guardians = [{ child_id: "kidX", children: { id: "kidX", name: "X", parent_id: "other" } }];
  tables.child_team_assignments = [
    { child_id: "kidA", team_id: "t1", children: { id: "kidA", name: "A", parent_id: "me" } },
    { child_id: "kidB", team_id: "t2", children: { id: "kidB", name: "B", parent_id: "me" } },
    { child_id: "kidX", team_id: "tOtherClub", children: { id: "kidX", name: "X", parent_id: "other" } },
  ];
  tables.teams = [{ id: "t1", club_id: "club1" }, { id: "t2", club_id: "club1" }, { id: "tOtherClub", club_id: "club2" }];
  backendMocks.children.mockReset().mockResolvedValue([
    { id: "kidA", parent_id: ["principal-me"] },
    { id: "kidB", parent_id: ["principal-me"] },
  ]);
  backendMocks.assignments.mockReset().mockImplementation(async (_ctx: unknown, childId: string) => [
    { team_id: childId === "kidA" ? "t1" : "t2", club_id: "club1" },
  ]);
  backendMocks.piiNames.mockReset().mockResolvedValue(new Map([["kidA", "A"], ["kidB", "B"]]));
  backendMocks.supabaseTables = [];
});

describe("resolveRsvpChildren", () => {
  it("returns nothing for adults_only events", async () => {
    expect(await resolveRsvpChildren({ event: { ...base, adults_only: true }, userId: "me" })).toEqual([]);
  });

  it("returns nothing for parents_only audience", async () => {
    expect(
      await resolveRsvpChildren({ event: { ...base, rsvp_audience: "parents_only" }, userId: "me" }),
    ).toEqual([]);
  });

  it("returns nothing when the event is role restricted", async () => {
    expect(
      await resolveRsvpChildren({ event: { ...base, restricted_to_roles: ["coach"] }, userId: "me" }),
    ).toEqual([]);
  });

  it.runIf(backendMocks.mode === "supabase")("team events only return children on that team", async () => {
    const out = await resolveRsvpChildren({ event: { ...base, team_id: "t1" }, userId: "me" });
    expect(out.map((c) => c.id)).toEqual(["kidA"]);
  });

  it.runIf(backendMocks.mode === "supabase")("targeted club-wide events intersect with target teams", async () => {
    const out = await resolveRsvpChildren({ event: { ...base, target_team_ids: ["t2"] }, userId: "me" });
    expect(out.map((c) => c.id)).toEqual(["kidB"]);
  });

  it.runIf(backendMocks.mode === "supabase")("unscoped club-wide events are bounded by the club's teams", async () => {
    const out = await resolveRsvpChildren({ event: { ...base }, userId: "me" });
    expect(out.map((c) => c.id).sort()).toEqual(["kidA", "kidB"]);
  });

  it("returns [] with no user", async () => {
    expect(await resolveRsvpChildren({ event: { ...base }, userId: null })).toEqual([]);
  });
});

describe("resolveEventChildRoster", () => {
  it("short-circuits for adults_only", async () => {
    expect(await resolveEventChildRoster({ event: { ...base, adults_only: true } })).toEqual([]);
  });

  it.runIf(backendMocks.mode === "supabase")("uses targeted teams when present", async () => {
    const out = await resolveEventChildRoster({ event: { ...base, target_team_ids: ["t1"] } });
    expect(out.map((c) => c.id)).toEqual(["kidA"]);
  });

  it.runIf(backendMocks.mode === "supabase")("club-wide roster stays inside the club", async () => {
    const out = await resolveEventChildRoster({ event: { ...base } });
    expect(out.map((c) => c.id).sort()).toEqual(["kidA", "kidB"]);
  });
});

describe.runIf(backendMocks.mode === "icp")("ICP child RSVP scope", () => {
  it("scopes caller children to targeted team assignments and resolves names via PII", async () => {
    const out = await resolveRsvpChildren({
      event: { ...base, target_team_ids: ["t1"] },
      userId: "principal-me",
    });
    expect(out).toEqual([{ id: "kidA", name: "A", parent_id: "principal-me" }]);
    expect(backendMocks.children).toHaveBeenCalledWith(backendMocks.context);
    expect(backendMocks.assignments).toHaveBeenCalledWith(backendMocks.context, "kidA");
    expect(backendMocks.piiNames).toHaveBeenCalledWith(
      backendMocks.context,
      ["kidA", "kidB"],
      "name",
      "rsvp_scope",
      "RSVP child names",
    );
    expect(backendMocks.supabaseTables).toEqual([]);
  });

  it("returns an empty child roster for adults-only events without canister reads", async () => {
    await expect(resolveEventChildRoster({ event: { ...base, adults_only: true } })).resolves.toEqual([]);
    expect(backendMocks.children).not.toHaveBeenCalled();
    expect(backendMocks.assignments).not.toHaveBeenCalled();
  });
});
