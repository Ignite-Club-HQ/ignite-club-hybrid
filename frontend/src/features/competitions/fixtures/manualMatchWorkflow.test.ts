import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  from: vi.fn(),
  insert: vi.fn(),
  response: { error: null as { message: string } | null },
  backend: (process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase") as "supabase" | "icp",
  recordLiveMatch: vi.fn(),
}));

const supabaseMode = process.env.IGNITE_TEST_BACKEND_MODE !== "icp";
const icpContext = { identity: {}, target: { alias: "test" } };

vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: mocks.from },
}));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: { supabase: () => unknown; icp: (ctx: unknown) => unknown }) =>
    mocks.backend === "icp" ? providers.icp(icpContext) : providers.supabase(),
}));
vi.mock("@/live/features/competitions", () => ({
  recordLiveMatch: (...args: unknown[]) => mocks.recordLiveMatch(...args),
}));

import { buildManualMatchRow, createManualMatch } from "./manualMatchWorkflow";

describe("manual match workflow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.backend = process.env.IGNITE_TEST_BACKEND_MODE === "icp" ? "icp" : "supabase";
    mocks.response = { error: null };
    mocks.insert.mockImplementation(() => Promise.resolve(mocks.response));
    mocks.from.mockReturnValue({ insert: mocks.insert });
  });

  it("builds the exact manual-match insert contract", () => {
    expect(buildManualMatchRow({
      competitionId: "competition-1",
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      divisionId: "division-1",
      scheduledAt: "2026-09-12T09:30",
      venue: "Riverside Park",
      pitch: " 2 ",
      round: "4",
      duration: "60",
      arrival: "20",
      notes: "Round four",
      createdBy: "admin-1",
    })).toEqual({
      competition_id: "competition-1",
      home_team_id: "home-1",
      away_team_id: "away-1",
      division_id: "division-1",
      scheduled_at: new Date("2026-09-12T09:30").toISOString(),
      venue: "Riverside Park",
      pitch_number: "2",
      round_number: 4,
      duration_minutes: 60,
      arrival_minutes_before: 20,
      notes: "Round four",
      status: "scheduled",
      created_by: "admin-1",
    });
  });

  it("preserves established nullable optional fields", () => {
    expect(buildManualMatchRow({
      competitionId: "competition-1",
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      divisionId: "",
      scheduledAt: "2026-09-12T09:00",
      venue: "Riverside Park",
      pitch: " ",
      round: "",
      duration: "",
      arrival: "",
      notes: "",
      createdBy: undefined,
    })).toEqual(expect.objectContaining({
      division_id: null,
      pitch_number: null,
      round_number: null,
      duration_minutes: null,
      arrival_minutes_before: null,
      notes: null,
      created_by: null,
    }));
  });

  it.runIf(supabaseMode)("inserts one row into competition_matches and returns failures unchanged", async () => {
    const row = buildManualMatchRow({
      competitionId: "competition-1",
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      divisionId: "",
      scheduledAt: "2026-09-12T09:00",
      venue: "Riverside Park",
      pitch: "",
      round: "",
      duration: "",
      arrival: "",
      notes: "",
    });
    mocks.response = { error: { message: "insert denied" } };

    await expect(createManualMatch(row)).resolves.toEqual(mocks.response);
    expect(mocks.from).toHaveBeenCalledWith("competition_matches");
    expect(mocks.insert).toHaveBeenCalledOnce();
    expect(mocks.insert).toHaveBeenCalledWith(row);
  });

  it.runIf(!supabaseMode)("records the teams through competition_domain without a Supabase write", async () => {
    mocks.recordLiveMatch.mockResolvedValue({ id: "match-icp" });
    const row = buildManualMatchRow({
      competitionId: "competition-icp",
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      divisionId: "",
      scheduledAt: "2026-09-12T09:00",
      venue: "Riverside Park",
      pitch: "",
      round: "",
      duration: "",
      arrival: "",
      notes: "",
    });

    await expect(createManualMatch(row)).resolves.toEqual({ error: null });
    expect(mocks.recordLiveMatch).toHaveBeenCalledWith(icpContext, "competition-icp", "home-1", "away-1");
    expect(mocks.from).not.toHaveBeenCalled();
  });

  it.runIf(!supabaseMode)("returns canister write failures without issuing a Supabase fallback", async () => {
    mocks.recordLiveMatch.mockRejectedValueOnce(new Error("competition access denied"));
    const row = buildManualMatchRow({
      competitionId: "competition-icp",
      homeTeamId: "home-1",
      awayTeamId: "away-1",
      divisionId: "",
      scheduledAt: "2026-09-12T09:00",
      venue: "Riverside Park",
      pitch: "",
      round: "",
      duration: "",
      arrival: "",
      notes: "",
    });

    await expect(createManualMatch(row)).resolves.toEqual({ error: { message: "competition access denied" } });
    expect(mocks.recordLiveMatch).toHaveBeenCalledWith(icpContext, "competition-icp", "home-1", "away-1");
    expect(mocks.from).not.toHaveBeenCalled();
  });
});
