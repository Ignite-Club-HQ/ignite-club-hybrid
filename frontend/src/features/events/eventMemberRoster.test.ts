import { describe, expect, it } from "vitest";
import {
  buildEventMemberRoster,
  filterEventMemberRoles,
  scopeEventAttendanceMembers,
  type EventMemberRoleRow,
} from "./eventMemberRoster";

const profile = (id: string) => ({
  id,
  display_name: id,
  avatar_url: null,
});

describe("event member roster", () => {
  it("groups roles, preserves role-team pairs, and excludes the club bot", () => {
    const rows: EventMemberRoleRow[] = [
      { user_id: "member", role: "player", team_id: "team-a", profiles: profile("member") },
      { user_id: "member", role: "coach", team_id: "team-b", profiles: profile("member") },
      { user_id: "admin", role: "club_admin", team_id: null, profiles: profile("admin") },
      { user_id: "bot", role: "club_admin", team_id: null, profiles: profile("bot") },
    ];

    expect(buildEventMemberRoster(rows, "bot")).toEqual([
      {
        ...profile("member"),
        roles: ["player", "coach"],
        team_ids: ["team-a", "team-b"],
        role_team_pairs: [
          { role: "player", team_id: "team-a" },
          { role: "coach", team_id: "team-b" },
        ],
      },
      {
        ...profile("admin"),
        roles: ["club_admin"],
        team_ids: [],
        role_team_pairs: [{ role: "club_admin", team_id: null }],
      },
    ]);
  });

  it("keeps restricted roles and privileged roles visible", () => {
    const members = buildEventMemberRoster(
      [
        { user_id: "player", role: "player", team_id: "team-a", profiles: profile("player") },
        { user_id: "admin", role: "club_admin", team_id: null, profiles: profile("admin") },
        { user_id: "coach", role: "coach", team_id: "team-a", profiles: profile("coach") },
      ],
      null,
    );

    expect(filterEventMemberRoles(members, ["player"]).map((member) => member.id))
      .toEqual(["player", "admin"]);
    expect(filterEventMemberRoles(members, []).map((member) => member.id))
      .toEqual(["player", "admin", "coach"]);
  });

  it("scopes targeted club events to invited teams and club-level roles", () => {
    const members = buildEventMemberRoster(
      [
        { user_id: "targeted", role: "player", team_id: "team-a", profiles: profile("targeted") },
        { user_id: "other", role: "player", team_id: "team-b", profiles: profile("other") },
        { user_id: "admin", role: "club_admin", team_id: null, profiles: profile("admin") },
        { user_id: "committee", role: "committee_member", team_id: null, profiles: profile("committee") },
      ],
      null,
    );

    expect(
      scopeEventAttendanceMembers(members, { targetTeamIds: ["team-a"] }),
    ).toEqual([
      expect.objectContaining({ id: "targeted", roles: ["player"] }),
      expect.objectContaining({ id: "admin", roles: ["club_admin"] }),
      expect.objectContaining({ id: "committee", roles: ["committee_member"] }),
    ]);
  });
});
