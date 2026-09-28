import { describe, expect, it } from "vitest";
import { groupRoleRowsByUser, type RoleRosterRow } from "./roleRoster";

const makeRow = (userId: string, role: string, overrides: Partial<RoleRosterRow> = {}): RoleRosterRow => ({
  id: `${userId}-${role}`,
  role,
  user_id: userId,
  profiles: { id: userId, display_name: userId, avatar_url: null },
  ...overrides,
});

describe("groupRoleRowsByUser", () => {
  it("groups role rows by profile while excluding bot entries", () => {
    const rows: RoleRosterRow[] = [
      makeRow("member-1", "player"),
      makeRow("member-1", "coach"),
      makeRow("club-bot", "club_admin"),
      makeRow("member-2", "team_admin"),
    ];

    expect(groupRoleRowsByUser(rows, { excludeUserIds: ["club-bot"] })).toEqual({
      "member-1": {
        profile: { id: "member-1", display_name: "member-1", avatar_url: null },
        roles: [
          expect.objectContaining({ id: "member-1-player", role: "player" }),
          expect.objectContaining({ id: "member-1-coach", role: "coach" }),
        ],
      },
      "member-2": {
        profile: { id: "member-2", display_name: "member-2", avatar_url: null },
        roles: [expect.objectContaining({ id: "member-2-team_admin", role: "team_admin" })],
      },
    });
  });

  it("ignores rows without a user id", () => {
    expect(groupRoleRowsByUser([
      { id: "missing-user", role: "coach", user_id: null, profiles: null },
      { id: "known-user", role: "player", user_id: "member-1", profiles: { id: "member-1", display_name: "Known", avatar_url: null } },
    ])).toEqual({
      "member-1": {
        profile: { id: "member-1", display_name: "Known", avatar_url: null },
        roles: [expect.objectContaining({ id: "known-user", role: "player" })],
      },
    });
  });
});
