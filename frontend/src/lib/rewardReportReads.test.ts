import { beforeEach, describe, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ redemptions: vi.fn(), rewards: vi.fn(), profiles: vi.fn() }));
vi.mock("@/live/membershipRouting", () => ({ readMembershipInScope: async (_ctx: unknown, scope: unknown, read: (ctx: unknown) => unknown) => read({ scope }) }));
vi.mock("@/live/features/points", () => ({ listLiveRedemptions: m.redemptions, listLiveClubRewards: m.rewards }));
vi.mock("@/live/features/club", () => ({ listLiveTeams: async () => [{ id: "team", club_id: "club" }] }));
vi.mock("@/live/features/membership", () => ({ listLiveTeamRoleGrants: async () => [{ account_id: "principal:adult" }] }));
vi.mock("@/live/features/events", () => ({ listLiveChildTeamAssignments: async () => [{ child_id: "child" }] }));
vi.mock("@/live/features/identityAccessClient", () => ({ listLiveProfilesByIds: m.profiles }));
vi.mock("@/live/features/vault", () => ({ resolveLivePiiTextBatch: async () => new Map([["child", "Player"]]) }));
import { readIcpRewardReport } from "./rewardReportReads";
import type { FeatureBackendContext } from "@/live/featureRouter";
beforeEach(() => {
  vi.clearAllMocks(); m.rewards.mockResolvedValue([{ id: "reward", name: "Reward", reward_type: "custom" }]);
  m.profiles.mockResolvedValue([{ account_id: "adult", display_name: "Member" }]);
  m.redemptions.mockResolvedValue([
    { id: "adult-row", reward_id: "reward", user_id: ["principal:adult"], child_id: [], created_at_ms: 10n, redeemed_at_ms: [], points_spent: 5, status: "redeemed" },
    { id: "other-row", reward_id: "reward", user_id: ["outsider"], child_id: [], created_at_ms: 10n, redeemed_at_ms: [], points_spent: 5, status: "redeemed" },
  ]);
});
describe("authorized current-team reward reports", () => {
  it("filters by selected team and retains reward and normalized member names", async () => {
    const rows = await readIcpRewardReport({} as FeatureBackendContext, "club", "team", new Date(0), new Date(20));
    expect(rows.map(r => r.id)).toEqual(["adult-row"]);
    expect(rows[0].club_rewards?.name).toBe("Reward");
    expect(rows[0].profiles?.display_name).toBe("Member");
  });
  it("rejects a team outside the authorized club", async () => {
    await expect(readIcpRewardReport({} as FeatureBackendContext, "club", "foreign", new Date(0), new Date(20))).rejects.toThrow("Team does not belong");
  });
});