import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const scopes: unknown[] = [];
const profileMode = vi.hoisted(() => ({ rehearsal: false, fetch: vi.fn(async () => new Map()), cache: vi.fn(() => ({ cached: new Map() })) }));
vi.mock("@/live/privateProfileSearchMode", () => ({ privateProfileSearchRehearsalEnabled: () => profileMode.rehearsal }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_f: string, impl: any, scope: unknown) => { scopes.push(scope); return impl.icp({}); },
}));
vi.mock("@/live/features/messaging", () => ({
  listLiveLatestMessagesPage: vi.fn(async () => ({ messages: [], next_sequence: [] })),
  listLiveReactions: vi.fn(async () => []),
  ensureLiveClubConversations: vi.fn(),
  isLiveConversationAbsent: vi.fn(async () => false),
}));
vi.mock("@/lib/pollReadRepository", () => ({ prefetchMessagePolls: vi.fn() }));
vi.mock("@/lib/profileCache", () => ({ fetchProfilesWithCache: profileMode.fetch, getProfilesFromCache: profileMode.cache }));
vi.mock("@/lib/clubTeamCache", () => ({ getCachedTeam: (id: string) => (id === "t-cached" ? { club_id: "c-cached" } : null) }));

import { fetchIcpTeamLatestPage, mapLiveTeamRows, prefetchIcpTeamThreads, teamThreadScope } from "./icpTeamThreadPage";
import { listLiveLatestMessagesPage, listLiveReactions } from "@/live/features/messaging";

describe("cold team chat opening", () => {
  it("does not read or persist generic author names in private-name rehearsal", async () => {
    profileMode.rehearsal = true; profileMode.fetch.mockClear(); profileMode.cache.mockClear();
    const ready = vi.fn();
    try {
      const rows = await mapLiveTeamRows({}, 'team', [{ id: 'm', body: 'Hello', sender: { toText: () => 'person' }, sequence: 1n, created_at_ms: 1n }], ready);
      expect(rows[0].profiles).toBeNull(); expect(ready.mock.calls[0][0][0].profiles).toBeNull();
      expect(profileMode.fetch).not.toHaveBeenCalled(); expect(profileMode.cache).not.toHaveBeenCalled();
    } finally { profileMode.rehearsal = false; }
  });
  it("publishes authorized message bodies before slow reactions finish", async () => {
    let finishReactions: (rows: any[]) => void = () => {};
    vi.mocked(listLiveReactions).mockReturnValueOnce(new Promise(resolve => { finishReactions = resolve; }));
    vi.mocked(listLiveLatestMessagesPage).mockResolvedValueOnce({ messages: [{ id: "m-u9", body: "Hello U9", sender: { toText: () => "paul" },
      sequence: 1n, created_at_ms: 1n, attachment: [], reply_to_id: [] }], next_sequence: [] } as any);
    const qc = new QueryClient();
    const pending = fetchIcpTeamLatestPage(qc, "paul", "u9", "g2-test");
    await vi.waitFor(() => expect(qc.getQueryData(["team-messages", "u9"])).toMatchObject({ messages: [{ id: "m-u9", text: "Hello U9" }] }));
    finishReactions([]); await pending; qc.clear();
  });

  it("does not overwrite existing or optimistic messages during enrichment", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["team-messages", "u9"], { messages: [{ id: "pending", text: "New message" }] });
    await fetchIcpTeamLatestPage(qc, "paul", "u9", "g2-test");
    expect(qc.getQueryData(["team-messages", "u9"])).toEqual({ messages: [{ id: "pending", text: "New message" }] });
    qc.clear();
  });

  it("never seeds messages from a cancelled read", async () => {
    const qc = new QueryClient(); const controller = new AbortController(); controller.abort();
    await expect(fetchIcpTeamLatestPage(qc, "paul", "u9", "g2-test", controller.signal)).rejects.toThrow("cancelled");
    expect(qc.getQueryData(["team-messages", "u9"])).toBeUndefined(); qc.clear();
  });
  it("reads a team chat through its club when the club is known", () => {
    expect(teamThreadScope("t1", "c1")).toEqual({ clubId: "c1" });
    expect(teamThreadScope("t-cached")).toEqual({ clubId: "c-cached" });
    expect(teamThreadScope("t-unknown")).toEqual({ teamId: "t-unknown" });
  });

  it("preloads only uncached chats, at most five", async () => {
    const qc = new QueryClient();
    qc.setQueryData(["team-messages", "t0"], { messages: [] });
    scopes.length = 0;
    await prefetchIcpTeamThreads(qc, "u", Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, clubId: "c1" })));
    expect(scopes).toHaveLength(4);
    expect(qc.getQueryData(["team-messages", "t1"])).toMatchObject({ messages: [], hasOlderMessages: false });
    expect(qc.getQueryData(["team-messages", "t5"])).toBeUndefined();
  });
});
