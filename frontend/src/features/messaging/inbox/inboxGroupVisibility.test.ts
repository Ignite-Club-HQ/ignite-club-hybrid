import { describe, expect, it } from "vitest";
import { filterInboxGroupsByVisibility } from "./inboxGroupVisibility";

type Group = {
  id: string;
  club_id?: string | null;
  team_id?: string | null;
  mini_league_id?: string | null;
  allowed_roles?: string[] | null;
};

type Role = { role: string; club_id?: string | null; team_id?: string | null };
const group = (id: string, overrides: Partial<Group> = {}): Group => ({ id, ...overrides });

function visible(
  groups: Group[],
  overrides: Partial<{
    roles: Role[];
    leagueIds: Set<string>;
    isAppAdmin: boolean;
    isCommitteeMember: boolean;
    isOnline: boolean;
  }> = {},
) {
  return filterInboxGroupsByVisibility({
    groups,
    roles: [],
    leagueIds: new Set(),
    isAppAdmin: false,
    isCommitteeMember: false,
    isOnline: true,
    ...overrides,
  }).map((item) => item.id);
}

describe("filterInboxGroupsByVisibility", () => {
  const scoped = [
    group("club", { club_id: "club-1", allowed_roles: ["coach"] }),
    group("team", { club_id: "club-1", team_id: "team-1", allowed_roles: ["coach"] }),
  ];

  it("preserves every authorized row for an app administrator", () => {
    expect(visible(scoped, { isAppAdmin: true })).toEqual(["club", "team"]);
  });

  it("preserves every authorized row for a committee member", () => {
    expect(visible(scoped, { isCommitteeMember: true })).toEqual(["club", "team"]);
  });

  it("retains the user-scoped cached rows when offline roles are unavailable", () => {
    expect(visible(scoped, { isOnline: false, roles: [] })).toEqual(["club", "team"]);
  });

  it("keeps membership-authorized personal groups without user_roles", () => {
    expect(visible([group("personal")])).toEqual(["personal"]);
  });

  it("fails closed for scoped groups when online roles are unavailable", () => {
    expect(visible(scoped)).toEqual([]);
  });

  it("shows an unrestricted scoped group to an authenticated member", () => {
    expect(visible(
      [group("open", { club_id: "club-1", allowed_roles: [] })],
      { roles: [{ role: "player", club_id: "club-1" }] },
    )).toEqual(["open"]);
  });

  it("matches club groups by both allowed role and exact club", () => {
    expect(visible(scoped, {
      roles: [
        { role: "coach", club_id: "club-2" },
        { role: "player", club_id: "club-1" },
      ],
    })).toEqual([]);
    expect(visible(scoped, {
      roles: [{ role: "coach", club_id: "club-1" }],
    })).toEqual(["club"]);
  });

  it("matches team groups by both allowed role and immutable team id", () => {
    expect(visible(scoped, {
      roles: [{ role: "coach", club_id: "club-1", team_id: "team-2" }],
    })).toEqual(["club"]);
    expect(visible(scoped, {
      roles: [{ role: "coach", club_id: "club-1", team_id: "team-1" }],
    })).toEqual(["club", "team"]);
  });

  it("allows a league administrator only through the league's club scope", () => {
    const league = group("league", {
      club_id: "club-1",
      mini_league_id: "league-1",
      allowed_roles: ["parent"],
    });
    expect(visible([league], {
      roles: [{ role: "club_admin", club_id: "club-2" }],
    })).toEqual([]);
    expect(visible([league], {
      roles: [{ role: "club_admin", club_id: "club-1" }],
    })).toEqual(["league"]);
  });

  it("requires both league membership and an allowed role for ordinary members", () => {
    const league = group("league", {
      club_id: "club-1",
      mini_league_id: "league-1",
      allowed_roles: ["parent"],
    });
    expect(visible([league], {
      roles: [{ role: "parent", club_id: "club-1" }],
      leagueIds: new Set(),
    })).toEqual([]);
    expect(visible([league], {
      roles: [{ role: "parent", club_id: "club-1" }],
      leagueIds: new Set(["league-1"]),
    })).toEqual(["league"]);
  });
});
