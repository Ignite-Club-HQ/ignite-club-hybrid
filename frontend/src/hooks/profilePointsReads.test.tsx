import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ clubs: vi.fn(), ids: vi.fn(), history: vi.fn() }));
vi.mock("@/live/authBackendMode", () => ({ resolveAuthBackend: () => "icp" }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: (_feature: unknown, providers: any) => providers.icp({}) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
vi.mock("@/lib/icpRewardsReads", () => ({ liveRewardClubs: mocks.clubs, liveMyRewardClubIds: mocks.ids, liveMyPointsHistory: mocks.history }));
import { useRewardClubDirectory } from "./useRewardClubDirectory";
import { useProfilePointsHistory } from "./useProfilePointsHistory";
function setup() {
  const client = new QueryClient();
  const wrapper = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  return { client, wrapper };
}
beforeEach(() => {
  vi.resetAllMocks();
  mocks.ids.mockResolvedValue(["goat"]);
  mocks.clubs.mockResolvedValue([{ id: "goat", name: "Giddy Goat", hasPro: true, logo_url: null }]);
  mocks.history.mockResolvedValue([{ id: "award", amount: 10, created_at: "2026-10-23T00:00:00Z" }]);
});
describe("Shared profile points reads", () => {
  it("shares directory and history between Profile and rewards without duplicate reads", async () => {
    const { wrapper, client } = setup();
    const { result } = renderHook(() => ({
      profileClubs: useRewardClubDirectory("member", null),
      rewardClubs: useRewardClubDirectory("member", null),
      profileHistory: useProfilePointsHistory("member", null),
      weeklyHistory: useProfilePointsHistory("member", null),
    }), { wrapper });
    await waitFor(() => expect(result.current.profileHistory.isSuccess && result.current.rewardClubs.isSuccess).toBe(true));
    expect(mocks.ids).toHaveBeenCalledTimes(1);
    expect(mocks.clubs).toHaveBeenCalledTimes(1);
    expect(mocks.history).toHaveBeenCalledTimes(1);
    expect(result.current.profileClubs.data?.[0].hasPro).toBe(true);
    client.clear();
  });
  it("leaves Pro unknown while directory retrieval is unresolved, without blocking history", async () => {
    let finish: ((value: any[]) => void) | undefined;
    mocks.clubs.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const { wrapper, client } = setup();
    const { result } = renderHook(() => ({ clubs: useRewardClubDirectory("member", "goat"), history: useProfilePointsHistory("member", "goat") }), { wrapper });
    await waitFor(() => expect(result.current.history.isSuccess).toBe(true));
    expect(result.current.clubs.data).toBeUndefined();
    expect(mocks.ids).not.toHaveBeenCalled();
    finish?.([{ id: "goat", hasPro: false }]);
    await waitFor(() => expect(result.current.clubs.data?.[0].hasPro).toBe(false));
    client.clear();
  });
  it("does not convert failed discovery into a confirmed non-Pro result", async () => {
    mocks.clubs.mockRejectedValue(new Error("unavailable"));
    const { wrapper, client } = setup();
    const { result } = renderHook(() => useRewardClubDirectory("member", "goat"), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    client.clear();
  });
});