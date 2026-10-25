import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { invalidateRewardCatalog } from "./invalidateRewardCatalog";

describe.each(["supabase", "icp"])("%s reward catalogue refresh", (backend) => {
  it("refreshes the featured reward when returning from management to Home/Profile", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { staleTime: 300_000 } } });
    let featured = "old";
    const read = vi.fn(async () => [
      { id: "old", is_default: featured === "old" },
      { id: "new", is_default: featured === "new" },
    ]);
    const home = { queryKey: ["home-available-rewards", "member", backend, "goat"], queryFn: read };
    const profile = { queryKey: ["available-rewards", "goat"], queryFn: read };
    await client.fetchQuery(home);
    await client.fetchQuery(profile);
    featured = "new";
    await invalidateRewardCatalog(client, "goat");
    for (const query of [home, profile]) {
      const rewards = await client.fetchQuery(query);
      expect(rewards.find(reward => reward.is_default)?.id).toBe("new");
      expect(rewards.find(reward => reward.id === "old")?.is_default).toBe(false);
    }
    expect(read).toHaveBeenCalledTimes(4);
    client.clear();
  });

  it("invalidates affected-club views without touching unrelated clubs or points balances", async () => {
    const client = new QueryClient();
    const affected = [
      ["club-rewards", "goat", "member", backend],
      ["home-available-rewards", "member", backend, "goat"],
      ["available-rewards", "goat"],
      ["next-reward-info", ["goat", "cats"]],
      ["next-reward-thresholds", "member", "goat"],
      ["next-reward-thresholds", "member", null],
    ];
    const unrelated = [
      ["club-rewards", "cats"],
      ["home-available-rewards", "member", backend, "cats"],
      ["available-rewards", "cats"],
      ["next-reward-info", ["cats"]],
      ["next-reward-thresholds", "member", "cats"],
      ["user-club-points", "member", "goat"],
    ];
    for (const key of [...affected, ...unrelated]) client.setQueryData(key, []);
    await invalidateRewardCatalog(client, "goat");
    for (const key of affected) expect(client.getQueryState(key)?.isInvalidated).toBe(true);
    for (const key of unrelated) expect(client.getQueryState(key)?.isInvalidated).toBe(false);
    client.clear();
  });

  it("marks the source catalogue stale before refetching an active derived summary", async () => {
    const client = new QueryClient();
    const invalidate = vi.spyOn(client, "invalidateQueries");
    await invalidateRewardCatalog(client, "goat");
    expect(invalidate).toHaveBeenCalledTimes(2);
    const source = invalidate.mock.calls[0][0]?.predicate;
    const summary = invalidate.mock.calls[1][0]?.predicate;
    const catalogue = client.getQueryCache().build(client, { queryKey: ["home-available-rewards", "member", backend, "goat"] });
    const derived = client.getQueryCache().build(client, { queryKey: ["next-reward-info", ["goat"]] });
    expect(source?.(catalogue)).toBe(true);
    expect(source?.(derived)).toBe(false);
    expect(summary?.(derived)).toBe(true);
    client.clear();
  });
});