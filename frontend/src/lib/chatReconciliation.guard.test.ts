import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard test: every chat surface must route realtime edits/soft-deletes
 * through `@/lib/chatMessageReconciliation`. Hand-rolled
 * `messages.filter(m => m.id !== ...)` / `messages.map(m => ... text ...)`
 * handlers that only touch the React Query cache re-introduce the defect
 * where an edit reverts or a deleted row stays visible (the rendered
 * `localMessages` merge is fail-open and re-adds rows missing from the
 * incoming snapshot).
 */
describe("chat realtime reconciliation guard", () => {
  const pagesDir = join(__dirname, "..", "pages");
  const threadDir = join(__dirname, "..", "features", "messaging", "thread");
  const chatPages = [
    "TeamChatPage.tsx",
    "GroupChatPage.tsx",
    "ClubChatPage.tsx",
    "ClubAdminChatPage.tsx",
    "BroadcastChatPage.tsx",
    "DirectMessagePage.tsx",
  ];
  const sourceForChatPage = (file: string) => {
    const pageSource = readFileSync(join(pagesDir, file), "utf8");
    if (file !== "GroupChatPage.tsx") return pageSource;
    return [
      pageSource,
      readFileSync(join(threadDir, "useGroupMessagesQuery.ts"), "utf8"),
      readFileSync(join(threadDir, "useGroupLocalMessagesSync.ts"), "utf8"),
      readFileSync(join(threadDir, "useGroupOlderMessagesLoader.ts"), "utf8"),
      readFileSync(join(threadDir, "useGroupRealtimeUpdates.ts"), "utf8"),
      readFileSync(join(threadDir, "useGroupTargetWindowHydration.ts"), "utf8"),
    ].join("\n");
  };

  for (const file of chatPages) {
    const src = sourceForChatPage(file);

    it(`${file} imports the shared reconciliation helper`, () => {
      expect(src).toMatch(/from "@\/lib\/chatMessageReconciliation"/);
    });

    it(`${file} records realtime mutations in the registry`, () => {
      expect(src).toMatch(/recordRealtimeMutation\(/);
    });

    it(`${file} re-applies reconciliation to fetched message lists`, () => {
      expect(src).toMatch(/reconcileMessages\(/);
    });

    it(`${file} applies realtime edits/deletes to local render state too`, () => {
      // Cache-only handlers are the defect; both stores must be updated.
      expect(src).toMatch(/setLocalMessages\((?:\(prev\)|prev)/);
      expect(src).toMatch(/applyMessageUpdate\(/);
      expect(src).toMatch(/removeMessage\(/);
    });

    it(`${file} clears its reconciliation scope on thread switch/unmount`, () => {
      expect(src).toMatch(/clearReconciliationScope\(/);
    });
  }
});
