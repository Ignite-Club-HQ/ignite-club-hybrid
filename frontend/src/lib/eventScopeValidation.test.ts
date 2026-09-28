import { describe, it, expect } from "vitest";
import { validateEventTeamClubScope } from "./eventScopeValidation";

const teamsInClubA = [
  { id: "team-a1", club_id: "club-a" },
  { id: "team-a2", club_id: "club-a" },
];

describe("validateEventTeamClubScope", () => {
  it("allows club-wide events (no team_id)", () => {
    expect(validateEventTeamClubScope(null, teamsInClubA, "club-a")).toEqual({ ok: true });
    expect(validateEventTeamClubScope("", teamsInClubA, "club-a")).toEqual({ ok: true });
    expect(validateEventTeamClubScope(undefined, teamsInClubA, "club-a")).toEqual({ ok: true });
  });

  it("allows a valid same-club team", () => {
    expect(validateEventTeamClubScope("team-a1", teamsInClubA, "club-a")).toEqual({ ok: true });
  });

  it("rejects a team that belongs to a different club", () => {
    const teams = [
      { id: "team-a1", club_id: "club-a" },
      { id: "team-b1", club_id: "club-b" },
    ];
    expect(validateEventTeamClubScope("team-b1", teams, "club-a")).toEqual({
      ok: false,
      reason: "team_not_in_club",
    });
  });

  it("rejects a team missing from the current list (fail closed)", () => {
    expect(validateEventTeamClubScope("team-unknown", teamsInClubA, "club-a")).toEqual({
      ok: false,
      reason: "team_not_in_club",
    });
  });

  it("fails closed when the team list is undefined (still loading)", () => {
    expect(validateEventTeamClubScope("team-a1", undefined, "club-a")).toEqual({
      ok: false,
      reason: "list_unavailable",
    });
  });

  it("fails closed when the team list is empty", () => {
    expect(validateEventTeamClubScope("team-a1", [], "club-a")).toEqual({
      ok: false,
      reason: "list_unavailable",
    });
  });
});
