import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const pageSource = (page: string) =>
  readFileSync(join(__dirname, "..", "pages", page), "utf8");

describe("chat read orchestration contracts", () => {
  it.each([
    "TeamChatPage.tsx",
    "ClubChatPage.tsx",
    "GroupChatPage.tsx",
    "BroadcastChatPage.tsx",
  ])("%s retains deduplicated temporary-message filtering", (page) => {
    const source = pageSource(page);
    expect(source).toContain("useMarkVisibleChatMessagesRead({");
    expect(source).toMatch(/messages: filteredMessages,[\s\S]*markMessagesAsRead,/);
    expect(source).not.toMatch(/deduplicate: false/);
  });

  it("Club Admin retains its queued-message exclusion", () => {
    const source = pageSource("ClubAdminChatPage.tsx");
    expect(source).toMatch(
      /useMarkVisibleChatMessagesRead\(\{[\s\S]*excludedIdPrefixes: CHAT_READ_EXCLUDED_WITH_QUEUED_ID_PREFIXES/,
    );
  });

  it("Direct Messages retain non-deduplicated marking for their local message cache", () => {
    const source = pageSource("DirectMessagePage.tsx");
    expect(source).toMatch(
      /useMarkVisibleChatMessagesRead\(\{[\s\S]*messages: localMessages,[\s\S]*deduplicate: false,/,
    );
  });
});
