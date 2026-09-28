import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Guard: every chat surface persists BOTH the composer text and the reply
 * target, keyed by that chat's stable id. Losing either silently discards a
 * user's unsent message when they navigate away mid-reply.
 */
const SURFACES: Array<{ file: string; draftKey: string }> = [
  { file: "TeamChatPage.tsx", draftKey: "teamId" },
  { file: "ClubChatPage.tsx", draftKey: "clubId" },
  { file: "GroupChatPage.tsx", draftKey: "groupId" },
  { file: "DirectMessagePage.tsx", draftKey: "conversationId" },
  { file: "ClubAdminChatPage.tsx", draftKey: "conversationId" },
  { file: "BroadcastChatPage.tsx", draftKey: '"broadcast"' },
];

const pagesDir = join(__dirname, "..", "pages");
const read = (f: string) => readFileSync(join(pagesDir, f), "utf8");

function composerCallWindow(source: string) {
  const start = source.lastIndexOf("useChatComposerController");
  expect(start).toBeGreaterThanOrEqual(0);
  return source.slice(start, start + 500);
}

describe("chat draft persistence per surface", () => {
  for (const { file, draftKey } of SURFACES) {
    describe(file, () => {
      const src = read(file);

      it("persists composer text with the chat's stable id", () => {
        expect(src).toContain(`useChatDraft(${draftKey})`);
      });

      it("persists the reply target with the same id", () => {
        expect(src).toMatch(
          new RegExp(`useChatDraftReply<[^>]+>\\(${draftKey.replace(/"/g, '"')}\\)`),
        );
      });

      it("does not keep the reply target in ephemeral useState", () => {
        expect(src).not.toMatch(/const \[reply(ingTo|To)?, setReply(ingTo|To)?\] = useState/);
      });
    });
  }

  it("hook exposes both text and reply draft APIs", () => {
    const hook = readFileSync(join(__dirname, "..", "hooks", "useChatDraft.ts"), "utf8");
    expect(hook).toMatch(/export function useChatDraft\(/);
    expect(hook).toMatch(/export function useChatDraftReply</);
    expect(hook).toContain("chat_draft_reply_");
  });

  it("the shared composer controller persists reply identity instead of using ephemeral state", () => {
    const controller = readFileSync(join(__dirname, "..", "hooks", "useChatComposerController.ts"), "utf8");
    expect(controller).toContain("useChatDraft(draftId)");
    expect(controller).toContain("useChatDraftReply<TReply>(draftId)");
    expect(controller).not.toMatch(/useState<TReply \| null>/);
  });
});
