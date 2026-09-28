import { describe, it, expect, vi, beforeEach } from "vitest";

const tables: Record<string, any[]> = {
  children: [],
  child_guardians: [],
  child_team_assignments: [],
  teams: [],
};

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
  supabase: { from: (t: string) => makeQuery(t) },
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

  it("team events only return children on that team", async () => {
    const out = await resolveRsvpChildren({ event: { ...base, team_id: "t1" }, userId: "me" });
    expect(out.map((c) => c.id)).toEqual(["kidA"]);
  });

  it("targeted club-wide events intersect with target teams", async () => {
    const out = await resolveRsvpChildren({ event: { ...base, target_team_ids: ["t2"] }, userId: "me" });
    expect(out.map((c) => c.id)).toEqual(["kidB"]);
  });

  it("unscoped club-wide events are bounded by the club's teams", async () => {
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

  it("uses targeted teams when present", async () => {
    const out = await resolveEventChildRoster({ event: { ...base, target_team_ids: ["t1"] } });
    expect(out.map((c) => c.id)).toEqual(["kidA"]);
  });

  it("club-wide roster stays inside the club", async () => {
    const out = await resolveEventChildRoster({ event: { ...base } });
    expect(out.map((c) => c.id).sort()).toEqual(["kidA", "kidB"]);
  });
});
