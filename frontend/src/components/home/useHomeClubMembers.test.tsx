import { beforeEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
const mocks = vi.hoisted(() => ({ routed: vi.fn(), route: vi.fn(), roster: vi.fn() }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: mocks.routed }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: mocks.route }));
vi.mock("@/live/messagingCandidates", () => ({ fetchLiveMessagingCandidates: mocks.roster }));
import { useHomeClubMembers } from "./useHomeClubMembers";
const ctx = { identity: {}, target: {} };
beforeEach(() => {
  vi.clearAllMocks();
  mocks.routed.mockReturnValue(true);
  mocks.roster.mockResolvedValue([]);
  mocks.route.mockImplementation(async (_feature, providers) => providers.icp(ctx));
});
describe("Home member-list warming", () => {
  it("warms the selected club immediately without waiting for Home discovery", async () => {
    const hook = renderHook(() => useHomeClubMembers("member", undefined, "giddy-goat"));
    await waitFor(() => expect(mocks.roster).toHaveBeenCalledWith(ctx, ["giddy-goat"]));
    expect(mocks.route).toHaveBeenCalledWith("membership", expect.anything(), { clubId: "giddy-goat" });
    hook.unmount();
  });
  it("warms every member club once with at most two reads at a time", async () => {
    const finish: Array<() => void> = [];
    mocks.roster.mockImplementation(() => new Promise(resolve => finish.push(() => resolve([]))));
    const hook = renderHook(() => useHomeClubMembers("member", ["a", "b", "c", "a"], "c"));
    await waitFor(() => expect(mocks.roster).toHaveBeenCalledTimes(2));
    expect(mocks.roster.mock.calls.map(call => call[1])).toEqual([["c"], ["a"]]);
    finish[0]();
    await waitFor(() => expect(mocks.roster).toHaveBeenCalledTimes(3));
    expect(mocks.roster.mock.calls[2][1]).toEqual(["b"]);
    finish.forEach(resolve => resolve());
    hook.unmount();
  });
  it("keeps warming other clubs when one read fails and retries on recovery", async () => {
    mocks.roster.mockRejectedValueOnce(new Error("offline"));
    const hook = renderHook(() => useHomeClubMembers("member", ["a", "b", "c"], null));
    await waitFor(() => expect(mocks.roster).toHaveBeenCalledTimes(3));
    await waitFor(() => { window.dispatchEvent(new Event("online")); expect(mocks.roster).toHaveBeenCalledTimes(6); });
    hook.unmount();
  });
  it("does not warm signed-out or Supabase sessions", () => {
    const signedOut = renderHook(() => useHomeClubMembers(undefined, ["a"], "a"));
    mocks.routed.mockReturnValue(false);
    const supabase = renderHook(() => useHomeClubMembers("member", ["a"], "a"));
    expect(mocks.route).not.toHaveBeenCalled();
    signedOut.unmount(); supabase.unmount();
  });
});