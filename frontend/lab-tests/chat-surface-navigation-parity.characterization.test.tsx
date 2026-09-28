import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const surfaces = [
  "pages/TeamChatPage.tsx",
  "pages/ClubChatPage.tsx",
  "pages/GroupChatPage.tsx",
  "pages/DirectMessagePage.tsx",
  "pages/BroadcastChatPage.tsx",
  "pages/ClubAdminChatPage.tsx",
];
const source = (relative: string) =>
  readFileSync(resolve(process.cwd(), "src", relative), "utf8");

describe("chat-surface navigation parity", () => {
  for (const file of surfaces) {
    it(`${file} consumes both URL and persisted notification jumps`, () => {
      const text = source(file);
      expect(text).toContain("consumePendingChatJump");
      expect(text).toContain("subscribePendingChatJump");
      expect(text).toContain("getLastConsumedPendingChatJumpTs");
    });

    it(`${file} delegates exact positioning to the shared Virtuoso jump engine`, () => {
      const text = source(file);
      expect(text).toContain("jumpToMessageInVirtualizedChat");
      expect(text).toContain("virtualHandleRef");
    });

    it(`${file} keeps replies connected to their original message`, () => {
      const text = source(file);
      expect(text).toContain("reply_to_id");
      expect(text).toMatch(/onReply|handleReply/);
      expect(text).toContain("scrollToBottom");
    });
  }

  for (const file of [
    "pages/TeamChatPage.tsx",
    "pages/ClubChatPage.tsx",
    "pages/GroupChatPage.tsx",
    "pages/DirectMessagePage.tsx",
  ]) {
    it(`${file} retains pinned-message navigation`, () => {
      const text = source(file);
      expect(text).toContain("PinnedMessagesBanner");
      expect(text).toMatch(/onJumpToMessage=/);
    });
  }

  it("the notification bell resolves every message table before falling back", () => {
    const page = source("pages/NotificationsPage.tsx");
    const repository = source("lib/notificationChatRouting.ts");
    for (const table of [
      "team_messages",
      "club_messages",
      "group_messages",
      "direct_messages",
      "broadcast_messages",
      "club_admin_messages",
    ]) {
      expect(repository).toContain(`from("${table}")`);
    }
    expect(page).toContain("resolveChatTargetForMessageId");
    expect(page).toContain("resolveChatTargetResult");
    expect(page).toContain("resolveLegacyReactionTarget");
    expect(page).toContain("setPendingChatJump");
    expect(page).toContain("withChatJumpNonce");
  });
});
