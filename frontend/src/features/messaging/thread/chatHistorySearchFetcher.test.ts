import { describe, expect, it, vi, beforeEach } from "vitest";
const mocks = vi.hoisted(() => ({ icp: false, search: vi.fn(), live: vi.fn() }));
vi.mock("@/live/featureRouter", () => ({
  withFeatureBackend: (_feature: string, providers: any) =>
    mocks.icp ? providers.icp({ identity: "id", target: "t" }) : providers.supabase(),
}));
vi.mock("@/lib/searchChatHistory", () => ({ searchChatHistory: mocks.search }));
vi.mock("@/live/features/messaging", () => ({ searchLiveMessages: mocks.live }));
import { createChatHistorySearchFetcher } from "./chatHistorySearchFetcher";
import { TEAM_CHAT_SCOPE } from "@/features/messaging/scopes/chatScopeAdapters";

beforeEach(() => {
  vi.clearAllMocks();
  mocks.icp = false;
});

describe("createChatHistorySearchFetcher", () => {
  it("searches Supabase when messaging is not routed to ICP", async () => {
    mocks.search.mockResolvedValue([{ id: "1" }]);
    const fetcher = createChatHistorySearchFetcher({ scope: TEAM_CHAT_SCOPE, scopeId: "team-1", selectColumns: "id" });
    const result = await fetcher("hello", new AbortController().signal);
    expect(result).toEqual([{ id: "1" }]);
    expect(mocks.live).not.toHaveBeenCalled();
  });

  it("searches the messaging_domain canister when routed to ICP, scoped by conversation id", async () => {
    mocks.icp = true;
    mocks.live.mockResolvedValue([{ id: "m1", text: "hi", author_id: "p", created_at: "2024", reply_to_id: null, profiles: null, reactions: [] }]);
    const fetcher = createChatHistorySearchFetcher({ scope: TEAM_CHAT_SCOPE, scopeId: "team-1", selectColumns: "id" });
    const result = await fetcher("hi", new AbortController().signal);
    expect(mocks.live).toHaveBeenCalledWith({ identity: "id", target: "t" }, "team-1", "hi", 100);
    expect(result).toEqual([{ id: "m1", text: "hi", author_id: "p", created_at: "2024", reply_to_id: null, profiles: null, reactions: [] }]);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it("rejects ICP search without a conversation scope id", async () => {
    mocks.icp = true;
    const fetcher = createChatHistorySearchFetcher({ scope: TEAM_CHAT_SCOPE, selectColumns: "id" });
    await expect(fetcher("hi", new AbortController().signal)).rejects.toThrow("scope id");
  });
});
