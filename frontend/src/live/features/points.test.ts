import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FeatureBackendContext } from "../featureRouter";
const calls = vi.hoisted(() => ({
  refresh_club_roles: vi.fn(), list_rewards: vi.fn(),
  save_club_points_settings: vi.fn(), create_reward: vi.fn(),
}));
vi.mock("../domains", () => ({ connectLiveClubPointsDomain: vi.fn(async () => ({ actor: calls })) }));
import { createLiveClubReward, listLiveClubRewards, saveLiveClubPointsSettings } from "./points";
const ctx = { identity: {}, target: {} } as FeatureBackendContext;
describe("ICP reward persistence", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    calls.refresh_club_roles.mockResolvedValue({ Ok: null });
    calls.list_rewards.mockResolvedValue({ Ok: [] });
  });
  it("verifies club membership before reading rewards", async () => {
    await listLiveClubRewards(ctx, "goat", null, false);
    expect(calls.refresh_club_roles).toHaveBeenCalledWith("goat");
    expect(calls.refresh_club_roles.mock.invocationCallOrder[0]).toBeLessThan(calls.list_rewards.mock.invocationCallOrder[0]);
  });
  it("stops a reward read if membership verification fails", async () => {
    calls.refresh_club_roles.mockResolvedValue({ Err: "Could not verify club membership" });
    await expect(listLiveClubRewards(ctx, "goat", null, false)).rejects.toThrow("Could not verify club membership");
    expect(calls.list_rewards).not.toHaveBeenCalled();
  });
  it("sends the entered reward and 20-point cost without replacing its fields", async () => {
    calls.create_reward.mockResolvedValue({ Ok: { id: "rwd-goat-1" } });
    expect(await createLiveClubReward(ctx, "goat", "Free Goat", null, 20, false, "general", null, false, null, null)).toEqual({ id: "rwd-goat-1" });
    expect(calls.create_reward).toHaveBeenCalledWith("goat", "Free Goat", [], 20, false, "general", [], false, [], []);
  });
  it("propagates a rejected reward instead of claiming success", async () => {
    calls.create_reward.mockResolvedValue({ Err: "Club admin required" });
    await expect(createLiveClubReward(ctx, "goat", "Free Goat", null, 20, false, "general", null, false, null, null)).rejects.toThrow("Club admin required");
  });
  it("waits for points-settings persistence and propagates errors", async () => {
    calls.save_club_points_settings.mockResolvedValue({ Err: "Club admin required" });
    await expect(saveLiveClubPointsSettings(ctx, "goat", "Goat points", false)).rejects.toThrow("Club admin required");
  });
});