import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "../featureRouter";

const mocks = vi.hoisted(() => ({
  listLiveTeams: vi.fn(),
  getLeaderboard: vi.fn(),
  listLiveTeamRoleGrants: vi.fn(),
  listLiveChildTeamAssignments: vi.fn(),
}));

vi.mock("../domains", () => ({
  connectLiveClubPointsDomain: vi.fn(async () => ({
    actor: { get_leaderboard: mocks.getLeaderboard },
  })),
  connectLiveClubDomain: async () => ({ actor: {
    list_team_role_grants: async (teamId: string) => ({ Ok: await mocks.listLiveTeamRoleGrants(teamId) }),
  } }),
  connectLiveEventsDomain: async () => ({ actor: {
    list_child_team_assignments: async (clubId: string, teamId: string) => ({ Ok: await mocks.listLiveChildTeamAssignments(clubId, teamId) }),
  } }),
}));
vi.mock("./club", () => ({ listLiveTeams: mocks.listLiveTeams }));

import { computeLiveTeamLeaderboard, computeLiveTeamMemberLeaderboard } from "./points";

const ctx = {} as FeatureBackendContext;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("ICP team leaderboards (club-side roster aggregation contract)", () => {
  it("sums each team's player + child points into one ranked club-wide list", async () => {
    mocks.listLiveTeams.mockResolvedValue([
      { id: "team-a", name: "Team A", deleted_at_ms: [] },
      { id: "team-b", name: "Team B", deleted_at_ms: [] },
    ]);
    mocks.getLeaderboard.mockImplementation(async (_club: string, kind: { User?: null; Child?: null }) =>
      "User" in kind
        ? { Ok: [{ subject_id: "user-1", points: 10 }, { subject_id: "user-2", points: 5 }] }
        : { Ok: [{ subject_id: "child-1", points: 7 }] },
    );
    mocks.listLiveTeamRoleGrants.mockImplementation(async (teamId: string) =>
      teamId === "team-a" ? [{ role: "player", account_id: "user-1" }] : [{ role: "player", account_id: "user-2" }],
    );
    mocks.listLiveChildTeamAssignments.mockImplementation(async (_club: string, teamId: string) =>
      teamId === "team-a" ? [{ child_id: "child-1" }] : [],
    );

    const rows = await computeLiveTeamLeaderboard(ctx, "club-1", "all");
    expect(mocks.listLiveTeamRoleGrants.mock.calls).toEqual([["team-a"], ["team-b"]]);
    expect(mocks.getLeaderboard.mock.calls.map(call => call[1])).toEqual([{ User: null }, { Child: null }]);
    expect(rows).toEqual([
      { team_id: "team-a", team_name: "Team A", points: 17 },
      { team_id: "team-b", team_name: "Team B", points: 5 },
    ]);
  });

  it("re-ranks the club leaderboard restricted to one team's roster", async () => {
    mocks.getLeaderboard.mockImplementation(async (_club: string, kind: { User?: null; Child?: null }) =>
      "User" in kind
        ? { Ok: [{ subject_id: "user-1", points: 10 }, { subject_id: "user-2", points: 20 }] }
        : { Ok: [{ subject_id: "child-1", points: 7 }] },
    );
    mocks.listLiveTeamRoleGrants.mockResolvedValue([{ role: "player", account_id: "user-1" }]);
    mocks.listLiveChildTeamAssignments.mockResolvedValue([{ child_id: "child-1" }]);

    const entries = await computeLiveTeamMemberLeaderboard(ctx, "club-1", "team-a", "all");
    expect(entries).toEqual([
      { subject_id: "user-1", points: 10 },
      { subject_id: "child-1", points: 7 },
    ]);
  });

  it("surfaces denied roster reads rather than reporting zero team points", async () => {
    mocks.listLiveTeams.mockResolvedValue([{ id: "team-denied", name: "Denied", deleted_at_ms: [] }]);
    mocks.getLeaderboard.mockResolvedValue({ Ok: [] });
    mocks.listLiveTeamRoleGrants.mockRejectedValueOnce(new Error("Roster access denied"));
    mocks.listLiveChildTeamAssignments.mockResolvedValue([]);
    await expect(computeLiveTeamLeaderboard(ctx, "club-1", "all")).rejects.toThrow("Roster access denied");
  });
});
