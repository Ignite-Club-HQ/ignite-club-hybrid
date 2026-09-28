import { describe, expect, it, vi } from "vitest";
import {
  fetchAvailableHomeRewards,
  fetchHomeUserChildren,
  fetchNextHomeRewardInfo,
  fetchPendingHomeRedemptions,
} from "./homeRewardsRepository";

type Result = { data: any; error?: unknown };

function builder(result: Result) {
  const value: any = {
    select: vi.fn(), eq: vi.fn(), in: vi.fn(), neq: vi.fn(),
    order: vi.fn(), limit: vi.fn(),
    then: (resolve: (result: Result) => unknown) => Promise.resolve(result).then(resolve),
  };
  for (const method of ["select", "eq", "in", "neq", "order", "limit"] as const) {
    value[method].mockReturnValue(value);
  }
  return value;
}

function clientFor(results: Record<string, Result | Result[]>) {
  const calls = new Map<string, number>();
  const builders: Record<string, any[]> = {};
  const from = vi.fn((table: string) => {
    const configured = results[table];
    const sequence = Array.isArray(configured) ? configured : [configured ?? { data: [] }];
    const index = calls.get(table) ?? 0;
    calls.set(table, index + 1);
    const value = builder(sequence[Math.min(index, sequence.length - 1)]);
    (builders[table] ??= []).push(value);
    return value;
  });
  return { client: { from }, from, builders };
}

describe("Home reward reads", () => {
  it("selects only the latest pending redemption for the current user", async () => {
    const rows = [{ id: "redemption-1", status: "pending" }];
    const { client, builders } = clientFor({ reward_redemptions: { data: rows } });
    await expect(fetchPendingHomeRedemptions(client, "user-1")).resolves.toEqual(rows);

    const query = builders.reward_redemptions[0];
    expect(query.eq).toHaveBeenNthCalledWith(1, "user_id", "user-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "status", "pending");
    expect(query.order).toHaveBeenCalledWith("redeemed_at", { ascending: false });
    expect(query.limit).toHaveBeenCalledWith(1);
  });

  it("filters available rewards by exact club, active state and reward type", async () => {
    const rows = [{ id: "reward-1", points_required: 100 }];
    const { client, builders } = clientFor({ club_rewards: { data: rows } });
    await expect(fetchAvailableHomeRewards(client, "club-1")).resolves.toEqual(rows);

    const query = builders.club_rewards[0];
    expect(query.eq).toHaveBeenNthCalledWith(1, "club_id", "club-1");
    expect(query.eq).toHaveBeenNthCalledWith(2, "is_active", true);
    expect(query.neq).toHaveBeenCalledWith("reward_type", "player_of_match");
    expect(query.order).toHaveBeenCalledWith("points_required", { ascending: true });
  });

  it("does not query a next reward when no eligible Pro club exists", async () => {
    const { client, from } = clientFor({});
    await expect(
      fetchNextHomeRewardInfo(client, [{ id: "club-1", hasPro: false }], false),
    ).resolves.toBeNull();
    expect(from).not.toHaveBeenCalled();
  });

  it("uses only Pro clubs for the next threshold, with app-admin bypass", async () => {
    const { client, builders } = clientFor({
      club_rewards: { data: [{ points_required: 50, name: "Scarf" }] },
    });
    await expect(
      fetchNextHomeRewardInfo(
        client,
        [{ id: "club-1", hasPro: false }, { id: "club-2", hasPro: true }],
        false,
      ),
    ).resolves.toEqual({ points_required: 50, name: "Scarf" });
    expect(builders.club_rewards[0].in).toHaveBeenCalledWith("club_id", ["club-2"]);

    const admin = clientFor({ club_rewards: { data: [] } });
    await fetchNextHomeRewardInfo(
      admin.client,
      [{ id: "club-1", hasPro: false }, { id: "club-2", hasPro: true }],
      true,
    );
    expect(admin.builders.club_rewards[0].in).toHaveBeenCalledWith(
      "club_id",
      ["club-1", "club-2"],
    );
  });

  it("preserves empty fallback behaviour for unavailable reward payloads", async () => {
    const pending = clientFor({ reward_redemptions: { data: null, error: new Error("offline") } });
    await expect(fetchPendingHomeRedemptions(pending.client, "user-1")).resolves.toEqual([]);
    const available = clientFor({ club_rewards: { data: null, error: new Error("offline") } });
    await expect(fetchAvailableHomeRewards(available.client, "club-1")).resolves.toEqual([]);
  });
});

describe("fetchHomeUserChildren", () => {
  it("merges owned and guardian-linked children, de-duplicates and sorts by name", async () => {
    const { client, builders } = clientFor({
      children: { data: [
        { id: "child-b", name: "Zoe", ignite_points: 20 },
        { id: "child-a", name: "Alex", ignite_points: 10 },
      ] },
      child_guardians: { data: [
        { child_id: "child-b", children: { id: "child-b", name: "Zoe", ignite_points: 20 } },
        { child_id: "child-c", children: { id: "child-c", name: "Morgan", ignite_points: 30 } },
      ] },
    });

    await expect(fetchHomeUserChildren(client, "guardian-1")).resolves.toEqual([
      { id: "child-a", name: "Alex", ignite_points: 10 },
      { id: "child-c", name: "Morgan", ignite_points: 30 },
      { id: "child-b", name: "Zoe", ignite_points: 20 },
    ]);
    expect(builders.children[0].eq).toHaveBeenCalledWith("parent_id", "guardian-1");
    expect(builders.child_guardians[0].eq).toHaveBeenCalledWith("guardian_id", "guardian-1");
  });

  it("retains valid partial child data when either relationship read is empty", async () => {
    const { client } = clientFor({
      children: { data: null, error: new Error("owned unavailable") },
      child_guardians: { data: [
        { child_id: "child-1", children: { id: "child-1", name: "Sam", ignite_points: 0 } },
      ] },
    });
    await expect(fetchHomeUserChildren(client, "guardian-1")).resolves.toEqual([
      { id: "child-1", name: "Sam", ignite_points: 0 },
    ]);
  });
});
