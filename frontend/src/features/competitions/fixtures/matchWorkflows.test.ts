import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  calls: [] as Array<{ method: string; args: unknown[] }>,
  response: { error: null as { message: string } | null },
  backend: "supabase" as "supabase" | "icp",
  recordLiveMatch: vi.fn(),
  updateLiveMatchDetails: vi.fn(),
}));

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from, rpc: async (...args: unknown[]) => { mocks.calls.push({ method: "rpc", args }); return mocks.response; } },
}));

vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: any) =>
    mocks.backend === "icp" ? providers.icp({ identity: {}, target: {} }) : providers.supabase(),
}));

vi.mock("@/live/features/competitions", () => ({
  deleteLiveMatch: vi.fn(),
  recordLiveMatch: mocks.recordLiveMatch,
  setLiveMatchResult: vi.fn(),
  trimLiveCompetitionRounds: vi.fn(),
  updateLiveMatchDetails: mocks.updateLiveMatchDetails,
}));

import {
  buildMatchDetailsPayload,
  buildMatchResultUpdate,
  deleteCompetitionMatch,
  createGeneratedMatches,
  trimCompetitionRounds,
  updateCompetitionMatch,
} from "./matchWorkflows";

function mutationBuilder(table: string) {
  type BuilderMethod = (...args: unknown[]) => TestBuilder;
  type TestBuilder = PromiseLike<unknown> & {
    upsert: BuilderMethod;
    update: BuilderMethod;
    delete: BuilderMethod;
    eq: BuilderMethod;
    gt: BuilderMethod;
  };
  const builder = {} as TestBuilder;
  mocks.calls.push({ method: "from", args: [table] });
  for (const method of ["upsert", "update", "delete", "eq", "gt"] as const) {
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

describe("match result payload", () => {
  it("completes a scheduled match when both scores are present", () => {
    expect(buildMatchResultUpdate({
      homeScore: "3",
      awayScore: "1",
      status: "scheduled",
      source: "manual",
    })).toEqual({
      payload: { home_score: 3, away_score: 1, status: "completed" },
      nextStatus: "completed",
      createsLocalOverride: false,
    });
  });

  it("keeps a partial score scheduled and reopens a completed cleared score", () => {
    expect(buildMatchResultUpdate({
      homeScore: "2",
      awayScore: "",
      status: "scheduled",
    }).payload).toEqual({ home_score: 2, away_score: null, status: "scheduled" });
    expect(buildMatchResultUpdate({
      homeScore: "",
      awayScore: "",
      status: "completed",
    }).payload).toEqual({ home_score: null, away_score: null, status: "scheduled" });
  });

  it("preserves cancelled and postponed states even when scores are present", () => {
    for (const status of ["cancelled", "postponed"]) {
      expect(buildMatchResultUpdate({
        homeScore: "1",
        awayScore: "0",
        status,
      }).nextStatus).toBe(status);
    }
  });

  it("stamps only the first local edit of an external match", () => {
    const now = () => new Date("2026-08-03T10:00:00.000Z");
    expect(buildMatchResultUpdate({
      homeScore: "1",
      awayScore: "0",
      status: "scheduled",
      source: "playhq",
      manuallyOverriddenAt: null,
      now,
    })).toEqual({
      payload: {
        home_score: 1,
        away_score: 0,
        status: "completed",
        manually_overridden_at: "2026-08-03T10:00:00.000Z",
      },
      nextStatus: "completed",
      createsLocalOverride: true,
    });
    expect(buildMatchResultUpdate({
      homeScore: "1",
      awayScore: "1",
      status: "completed",
      source: "playhq",
      manuallyOverriddenAt: "2026-07-20T09:00:00.000Z",
      now,
    }).payload).not.toHaveProperty("manually_overridden_at");
  });
});

describe("match details payload", () => {
  it("builds the exact normalized edit payload", () => {
    expect(buildMatchDetailsPayload({
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      divisionId: "division-1",
      existingScheduledAt: "2026-08-01T08:00:00.000Z",
      date: "2026-09-12",
      time: "09:30",
      venue: "Riverside Park",
      pitch: " 2 ",
      round: "4",
      duration: "60",
      arrival: "20",
      notes: "Final",
    })).toEqual({
      home_team_id: "home-1",
      away_team_id: "away-1",
      division_id: "division-1",
      scheduled_at: new Date("2026-09-12T09:30:00").toISOString(),
      venue: "Riverside Park",
      pitch_number: "2",
      round_number: 4,
      duration_minutes: 60,
      arrival_minutes_before: 20,
      notes: "Final",
    });
  });

  it("preserves the existing schedule and established nullable fields", () => {
    expect(buildMatchDetailsPayload({
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      divisionId: "",
      existingScheduledAt: "2026-08-01T08:00:00.000Z",
      date: "",
      time: "",
      venue: "Riverside Park",
      pitch: " ",
      round: "",
      duration: "",
      arrival: "",
      notes: "",
    })).toEqual(expect.objectContaining({
      division_id: null,
      scheduled_at: "2026-08-01T08:00:00.000Z",
      pitch_number: null,
      round_number: null,
      duration_minutes: null,
      arrival_minutes_before: null,
      notes: null,
    }));
  });
});

describe("match mutation targeting", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.calls = [];
    mocks.response = { error: null };
    mocks.backend = "supabase";
    mocks.from.mockImplementation(mutationBuilder);
  });

  it("persists full fixture schedule details after creating an ICP match", async () => {
    mocks.backend = "icp";
    mocks.recordLiveMatch.mockResolvedValue({ id: "match-1", revision: 3n });
    mocks.updateLiveMatchDetails.mockResolvedValue(undefined);
    const row = {
      competition_id: "competition-1",
      home_team_id: "home-1",
      away_team_id: "away-1",
      division_id: "division-1",
      round_number: 4,
      scheduled_at: "2026-10-10T08:00:00.000Z",
      venue: "Main Ground",
      pitch_number: "2",
      duration_minutes: 60,
      arrival_minutes_before: 20,
      notes: "Final",
    };

    await expect(createGeneratedMatches([row])).resolves.toEqual({ error: null });
    const ctx = { identity: {}, target: {} };
    expect(mocks.recordLiveMatch).toHaveBeenCalledWith(ctx, "competition-1", "home-1", "away-1");
    expect(mocks.updateLiveMatchDetails).toHaveBeenCalledWith(ctx, "match-1", {
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      divisionId: "division-1",
      scheduledAtMs: new Date(row.scheduled_at).getTime(),
      venue: "Main Ground",
      pitchNumber: "2",
      roundNumber: 4,
      durationMinutes: 60,
      arrivalMinutesBefore: 20,
      notes: "Final",
      expectedRevision: 3,
    });
  });

  it("updates exactly one match id", async () => {
    const payload = { home_score: 3, away_score: 1, status: "completed" };
    await expect(updateCompetitionMatch("match-1", payload)).resolves.toEqual({ error: null });
    expect(mocks.calls).toEqual([
      { method: "rpc", args: ["save_competition_match_result", { p_match_id: "match-1", p_home_score: 3, p_away_score: 1, p_status: "completed" }] },
    ]);
  });

  it("rejects partial ICP scores instead of sending empty fixture details", async () => {
    mocks.backend = "icp";
    const client = { from: vi.fn() };
    await expect(updateCompetitionMatch("match-1", { home_score: 2, away_score: null }))
      .resolves.toEqual({ error: { message: "Both scores are required to update a result on ICP." } });
    expect(mocks.updateLiveMatchDetails).not.toHaveBeenCalled();
    expect(client.from).not.toHaveBeenCalled();
  });

  it("deletes exactly one match id", async () => {
    await expect(deleteCompetitionMatch("match-1")).resolves.toEqual({ error: null });
    expect(mocks.calls).toEqual([
      { method: "from", args: ["competition_matches"] },
      { method: "delete", args: [] },
      { method: "eq", args: ["id", "match-1"] },
    ]);
  });

  it("trims only rounds beyond the target in the requested competition", async () => {
    await expect(trimCompetitionRounds("competition-1", 4)).resolves.toEqual({ error: null });
    expect(mocks.calls).toEqual([
      { method: "from", args: ["competition_matches"] },
      { method: "delete", args: [] },
      { method: "eq", args: ["competition_id", "competition-1"] },
      { method: "gt", args: ["round_number", 4] },
    ]);
  });

  it("returns mutation failures without changing their message", async () => {
    mocks.response = { error: { message: "row-level security denied" } };
    await expect(deleteCompetitionMatch("match-1")).resolves.toEqual(mocks.response);
  });
});
