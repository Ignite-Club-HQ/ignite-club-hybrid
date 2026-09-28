import { describe, expect, it } from "vitest";
import {
  filterVisibleScheduleEvents,
  parseScheduleEntityFilter,
  retainRecentlyCancelledEvents,
} from "@/features/events/scheduleVisibilityPolicy";

const scope = {
  teamIds: ["team-1"], clubIds: ["club-1"],
  clubAdminClubIds: ["club-admin"], miniLeagueIds: ["league-1"],
};

describe("schedule entity filter", () => {
  it("distinguishes team, mini-league and all-entity filters", () => {
    expect(parseScheduleEntityFilter("team-1")).toEqual({ selectedTeamId: "team-1", selectedMiniLeagueId: null });
    expect(parseScheduleEntityFilter("ml:league-1")).toEqual({ selectedTeamId: null, selectedMiniLeagueId: "league-1" });
    expect(parseScheduleEntityFilter(null)).toEqual({ selectedTeamId: null, selectedMiniLeagueId: null });
  });

  it("does not treat an empty mini-league token as a valid id", () => {
    expect(parseScheduleEntityFilter("ml:")).toEqual({ selectedTeamId: "ml:", selectedMiniLeagueId: null });
  });
});

describe("schedule visibility", () => {
  const events = [
    { id: "team-visible", team_id: "team-1", club_id: "club-1", mini_league_id: null },
    { id: "team-hidden", team_id: "team-9", club_id: "club-9", mini_league_id: null },
    { id: "club-visible", team_id: null, club_id: "club-1", mini_league_id: null },
    { id: "club-hidden", team_id: null, club_id: "club-9", mini_league_id: null },
    { id: "league-visible", team_id: null, club_id: "club-1", mini_league_id: "league-1" },
    { id: "league-hidden", team_id: null, club_id: "club-1", mini_league_id: "league-9" },
  ];

  it("includes only directly accessible team, club and mini-league events", () => {
    expect(filterVisibleScheduleEvents(events, scope, null, null).map((e) => e.id)).toEqual([
      "team-visible", "club-visible", "league-visible",
    ]);
  });

  it("does not let ordinary club membership expose unrelated team events", () => {
    const clubOnly = { ...scope, teamIds: [], clubAdminClubIds: [] };
    expect(filterVisibleScheduleEvents(events, clubOnly, null, null).map((e) => e.id)).not.toContain("team-visible");
  });

  it("lets a club admin explicitly filter a team in their managed club", () => {
    const adminTeam = { id: "admin-team", team_id: "team-a", club_id: "club-admin", mini_league_id: null };
    expect(filterVisibleScheduleEvents([adminTeam], { ...scope, teamIds: [] }, "team-a", null)).toEqual([adminTeam]);
    expect(filterVisibleScheduleEvents([adminTeam], { ...scope, teamIds: [] }, null, null)).toEqual([]);
  });

  it("keeps explicit mini-league filtering isolated to the selected league", () => {
    expect(filterVisibleScheduleEvents(events, scope, null, "league-1").map((e) => e.id)).toContain("league-visible");
    expect(filterVisibleScheduleEvents(events, scope, null, "league-9").map((e) => e.id)).toContain("league-hidden");
  });
});

describe("cancelled-event retention", () => {
  it("keeps active and recently cancelled events but removes older cancellations", () => {
    const rows = [
      { id: "active", club_id: "club-1", is_cancelled: false, updated_at: "2020-01-01T00:00:00Z" },
      { id: "recent", club_id: "club-1", is_cancelled: true, updated_at: "2026-08-11T12:01:00Z" },
      { id: "old", club_id: "club-1", is_cancelled: true, updated_at: "2026-08-09T11:59:00Z" },
      { id: "unknown", club_id: "club-1", is_cancelled: true, updated_at: null },
    ];
    expect(retainRecentlyCancelledEvents(rows, new Date("2026-08-12T12:00:00Z")).map((row) => row.id))
      .toEqual(["active", "recent"]);
  });
});
