import { describe, expect, it } from "vitest";
import { resolveHomeGameTimerAccess } from "./HomePitchBoardRuntime";

const teams = [{ id: "team-1", name: "Ignite", club_id: "club-1" }];

describe("resolveHomeGameTimerAccess", () => {
  it("allows team members to view but only managers to edit", () => {
    expect(
      resolveHomeGameTimerAccess({
        timerTeamId: "team-1",
        userRoles: [{ role: "player", team_id: "team-1" }],
        isAppAdmin: false,
        editableTeams: teams,
        readOnlyTeams: [],
      }),
    ).toEqual({ canView: true, canEdit: false });
    expect(
      resolveHomeGameTimerAccess({
        timerTeamId: "team-1",
        userRoles: [{ role: "coach", team_id: "team-1" }],
        isAppAdmin: false,
        editableTeams: teams,
        readOnlyTeams: [],
      }),
    ).toEqual({ canView: true, canEdit: true });
  });

  it("allows the owning club admin and rejects unrelated users", () => {
    expect(
      resolveHomeGameTimerAccess({
        timerTeamId: "team-1",
        userRoles: [{ role: "club_admin", club_id: "club-1" }],
        isAppAdmin: false,
        editableTeams: teams,
        readOnlyTeams: [],
      }),
    ).toEqual({ canView: true, canEdit: true });
    expect(
      resolveHomeGameTimerAccess({
        timerTeamId: "team-1",
        userRoles: [{ role: "player", team_id: "team-2" }],
        isAppAdmin: false,
        editableTeams: teams,
        readOnlyTeams: [],
      }),
    ).toEqual({ canView: false, canEdit: false });
  });
});
