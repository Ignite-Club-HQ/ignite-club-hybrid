import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const surfaces = [
  ["TeamChatPage.tsx", "team_messages", "TEAM_CHAT_SCOPE"],
  ["ClubChatPage.tsx", "club_messages", "CLUB_CHAT_SCOPE"],
  ["GroupChatPage.tsx", "group_messages", "GROUP_CHAT_SCOPE"],
  ["DirectMessagePage.tsx", "direct_messages", "DIRECT_CHAT_SCOPE"],
  ["BroadcastChatPage.tsx", "broadcast_messages", "BROADCAST_CHAT_SCOPE"],
  ["ClubAdminChatPage.tsx", "club_admin_messages", "CLUB_ADMIN_CHAT_SCOPE"],
] as const;
const page = (name: string) => readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");
const threadModule = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/features/messaging/thread", name), "utf8");
const pageWithExtractedThreadLogic = (name: string) => {
  if (name !== "GroupChatPage.tsx") return page(name);
  return [
    page(name),
    threadModule("useGroupMessagesQuery.ts"),
    threadModule("useGroupOlderMessagesLoader.ts"),
    threadModule("useGroupRealtimeUpdates.ts"),
    threadModule("useGroupTargetWindowHydration.ts"),
  ].join("\n");
};
const historyFetcher = () =>
  readFileSync(
    resolve(process.cwd(), "src/features/messaging/thread/chatHistorySearchFetcher.ts"),
    "utf8",
  );

describe("six-surface messaging refactor contracts", () => {
  for (const [name, table, scope] of surfaces) {
    it(`${name} retains fetch, soft-delete filtering and stable chronological ordering`, () => {
      const text = pageWithExtractedThreadLogic(name);
      expect(text).toContain(`from("${table}")`);
      expect(text).toContain('.is("deleted_at", null)');
      expect(text).toContain('.order("created_at"');
    });

    it(`${name} retains optimistic send, offline queueing and draft clearing`, () => {
      const text = page(name);
      expect(text).toContain("queueMessage(");
      expect(text).toMatch(/temp-|optimisticMessage/);
      expect(text).toContain("clearDraft");
      expect(text).toContain("reply_to_id");
      expect(text).toContain("useChatDraft");
    });

    it(`${name} reconciles Realtime insert, update and delete before subscribing`, () => {
      const text = pageWithExtractedThreadLogic(name);
      for (const event of ["INSERT", "UPDATE", "DELETE"]) expect(text).toContain(`event: "${event}"`);
      expect(text).toContain(`table: "${table}"`);
      // The subscribe/registry/cleanup lifecycle itself is shared across all
      // six routes via `startChatRealtimeChannel`; each route still finishes
      // registering every `.on(...)` handler on its own channel before
      // handing it to that shared lifecycle.
      expect(text).toContain("startChatRealtimeChannel(");
      expect(text.indexOf(`table: "${table}"`)).toBeLessThan(text.indexOf("startChatRealtimeChannel("));
    });

    it(`${name} reconciles all reaction lifecycle events`, () => {
      const text = pageWithExtractedThreadLogic(name);
      expect((text.match(/table: "message_reactions"/g) || []).length).toBeGreaterThanOrEqual(3);
      expect(text).toMatch(/temp-.*reaction|reaction.*temp-/s);
    });

    it(`${name} keeps remote history search, abort support and exact-message jumping`, () => {
      const text = page(name);
      expect(text).toContain("createChatHistorySearchFetcher");
      expect(text).toContain(`scope: ${scope}`);
      expect(text).toContain("signal");
      expect(text).toContain("jumpToMessageInVirtualizedChat");
      expect(text).toContain("tryLoadOlder");
    });

    it("uses one typed history-search orchestrator for scope filters and table selection", () => {
      const text = historyFetcher();
      expect(text).toContain("buildChatScopeFilter");
      expect(text).toContain("scope.messageTable");
      expect(text).toContain("searchChatHistory({");
      expect(text).toContain("signal");
    });

    it(`${name} isolates its query cache scope`, () => {
      const text = page(name);
      expect(text).toContain("queryClient.setQueryData");
    });

    it(`${name} preserves composer, mentions, replies, edit state and keyboard locking`, () => {
      const text = page(name);
      expect(text).toContain("MentionInput");
      expect(text).toMatch(/replyingTo|replyTo/);
      expect(text).toContain("editingMessage");
      expect(text).toContain("<ChatMessagesScroller");
      expect(text).toContain("onTouchStart={swipeBack.onTouchStart}");
      expect(text).toContain("onTouchEnd={swipeBack.onTouchEnd}");
      expect(text).toContain("scrollToBottom");
    });
  }

  it("keeps shared header search composition on the five standard chat surfaces", () => {
    for (const name of [
      "TeamChatPage.tsx",
      "ClubChatPage.tsx",
      "GroupChatPage.tsx",
      "DirectMessagePage.tsx",
      "BroadcastChatPage.tsx",
    ]) {
      const text = page(name);
      expect(text).toContain("<ChatHeaderShell");
      expect(text).toContain("<ChatSearchBar");
    }

    const clubAdmin = page("ClubAdminChatPage.tsx");
    expect(clubAdmin).not.toContain("<ChatHeaderShell");
    expect(clubAdmin).toContain("<ChatSearchBar");
  });

  it("preserves Group Chat's distinct top-level reaction merge", () => {
    const text = page("GroupChatPage.tsx");
    expect(text).toContain("top-level reactions");
    expect(text).toContain("reactionsByMessage");
  });

  it("preserves Team Chat announcement and system-message fields", () => {
    const text = page("TeamChatPage.tsx");
    expect(text).toContain("is_club_announcement");
    expect(text).toContain("club_announcement_name");
    expect(text).toContain("is_system_message");
  });

  it("preserves Group forwarding policy", () => {
    expect(page("GroupChatPage.tsx")).toContain("allow_forwarding");
  });

  it("preserves DM support-conversation restrictions", () => {
    expect(page("DirectMessagePage.tsx")).toContain("isIgniteSupportConversation");
  });

  it("preserves app-admin authorization for Broadcast sending", () => {
    const text = page("BroadcastChatPage.tsx");
    expect(text).toContain("useIsAppAdmin");
    expect(text).toContain("const { isAppAdmin } = useIsAppAdmin()");
  });
});
