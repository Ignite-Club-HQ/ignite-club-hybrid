import { describe, expect, it, vi } from "vitest";

const { fetchProfilesWithCache, listLiveReactions } = vi.hoisted(() => ({
  fetchProfilesWithCache: vi.fn(),
  listLiveReactions: vi.fn(),
}));

vi.mock("@/lib/profileCache", () => ({ fetchProfilesWithCache }));
vi.mock("@/live/features/messaging", () => ({
  listLiveLatestMessagesPage: vi.fn(),
  listLiveReactions,
}));
vi.mock("@/hooks/useChatPerfMarks", () => ({ markChatFetch: vi.fn() }));
vi.mock("@/lib/messageCache", () => ({ getCachedMessages: vi.fn(), cacheMessages: vi.fn() }));

import { mapLiveGroupRows } from "./useGroupMessagesQuery";

describe("mapLiveGroupRows image attachments", () => {
  it("maps a canister image URL into the message visible to group members", async () => {
    const profile = { display_name: "Alex", avatar_url: null };
    fetchProfilesWithCache.mockResolvedValue(new Map([[
      "principal-1",
      profile,
    ]]));
    listLiveReactions.mockResolvedValue([]);

    const messages = await mapLiveGroupRows({ identity: {}, target: {} }, "group-1", [{
      id: "message-1",
      body: "Match photo",
      sender: { toText: () => "principal-1" },
      sequence: 1n,
      created_at_ms: 1_700_000_000_000n,
      edited_at_ms: [],
      conversation_id: "group-1",
      reply_to_id: [],
      attachment: [{
        kind: "image",
        ref_id: "clubs/club-1/teams/team-1/chat/photo.jpg",
        url: ["https://blob.example/photo.jpg"],
      }],
    }]);

    expect(messages[0]).toEqual(expect.objectContaining({
      id: "message-1",
      image_url: "https://blob.example/photo.jpg",
      author: profile,
    }));
  });
});