import { describe, expect, it, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";

const scopes: unknown[] = [];
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
vi.mock("@/lib/profileCache", () => ({ fetchProfilesWithCache: async () => new Map(), getProfilesFromCache: () => ({ cached: new Map() }) }));
vi.mock("@/lib/clubTeamCache", () => ({ getCachedTeam: (id: string) => (id === "t-cached" ? { club_id: "c-cached" } : null) }));

import { prefetchIcpTeamThreads, teamThreadScope } from "./icpTeamThreadPage";

describe("cold team chat opening", () => {
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
