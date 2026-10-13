import { describe, expect, it, vi } from "vitest";
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
}));
vi.mock("./club", () => ({ listLiveTeams: mocks.listLiveTeams }));
vi.mock("./membership", () => ({ listLiveTeamRoleGrants: mocks.listLiveTeamRoleGrants }));
vi.mock("./events", () => ({ listLiveChildTeamAssignments: mocks.listLiveChildTeamAssignments }));

import { computeLiveTeamLeaderboard, computeLiveTeamMemberLeaderboard } from "./points";

const ctx = {} as FeatureBackendContext;

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
});
