import { describe, expect, it } from "vitest";
import { calculateAttendanceSummary } from "./attendanceSummaryPolicy";

describe("attendance summary policy", () => {
  it("separates social adults and children while counting guests as adults", () => {
    expect(calculateAttendanceSummary({
      eventType: "social", guestCount: 2, playerUserIds: [], attendanceUnavailable: false,
      rsvps: [
        { status: "going", user_id: "adult-1", child_id: null },
        { status: "going", user_id: "parent-1", child_id: "child-1" },
        { status: "maybe", user_id: "adult-2", child_id: null },
      ],
    })).toEqual({ state: "social", total: 4, adults: 3, children: 1 });
  });

  it("counts unique direct, linked mini-league and adult-player identities", () => {
    expect(calculateAttendanceSummary({
      eventType: "game", guestCount: 1, playerUserIds: ["adult-player"], attendanceUnavailable: false,
      rsvps: [
        { status: "going", child_id: "child-1", user_id: "guardian-1" },
        { status: "going", mini_league_player_id: "league-1", mini_league_players: { child_id: "child-1" } },
        { status: "going", mini_league_player_id: "league-standalone", mini_league_players: { child_id: null } },
        { status: "going", user_id: "adult-player" },
        { status: "going", user_id: "parent-only" },
        { status: "not_going", child_id: "child-2" },
      ],
    })).toEqual({ state: "players", count: 4 });
  });

  it("distinguishes unavailable attendance from an in-progress initial load", () => {
    const base = { eventType: "game", rsvps: null, guestCount: 0, playerUserIds: [] as string[] };
    expect(calculateAttendanceSummary({ ...base, attendanceUnavailable: true })).toEqual({ state: "unavailable" });
    expect(calculateAttendanceSummary({ ...base, attendanceUnavailable: false })).toEqual({ state: "loading" });
  });

  it("treats a successfully loaded empty RSVP list as zero rather than loading", () => {
    expect(calculateAttendanceSummary({
      eventType: "training", rsvps: [], guestCount: 0, playerUserIds: [], attendanceUnavailable: true,
    })).toEqual({ state: "players", count: 0 });
  });
});
