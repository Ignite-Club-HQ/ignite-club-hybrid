import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// Paul's report (26 Oct 2026): opening a chat thread showed skeleton bars where
// the header name belongs, for as long as the thread's own metadata read took.
// The inbox already knows every thread's name, so each thread page must paint a
// remembered label while its read is running — and that copy must stay private,
// bounded, and gone on sign-out.
const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", `${name}.tsx`), "utf8");

const LIB = (name: string) => readFileSync(resolve(process.cwd(), "src/lib", name), "utf8");

describe("chat thread headers name themselves while loading", () => {
  const threadPages = [
    "DirectMessagePage",
    "GroupChatPage",
    "ClubAdminChatPage",
    "TeamChatPage",
    "ClubChatPage",
    "BroadcastChatPage",
  ];

  threadPages.forEach((name) => {
    it(`${name} never renders an unnamed chat skeleton`, () => {
      const source = page(name);
      expect(source).toContain("ChatPageSkeleton");
      expect(source).not.toMatch(/<ChatPageSkeleton\s*\/>/);
    });
  });

  it("every unnamed-thread skeleton still hands the header a title expression", () => {
    ["DirectMessagePage", "GroupChatPage", "ClubAdminChatPage"].forEach((name) => {
      const source = page(name);
      expect(source).toMatch(/<ChatPageSkeleton[\s\S]{0,220}title=\{/);
    });
  });

  it("the inbox records the names it is showing", () => {
    const source = page("MessagesPage");
    expect(source).toContain('rememberChatThreadLabels(user?.id, unifiedConversations)');
  });

  it("a resolved thread re-records its own authoritative name", () => {
    expect(page("DirectMessagePage")).toContain('rememberChatThreadLabel(user.id, "dm"');
    expect(page("GroupChatPage")).toContain('rememberChatThreadLabel(user.id, "group"');
    expect(page("ClubAdminChatPage")).toContain('rememberChatThreadLabel(user.id, "admin_group"');
  });
});

describe("chat thread labels stay private and bounded", () => {
  it("counts against the disposable device read-cache budget", () => {
    expect(LIB("deviceCacheBudget.ts")).toContain("'ignite_chat_thread_labels_v1'");
  });

  it("is wiped with every other account-scoped copy on sign-out", () => {
    const sweep = LIB("clearUserScopedCaches.ts");
    expect(sweep).toContain("clearChatThreadLabelCache");
    expect(sweep).toMatch(/runSafe\(clearChatThreadLabelCache\)/);
  });

  it("never persists message text, only display labels", () => {
    const cache = LIB("chatThreadLabelCache.ts");
    // The stored shape is a title/subtitle/avatar triple and nothing else.
    expect(cache).toContain("interface StoredChatThreadLabel extends ChatThreadLabel");
    expect(cache).not.toMatch(/lastMessage|messageText|last_text/);
  });
});
