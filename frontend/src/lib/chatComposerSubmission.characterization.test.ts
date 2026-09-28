import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const page = (name: string) =>
  readFileSync(resolve(process.cwd(), "src/pages", name), "utf8");

describe("chat composer submission preparation", () => {
  it.each([
    "TeamChatPage.tsx",
    "ClubChatPage.tsx",
    "GroupChatPage.tsx",
    "DirectMessagePage.tsx",
    "ClubAdminChatPage.tsx",
  ])("%s keeps focus stable without the legacy IME blur boundary", (name) => {
    const source = page(name);
    expect(source).toContain("keepComposerFocusedThroughSend(composerRef.current)");
    expect(source).not.toContain("prepareChatComposerSubmission");
    expect(source).not.toContain('ae.tagName === "TEXTAREA"');
  });

  it("leaves Broadcast's distinct non-IME send path explicit", () => {
    const source = page("BroadcastChatPage.tsx");
    expect(source).not.toContain("prepareChatComposerSubmission");
    expect(source).toContain('window.dispatchEvent(new Event("chat:message-sent"))');
  });
});
