import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard test: chat surfaces must rely on Virtuoso's imperative
 * `virtualHandleRef.scrollToIndex` for jump-to-message. Re-introducing a
 * `document.getElementById('message-${id}')` fallback would silently break
 * search/deep-link/pinned/reply-quote jumps for off-screen rows (Virtuoso
 * does not render them into the DOM).
 */
describe("chat jump-to-message DOM-fallback guard", () => {
  const pagesDir = join(__dirname, "..", "pages");
  const chatPages = [
    "TeamChatPage.tsx",
    "GroupChatPage.tsx",
    "ClubChatPage.tsx",
    "ClubAdminChatPage.tsx",
    "BroadcastChatPage.tsx",
    "DirectMessagePage.tsx",
  ];

  it("lists exist on disk", () => {
    const present = readdirSync(pagesDir);
    for (const f of chatPages) expect(present).toContain(f);
  });

  for (const file of chatPages) {
    it(`${file} does not use getElementById('message-...') as a jump fallback`, () => {
      const src = readFileSync(join(pagesDir, file), "utf8");
      // Match getElementById(`message-...`) or getElementById('message-...') etc.
      expect(src).not.toMatch(/getElementById\(\s*[`'"]message-/);
    });

    it(`${file} routes jumps through jumpToMessageInVirtualizedChat`, () => {
      const src = readFileSync(join(pagesDir, file), "utf8");
      expect(src).toMatch(/jumpToMessageInVirtualizedChat/);
    });
  }

  it("the jump helper itself contains no getElementById call", () => {
    const src = readFileSync(
      join(__dirname, "..", "lib", "jumpToMessage.ts"),
      "utf8",
    );
    // Strip line + block comments so the doc-string mention doesn't trip us.
    const code = src
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/(^|[^:])\/\/.*$/gm, "$1");
    expect(code).not.toMatch(/getElementById\s*\(/);
  });
});
