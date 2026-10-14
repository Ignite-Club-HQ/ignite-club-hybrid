import { describe, expect, it } from "vitest";
import { dutyTeamBadgeAudience } from "./MyTeamDutyTag";

describe("dutyTeamBadgeAudience", () => {
  it("shows the personal badge only to a member or guardian of the assigned team", () => {
    expect(dutyTeamBadgeAudience(
      { club_id: "club-1", duty_team_id: "team-2" },
      { teamIds: ["team-2"], leagueAdminClubIds: [] },
    )).toBe("member");
    expect(dutyTeamBadgeAudience(
      { club_id: "club-1", duty_team_id: "team-2" },
      { teamIds: ["team-1"], leagueAdminClubIds: [] },
    )).toBeNull();
  });

  it("shows the assigned team to league admins of that club", () => {
    expect(dutyTeamBadgeAudience(
      { club_id: "club-1", duty_team_id: "team-2" },
      { teamIds: [], leagueAdminClubIds: ["club-1"] },
    )).toBe("league_admin");
  });

  it("hides missing assignments and unrelated club schedules", () => {
    expect(dutyTeamBadgeAudience(
      { club_id: "club-1", duty_team_id: null },
      { teamIds: ["team-1"], leagueAdminClubIds: ["club-1"] },
    )).toBeNull();
    expect(dutyTeamBadgeAudience(
      { club_id: "club-2", duty_team_id: "team-2" },
      { teamIds: [], leagueAdminClubIds: ["club-1"] },
    )).toBeNull();
  });
});