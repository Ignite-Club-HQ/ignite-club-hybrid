import { beforeEach, describe, expect, it, vi } from "vitest";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";

const mocks = vi.hoisted(() => ({ dispatch: vi.fn(), news: vi.fn(), multi: vi.fn(), clubs: vi.fn(), leagues: vi.fn() }));
vi.mock("@/live/featureRouter", () => ({ withFeatureBackend: mocks.dispatch, mergeLists: vi.fn() }));
vi.mock("@/live/features/club", () => ({ listLiveNews: mocks.news, listLiveNewsMulti: mocks.multi, listLiveTeams: vi.fn(), getLiveTeam: vi.fn() }));
vi.mock("@/live/features/membership", () => ({ listLiveMembershipClubs: mocks.clubs, getLiveMyRoleGrants: vi.fn() }));
vi.mock("@/live/features/miniLeagues", () => ({ listMyLiveMiniLeagues: mocks.leagues }));
vi.mock("@/lab/localRuntimeMode", () => ({ resolveLocalAuthMode: () => false }));
vi.mock("@/hooks/useAuth", () => ({ useAuth: () => ({ user: { id: "reader" } }) }));
vi.mock("@/live/loadBackendRouting", () => ({ isFeatureRoutedToIcp: () => true }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));
import { useClubNewsPost, type ClubNewsRow } from "./useClubNews";

const wirePost = { id: "post-g1", club_id: "giddy-goat", title: "Club update", body: "Existing full article", status: "published", created_by: { toText: () => "author" }, created_at_ms: 1n };
const cachedPost: ClubNewsRow = { id: wirePost.id, club_id: wirePost.club_id, title: wirePost.title, content: wirePost.body, author_id: "author", image_url: null, target_team_ids: null, is_important: false, published_at: new Date(1).toISOString() };
function setup(cached = true) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (cached) client.setQueryData(["club-news", "giddy-goat", 1], [cachedPost]);
  const hook = renderHook(() => useClubNewsPost("post-g1"), {
    wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
  });
  return { ...hook, client };
}
describe("News details owning-club reads", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.dispatch.mockImplementation((_feature, providers) => providers.icp({ group: "owning-group" }));
    mocks.news.mockResolvedValue([wirePost]);
    mocks.multi.mockResolvedValue([wirePost]);
    mocks.clubs.mockResolvedValue([]);
    mocks.leagues.mockResolvedValue([]);
  });
  it("opens a listed Group 1 post in its own club without rediscovering membership", async () => {
    const { result } = setup();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data?.content).toBe("Existing full article");
    expect(mocks.dispatch.mock.calls[0][2]).toEqual({ clubId: "giddy-goat" });
    expect(mocks.news).toHaveBeenCalledWith({ group: "owning-group" }, "giddy-goat");
    expect(mocks.clubs).not.toHaveBeenCalled();
    expect(mocks.multi).not.toHaveBeenCalled();
  });
  it("renders a fresh authorized feed post immediately without repeating the news call", () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    client.setQueryData(["club-news", "giddy-goat", 1, "reader", true], [cachedPost]);
    mocks.news.mockImplementation(() => new Promise(() => {}));
    const { result } = renderHook(() => useClubNewsPost("post-g1"), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(result.current.data?.content).toBe("Existing full article");
    expect(result.current.isLoading).toBe(false);
    expect(mocks.news).not.toHaveBeenCalled();
  });
  it("reuses an authorized chat card on reopening the article without a second read", async () => {
    const { result, client, unmount } = setup(false);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    const calls = mocks.dispatch.mock.calls.length;
    unmount();
    const reopened = renderHook(() => useClubNewsPost("post-g1"), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(reopened.result.current.data?.id).toBe("post-g1");
    expect(mocks.dispatch).toHaveBeenCalledTimes(calls);
  });
  it.each(["other-account", "other-provider", "stale", "invalidated"])("rechecks %s feed data instead of using it as audience evidence", async (kind) => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const key = ["club-news", "giddy-goat", 1, kind === "other-account" ? "other" : "reader", kind !== "other-provider"];
    client.setQueryData(key, [cachedPost], { updatedAt: Date.now() - (kind === "stale" ? 61_000 : 0) });
    if (kind === "invalidated") await client.invalidateQueries({ queryKey: key, refetchType: "none" });
    mocks.news.mockResolvedValue([]);
    const { result } = renderHook(() => useClubNewsPost("post-g1"), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    expect(result.current.data).toBeUndefined();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
    expect(mocks.news).toHaveBeenCalled();
  });
  it("does not authorize a cached post when the audience-checked reply omits it", async () => {
    mocks.news.mockResolvedValue([]);
    const { result } = setup();
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(result.current.data).toBeNull();
  });
  it("keeps a failed owning-club request as an error, not successful absence", async () => {
    mocks.news.mockRejectedValue(new Error("source unavailable"));
    const { result } = setup();
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
    expect(result.current.error?.message).toBe("source unavailable");
  });
  it("allows cold competition-audience links to query authorized news without ordinary clubs", async () => {
    const { result } = setup(false);
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(mocks.dispatch.mock.calls[0][2]).toEqual({ newsId: "post-g1" });
    expect(mocks.multi).toHaveBeenCalledWith({ group: "owning-group" }, []);
    expect(result.current.data?.id).toBe("post-g1");
  });
  it("uses a share-token club hint to open the post without membership discovery", async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hook = renderHook(() => useClubNewsPost("post-g1", "giddy-goat"), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(mocks.dispatch.mock.calls[0][2]).toEqual({ clubId: "giddy-goat" });
    expect(mocks.news).toHaveBeenCalledWith({ group: "owning-group" }, "giddy-goat");
    expect(mocks.clubs).not.toHaveBeenCalled();
    expect(mocks.multi).not.toHaveBeenCalled();
    expect(hook.result.current.data?.id).toBe("post-g1");
  });
  it("keeps a hinted read unauthorized when the owning club omits the post", async () => {
    mocks.news.mockResolvedValue([]);
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const hook = renderHook(() => useClubNewsPost("post-g1", "giddy-goat"), {
      wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>,
    });
    await waitFor(() => expect(hook.result.current.isSuccess).toBe(true));
    expect(hook.result.current.data).toBeNull();
    expect(mocks.multi).not.toHaveBeenCalled();
  });
});