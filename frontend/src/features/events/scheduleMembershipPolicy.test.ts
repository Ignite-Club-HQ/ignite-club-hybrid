import { describe, expect, it } from "vitest";
import {
  deriveRoleScheduleScope,
  uniqueIds,
} from "@/features/events/scheduleMembershipPolicy";

describe("schedule membership role policy", () => {
  it("derives direct team and club memberships", () => {
    const result = deriveRoleScheduleScope([
      { role: "player", team_id: "team-1", club_id: "club-1" },
      { role: "parent", team_id: null, club_id: "club-2" },
    ]);
    expect(result.teamIds).toEqual(["team-1"]);
    expect([...result.clubIds]).toEqual(["club-1", "club-2"]);
    expect(result.isAppAdmin).toBe(false);
  });

  it("grants club-admin team-filter scope without granting all mini-leagues", () => {
    const result = deriveRoleScheduleScope([
      { role: "club_admin", club_id: "club-1", team_id: null },
    ]);
    expect([...result.clubAdminClubIds]).toEqual(["club-1"]);
    expect([...result.leagueAdminClubIds]).toEqual([]);
  });

  it("grants league administrators every league in only their scoped club", () => {
    const result = deriveRoleScheduleScope([
      { role: "league_admin", club_id: "club-1", team_id: null },
    ]);
    expect([...result.leagueAdminClubIds]).toEqual(["club-1"]);
    expect([...result.clubAdminClubIds]).toEqual([]);
  });

  it("tracks app-admin override and its explicitly associated club scopes", () => {
    const result = deriveRoleScheduleScope([
      { role: "app_admin", club_id: "club-1", team_id: null },
      { role: "app_admin", club_id: null, team_id: null },
    ]);
    expect(result.isAppAdmin).toBe(true);
    expect([...result.clubAdminClubIds]).toEqual(["club-1"]);
    expect([...result.leagueAdminClubIds]).toEqual(["club-1"]);
  });

  it("fails closed for absent role rows", () => {
    const result = deriveRoleScheduleScope(undefined);
    expect(result.teamIds).toEqual([]);
    expect([...result.clubIds]).toEqual([]);
    expect(result.isAppAdmin).toBe(false);
  });
});

describe("membership id composition", () => {
  it("drops nulls and deduplicates guardian, parent and admin paths", () => {
    expect(uniqueIds(["one", null, "one", undefined, "two"])).toEqual(["one", "two"]);
  });
});
