import { QueryClient } from "@tanstack/react-query";
import { afterEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock("./homeRewardsRepository", () => ({ fetchAvailableHomeRewardsForBackend: state.read }));
import { homeRewardQuery, readHomeRewardsWithDeadline } from "./homeRewardQuery";
afterEach(() => { vi.useRealTimers(); state.read.mockReset(); });
describe("Home reward catalogue lifecycle", () => {
  it("summary and drawer reuse one selected-club request and the loaded result", async () => {
    const client = new QueryClient();
    let resolveRead: ((rows: any[]) => void) | undefined;
    state.read.mockImplementation(() => new Promise((resolve) => { resolveRead = resolve; }));
    const options = homeRewardQuery({}, "member", "icp", "goat");
    const summary = client.fetchQuery(options);
    const drawer = client.fetchQuery(options);
    resolveRead?.([{ id: "scarf", points_required: 20 }]);
    expect(await summary).toEqual([{ id: "scarf", points_required: 20 }]);
    expect(await drawer).toEqual(await client.fetchQuery(options));
    expect(state.read).toHaveBeenCalledTimes(1);
    client.clear();
  });
  it("does not reuse another account, backend or club's catalogue", () => {
    const key = homeRewardQuery({}, "a", "icp", "goat").queryKey;
    expect(homeRewardQuery({}, "b", "icp", "goat").queryKey).not.toEqual(key);
    expect(homeRewardQuery({}, "a", "supabase", "goat").queryKey).not.toEqual(key);
    expect(homeRewardQuery({}, "a", "icp", "cats").queryKey).not.toEqual(key);
  });
  it("ends an unresolved wait without automatic retries", async () => {
    vi.useFakeTimers();
    const request = readHomeRewardsWithDeadline(() => new Promise(() => {}));
    const assertion = expect(request).rejects.toThrow("Rewards request timed out");
    await vi.advanceTimersByTimeAsync(20_000);
    await assertion;
    expect(homeRewardQuery({}, "a", "icp", "goat").retry).toBe(false);
  });
});