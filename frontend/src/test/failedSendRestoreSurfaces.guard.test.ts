import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard test: every chat surface must implement the shared failed-send
 * recovery contract. Regressions here silently lose a user's unsent message
 * (or discard a concurrent optimistic send), which is invisible in typecheck
 * and hard to reproduce manually.
 */
const SURFACES = [
  "TeamChatPage.tsx",
  "ClubChatPage.tsx",
  "GroupChatPage.tsx",
  "DirectMessagePage.tsx",
  "ClubAdminChatPage.tsx",
  "BroadcastChatPage.tsx",
];

const pagesDir = join(__dirname, "..", "pages");
const read = (f: string) => readFileSync(join(pagesDir, f), "utf8");
const composerController = readFileSync(
  join(__dirname, "..", "hooks", "useChatComposerController.ts"),
  "utf8",
);

describe("failed-send recovery contract per chat surface", () => {
  for (const file of SURFACES) {
    describe(file, () => {
      const src = read(file);

      it("uses a collision-resistant, mutation-specific temp id", () => {
        expect(src).toMatch(/createSendTempId\(\)/);
        expect(src).not.toMatch(/id:\s*`temp-\$\{Date\.now\(\)\}`/);
      });

      it("captures sentAtMs and the failed-send context in onMutate", () => {
        expect(src).toMatch(/const sentAtMs = Date\.now\(\)/);
        expect(src).toMatch(/satisfies FailedSendContext/);
      });

      it("checks for an authoritative row before treating the send as failed", () => {
        expect(src).toMatch(/authoritativeMessageExists\(/);
        expect(src).toMatch(/sentAtMs: context\?\.sentAtMs/);
      });

      it("removes only that mutation's optimistic row", () => {
        expect(src).toMatch(/m\.id !== (context\.tempId|tempId)\b/);
      });

      it("restores composer state through the shared conditional helper", () => {
        expect(src).toMatch(/restoreFailedSendComposer\(\{/);
      });

      it("does not roll back a whole query-cache snapshot on send failure", () => {
        // Reaction/delete mutations may snapshot; the SEND mutation must not.
        const start = src.indexOf("satisfies FailedSendContext");
        const end = src.indexOf("\n  });", start);
        const sendError = src.slice(start, end === -1 ? src.length : end);
        expect(sendError).not.toMatch(/context\.previousMessages/);
        expect(sendError).not.toMatch(/previousData\b/);
      });

      it("keeps the offline-queue exception ahead of failure handling", () => {
        expect(src).toMatch(/navigator\.onLine === false|isOffline|navigator\.onLine\b/);
      });

      it("does not blanket-drop every optimistic row when a real row lands", () => {
        expect(src).not.toMatch(/filter\(\s*\(m\w*\)\s*=>\s*!m\w*\.id\.startsWith\("temp-"\)\s*\)\s*\n?\s*\.concat/);
        expect(src).not.toMatch(
          /startsWith\('temp-'\)\s*&&\s*m\.author_id === newMsg\.author_id\s*\)?\s*\)?;/,
        );
      });
    });
  }

  it("surfaces that support polls restore the pending poll", () => {
    for (const file of ["TeamChatPage.tsx", "GroupChatPage.tsx", "ClubAdminChatPage.tsx", "BroadcastChatPage.tsx"]) {
      const src = read(file);
      expect(src).toMatch(/splitPollMarkup\(/);
      expect(src).toMatch(/setPoll:\s*setPendingPollId/);
    }
  });

  it("the shared composer controller conditionally restores every failed-send field", () => {
    expect(composerController).toMatch(/restoreFailedSendComposer\(\{/);
    expect(composerController).toMatch(/setText,/);
    expect(composerController).toMatch(/setImage:\s*setImageUrl/);
    expect(composerController).toMatch(/setReply:\s*setReplyingTo/);
    expect(composerController).toMatch(/setPoll:\s*setPendingPollId/);
  });
});
