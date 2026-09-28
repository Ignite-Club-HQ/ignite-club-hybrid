import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  extractChatQueryMessages,
} from "../src/features/messaging/thread/chatThreadQueryData";
import {
  mergeOlderChatMessagesChronologically,
  orderChatMessagesChronologically,
  prependStrictlyOlderChatMessages,
} from "../src/features/messaging/thread/chatMessageOrdering";
import {
  mergeCachedChatMessagesChronologically,
  selectHistoryChatPlaceholderSource,
} from "../src/features/messaging/thread/chatThreadCacheHydration";
import {
  CHAT_SCOPE_ADAPTERS,
  buildChatScopeFilter,
  getChatScopeAdapterByTable,
} from "../src/features/messaging/scopes/chatScopeAdapters";
import {
  cacheMessages,
  clearMessageCache,
  getCachedMessages,
  shouldRefetchMessages,
  type CachedMessage,
} from "../src/lib/messageCache";
import {
  cacheMessagesPageData,
  clearMessagesPageCache,
  getCachedMessagesPageData,
} from "../src/lib/messagesPageCache";
import {
  prepareChatComposerSubmission,
  resetChatComposerAfterSend,
} from "../src/lib/chatComposerSubmission";
import {
  _resetReactionReconciliationRegistry,
  recordRealtimeReaction,
  reconcileReactions,
} from "../src/lib/chatReactionReconciliation";

const message = (id: string, created_at: string, text = id): CachedMessage => ({
  id,
  text,
  author_id: "author",
  created_at,
  image_url: null,
  reply_to_id: null,
  profiles: { display_name: "Author", avatar_url: null },
});

beforeEach(() => {
  localStorage.clear();
  clearMessagesPageCache();
  clearMessageCache("team", "library-test");
  _resetReactionReconciliationRegistry();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("frontend/src/lib characterization candidates", () => {
  it("chatComposerSubmission flushes IME before retry and resets all owned fields", () => {
    vi.useFakeTimers();
    const input = document.createElement("textarea");
    document.body.append(input);
    input.focus();
    const retry = vi.fn();
    expect(prepareChatComposerSubmission(false, retry)).toBe(true);
    expect(document.activeElement).not.toBe(input);
    vi.runAllTimers();
    expect(retry).toHaveBeenCalledWith(true);
    expect(document.activeElement).toBe(input);

    const values = { text: "draft", image: {}, reply: {}, poll: {} };
    resetChatComposerAfterSend({
      setText: (value) => { values.text = value; },
      setImage: (value) => { values.image = value; },
      setReply: (value) => { values.reply = value; },
      setPoll: (value) => { values.poll = value; },
    });
    expect(values).toEqual({ text: "", image: null, reply: null, poll: null });
  });

  it("messageCache keeps the newest 100 rows, replaces optimistic ids, and isolates scopes", () => {
    const rows = Array.from({ length: 101 }, (_, index) =>
      message(`m${index}`, `2026-09-17T${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}:00.000Z`),
    );
    cacheMessages("team", "library-test", rows);
    expect(getCachedMessages("team", "library-test")).toHaveLength(100);
    expect(getCachedMessages("team", "library-test")[0].id).toBe("m1");
    expect(shouldRefetchMessages("team", "library-test", 0)).toBe(true);
    expect(getCachedMessages("club", "library-test")).toEqual([]);
  });

  it("messagesPageCache keeps partial sections user-scoped and clears on sign-out", () => {
    const team = {
      id: "team-1",
      name: "Blue",
      logo_url: null,
      clubs: { name: "Club", logo_url: null, sport: "football" },
    };
    cacheMessagesPageData("user-a", { teams: [team] });
    cacheMessagesPageData("user-a", {
      latestTeamMessages: {
        "team-1": { text: "hello", author: "u1", created_at: "2026-09-17T10:00:00Z" },
      },
    });
    expect(getCachedMessagesPageData("user-a")).toEqual(expect.objectContaining({
      teams: [team],
      latestTeamMessages: expect.objectContaining({ "team-1": expect.anything() }),
    }));
    expect(getCachedMessagesPageData("user-b")).toBeNull();
    clearMessagesPageCache();
    expect(getCachedMessagesPageData("user-a")).toBeNull();
  });

  it("reaction reconciliation is the fourth local library assertion: stale fetches cannot erase realtime state", () => {
    recordRealtimeReaction("team:library-test", "m1", {
      id: "r1",
      user_id: "u1",
      reaction_type: "like",
    });
    const stale = [{ id: "m1", reactions: [] as Array<{ id: string; user_id: string; reaction_type: string }> }];
    expect(reconcileReactions("team:library-test", stale)?.[0].reactions).toEqual([{
      id: "r1",
      user_id: "u1",
      reaction_type: "like",
    }]);
  });
});

describe("messaging thread and scope candidates", () => {
  it("keeps query envelopes untouched while ordering and merging older pages immutably", () => {
    const current = [{ id: "new", created_at: "2026-09-17T10:00:00Z" }];
    const older = [{ id: "old", created_at: "2026-09-17T09:00:00Z" }];
    expect(extractChatQueryMessages(current)).toBe(current);
    expect(extractChatQueryMessages({ messages: current })).toBe(current);
    expect(orderChatMessagesChronologically([...current, ...older]).map(({ id }) => id)).toEqual(["old", "new"]);
    expect(mergeOlderChatMessagesChronologically(older, current).map(({ id }) => id)).toEqual(["old", "new"]);
    expect(prependStrictlyOlderChatMessages([{ id: "old" }], [{ id: "new" }]).map(({ id }) => id)).toEqual(["old", "new"]);
  });

  it("preserves chat cache hydration placeholder precedence", () => {
    expect(mergeCachedChatMessagesChronologically(
      [{ id: "current", created_at: "2026-09-17T10:00:00Z" }],
      [{ id: "older", created_at: "2026-09-17T09:00:00Z" }],
    ).map(({ id }) => id)).toEqual(["older", "current"]);
    expect(selectHistoryChatPlaceholderSource({
      hasPrevious: true,
      cachedMessageCount: 1,
      openedFromNotification: true,
    })).toBe("previous");
    expect(selectHistoryChatPlaceholderSource({
      hasPrevious: false,
      cachedMessageCount: 2,
      openedFromNotification: false,
    })).toBe("cache");
  });

  it("keeps every supported scope's table, filter, route, authorization, and reaction key explicit", () => {
    const adapters = Object.values(CHAT_SCOPE_ADAPTERS);
    expect(adapters).toHaveLength(6);
    for (const adapter of adapters) {
      expect(getChatScopeAdapterByTable(adapter.messageTable)).toBe(adapter);
      expect(adapter.route(adapter.scopeColumn ? "scope-1" : undefined)).toMatch(/^\/(messages|groups)/);
      expect(buildChatScopeFilter(adapter, adapter.scopeColumn ? "scope-1" : undefined)).toEqual(
        adapter.scopeColumn ? { [adapter.scopeColumn]: "scope-1" } : {},
      );
      expect(adapter.reactionForeignKey).toContain("message_id");
      expect(["team_membership", "club_membership", "group_membership", "conversation_participant", "authenticated", "app_admin"])
        .toContain(adapter.readBoundary);
    }
    expect(() => CHAT_SCOPE_ADAPTERS.team.route()).toThrow("requires a scope id");
    expect(CHAT_SCOPE_ADAPTERS.broadcast.route()).toBe("/messages/broadcast");
  });
});
