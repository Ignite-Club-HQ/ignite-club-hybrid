import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as Array<{ method: string; args: unknown[] }>,
  response: { data: [] as Array<{ round_number: number }>, error: null as { message: string } | null },
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));

import {
  buildFinalsFixtureRows,
  createFinalsFixtures,
  discoverNextFinalsRound,
} from "./finalsWorkflow";

function queryBuilder(table: string) {
  type BuilderMethod = (...args: unknown[]) => TestBuilder;
  type TestBuilder = PromiseLike<unknown> & {
    select: BuilderMethod;
    eq: BuilderMethod;
    is: BuilderMethod;
    order: BuilderMethod;
    limit: BuilderMethod;
    insert: BuilderMethod;
  };
  const builder = {} as TestBuilder;
  mocks.calls.push({ method: "from", args: [table] });
  for (const method of ["select", "eq", "is", "order", "limit", "insert"] as const) {
    builder[method] = vi.fn((...args: unknown[]) => {
      mocks.calls.push({ method, args });
      return builder;
    });
  }
  Object.defineProperty(builder, "then", {
    value: (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(mocks.response).then(resolve, reject),
  });
  return builder;
}

describe("finals workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls = [];
    mocks.response = { data: [], error: null };
    mocks.from.mockImplementation(queryBuilder);
  });

  it("discovers the next round in the requested division scope", async () => {
    mocks.response.data = [{ round_number: 4 }];
    await expect(discoverNextFinalsRound("competition-1", "division-1")).resolves.toEqual({
      nextRound: 5,
      error: null,
    });
    expect(mocks.calls).toEqual([
      { method: "from", args: ["competition_matches"] },
      { method: "select", args: ["round_number"] },
      { method: "eq", args: ["competition_id", "competition-1"] },
      { method: "order", args: ["round_number", { ascending: false, nullsFirst: false }] },
      { method: "limit", args: [1] },
      { method: "eq", args: ["division_id", "division-1"] },
    ]);
  });

  it("uses an explicit null division scope and starts at round one only after a successful empty read", async () => {
    await expect(discoverNextFinalsRound("competition-1", "")).resolves.toEqual({
      nextRound: 1,
      error: null,
    });
    expect(mocks.calls.at(-1)).toEqual({ method: "is", args: ["division_id", null] });
  });

  it("never invents round one when round discovery fails", async () => {
    mocks.response = { data: [], error: { message: "round lookup denied" } };
    await expect(discoverNextFinalsRound("competition-1", "")).resolves.toEqual({
      nextRound: null,
      error: { message: "round lookup denied" },
    });
  });

  it("builds grand-final rows with the exact established defaults", () => {
    expect(buildFinalsFixtureRows({
      competitionId: "competition-1",
      divisionId: "",
      roundNumber: 5,
      format: "gf",
      date: "2026-09-12",
      time: "09:00",
      duration: "60",
      venue: "Riverside Park",
      pitchInput: "",
      createdBy: "admin-1",
    })).toEqual([{
      competition_id: "competition-1",
      division_id: null,
      round_number: 5,
      home_team_id: null,
      away_team_id: null,
      status: "scheduled",
      created_by: "admin-1",
      scheduled_at: new Date("2026-09-12T09:00:00").toISOString(),
      venue: "Riverside Park",
      pitch_number: "1",
      duration_minutes: 60,
      notes: "Grand Final · 1 v 2",
    }]);
  });

  it("spreads excess finals across duration-sized waves on normalized pitches", () => {
    const rows = buildFinalsFixtureRows({
      competitionId: "competition-1",
      divisionId: "division-1",
      roundNumber: 7,
      format: "top6",
      date: "2026-09-12",
      time: "10:15",
      duration: "45",
      venue: "Riverside Park",
      pitchInput: " A, B ",
    });
    expect(rows).toHaveLength(3);
    expect(rows.map((row) => row.pitch_number)).toEqual(["A", "B", "A"]);
    expect(rows.map((row) => row.scheduled_at)).toEqual([
      new Date("2026-09-12T10:15:00").toISOString(),
      new Date("2026-09-12T10:15:00").toISOString(),
      new Date("2026-09-12T11:00:00").toISOString(),
    ]);
  });

  it("inserts the complete finals row set once and returns failures unchanged", async () => {
    const rows = buildFinalsFixtureRows({
      competitionId: "competition-1",
      divisionId: "",
      roundNumber: 1,
      format: "gf",
      date: "2026-09-12",
      time: "09:00",
      duration: "60",
      venue: "Riverside Park",
      pitchInput: "",
    });
    mocks.response = { data: [], error: { message: "insert denied" } };

    await expect(createFinalsFixtures(rows)).resolves.toEqual({ error: { message: "insert denied" } });
    expect(mocks.calls).toEqual([
      { method: "from", args: ["competition_matches"] },
      { method: "insert", args: [rows] },
    ]);
  });
});
