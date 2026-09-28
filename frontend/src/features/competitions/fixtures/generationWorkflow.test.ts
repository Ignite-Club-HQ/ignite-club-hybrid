import { describe, expect, it, vi } from "vitest";
import type { PlacedFixture } from "@/lib/competitionScheduler";
import {
  buildGeneratedFixtureRows,
  describeGeneratedFixtureSaveError,
  persistGeneratedFixtures,
} from "./generationWorkflow";

function placedFixture(overrides: Partial<PlacedFixture> = {}): PlacedFixture {
  return {
    round: 2,
    home: "team-home",
    away: "team-away",
    scheduledAt: new Date("2026-09-12T09:30:00.000Z"),
    pitch: "Pitch 2",
    note: "Semi final",
    ...overrides,
  };
}

describe("generated fixture row construction", () => {
  it("builds the exact persisted contract and applies the start-round offset", () => {
    expect(buildGeneratedFixtureRows({
      competitionId: "competition-1",
      divisionId: "division-1",
      startRound: "4",
      createdBy: "admin-1",
      venue: "Riverside Park",
      durationMinutes: 60,
      arrivalMinutesBefore: "20",
      placedFixtures: [placedFixture()],
    })).toEqual([{
      competition_id: "competition-1",
      division_id: "division-1",
      round_number: 5,
      home_team_id: "team-home",
      away_team_id: "team-away",
      status: "scheduled",
      created_by: "admin-1",
      scheduled_at: "2026-09-12T09:30:00.000Z",
      venue: "Riverside Park",
      pitch_number: "Pitch 2",
      duration_minutes: 60,
      arrival_minutes_before: 20,
      notes: "Semi final",
    }]);
  });

  it("preserves established null/default normalization", () => {
    expect(buildGeneratedFixtureRows({
      competitionId: "competition-1",
      divisionId: "",
      startRound: "invalid",
      createdBy: undefined,
      venue: "Riverside Park",
      durationMinutes: 0,
      arrivalMinutesBefore: "",
      placedFixtures: [placedFixture({
        scheduledAt: null,
        pitch: null,
        note: undefined,
      })],
    })[0]).toEqual(expect.objectContaining({
      division_id: null,
      round_number: 2,
      created_by: null,
      scheduled_at: null,
      pitch_number: null,
      duration_minutes: null,
      arrival_minutes_before: null,
      notes: null,
    }));
  });

  it("returns no rows for an empty placement without invoking persistence", async () => {
    const rows = buildGeneratedFixtureRows({
      competitionId: "competition-1",
      divisionId: "",
      startRound: "1",
      venue: "Riverside Park",
      durationMinutes: 60,
      arrivalMinutesBefore: "",
      placedFixtures: [],
    });
    const insert = vi.fn();

    expect(rows).toEqual([]);
    expect(insert).not.toHaveBeenCalled();
  });
});

describe("generated fixture persistence", () => {
  it("passes all rows to the injected insert operation exactly once", async () => {
    const rows = buildGeneratedFixtureRows({
      competitionId: "competition-1",
      divisionId: "",
      startRound: "1",
      venue: "Riverside Park",
      durationMinutes: 60,
      arrivalMinutesBefore: "",
      placedFixtures: [placedFixture()],
    });
    const insert = vi.fn().mockResolvedValue({ error: null });

    await expect(persistGeneratedFixtures(rows, insert)).resolves.toEqual({ error: null });
    expect(insert).toHaveBeenCalledTimes(1);
    expect(insert).toHaveBeenCalledWith(rows);
  });

  it.each([
    ["duplicate key", "Some of these fixtures already exist for this competition. Try regenerating or shuffling first."],
    ["unique violation", "Some of these fixtures already exist for this competition. Try regenerating or shuffling first."],
    ["permission denied", "You don't have permission to save fixtures for this competition."],
    ["row-level security denied", "You don't have permission to save fixtures for this competition."],
    ["not authorized", "You don't have permission to save fixtures for this competition."],
    ["network unavailable", "We couldn't reach the server. Check your connection and try again."],
    ["fetch failed", "We couldn't reach the server. Check your connection and try again."],
    ["unexpected database failure", "Something went wrong while saving these fixtures. Please try again in a moment."],
    [null, "Something went wrong while saving these fixtures. Please try again in a moment."],
  ])("classifies %s without exposing technical details", (message, expected) => {
    expect(describeGeneratedFixtureSaveError({ message })).toBe(expected);
  });
});
