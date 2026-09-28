import { describe, expect, it } from "vitest";
import {
  findExistingMemberByName,
  findMatchingInvitationChildren,
  getDefaultTeamRole,
  getTeamRoleLabel,
  getTeamRoleOptions,
} from "./invitationPolicy";

describe("team invitation role policy", () => {
  it("allows parents but not adult players for junior teams", () => {
    expect(getTeamRoleOptions("junior").map(({ value }) => value)).toEqual([
      "parent",
      "coach",
      "team_admin",
    ]);
  });

  it("allows adult players but not parents for senior teams", () => {
    expect(getTeamRoleOptions("senior").map(({ value }) => value)).toEqual([
      "player",
      "coach",
      "team_admin",
    ]);
  });

  it("allows every supported role for mixed teams", () => {
    expect(getTeamRoleOptions("mixed").map(({ value }) => value)).toEqual([
      "parent",
      "player",
      "coach",
      "team_admin",
    ]);
  });

  it.each([
    ["junior", "parent"],
    ["senior", "player"],
    ["mixed", "player"],
  ] as const)("defaults %s teams to %s", (teamType, expectedRole) => {
    expect(getDefaultTeamRole(teamType)).toBe(expectedRole);
  });

  it("returns the user-facing role label without changing unknown fallback behavior", () => {
    const options = getTeamRoleOptions("senior");
    expect(getTeamRoleLabel("player", options)).toBe("Adult Player");
    expect(getTeamRoleLabel("parent", options)).toBe("parent");
  });

  it("returns a fresh options array so callers cannot mutate shared policy", () => {
    const first = getTeamRoleOptions("mixed");
    first.pop();
    expect(getTeamRoleOptions("mixed")).toHaveLength(4);
  });
});

describe("team invitation identity matching", () => {
  const members = [
    { id: "member-1", display_name: "Alex Smith" },
    { id: "member-2", display_name: null },
  ];

  it("matches an existing member by trimmed case-insensitive exact name", () => {
    expect(findExistingMemberByName("  ALEX SMITH ", members)).toBe(members[0]);
  });

  it("does not use partial names or queries shorter than three characters", () => {
    expect(findExistingMemberByName("Al", members)).toBeNull();
    expect(findExistingMemberByName("Alex", members)).toBeNull();
  });

  it("returns confirmed child matches before pending matches", () => {
    const matches = findMatchingInvitationChildren(
      " sam ",
      [{ id: "child-1", name: "Sam Carter", parent_name: "Parent One" }],
      [{ id: "pending-1", name: "Sam Lee", isPending: true as const }],
    );

    expect(matches).toEqual([
      {
        id: "child-1",
        name: "Sam Carter",
        parent_name: "Parent One",
        isPending: false,
      },
      { id: "pending-1", name: "Sam Lee", isPending: true },
    ]);
  });

  it("hides a pending child when a confirmed child has the same case-insensitive name", () => {
    expect(
      findMatchingInvitationChildren(
        "casey",
        [{ id: "child-1", name: "Casey Jones" }],
        [
          { id: "pending-1", name: "CASEY JONES", isPending: true as const },
          { id: "pending-2", name: "Casey Lee", isPending: true as const },
        ],
      ).map(({ id }) => id),
    ).toEqual(["child-1", "pending-2"]);
  });

  it("retains existing duplicate pending results when there is no confirmed match", () => {
    expect(
      findMatchingInvitationChildren(
        "casey",
        [],
        [
          { id: "pending-1", name: "Casey Jones" },
          { id: "pending-2", name: "CASEY JONES" },
        ],
      ),
    ).toHaveLength(2);
  });

  it("requires two characters and limits the combined result to five", () => {
    const confirmed = Array.from({ length: 4 }, (_, index) => ({
      id: `child-${index}`,
      name: `Alex ${index}`,
    }));
    const pending = Array.from({ length: 4 }, (_, index) => ({
      id: `pending-${index}`,
      name: `Alex Pending ${index}`,
    }));

    expect(findMatchingInvitationChildren("a", confirmed, pending)).toEqual([]);
    expect(findMatchingInvitationChildren("al", confirmed, pending)).toHaveLength(5);
  });
});
