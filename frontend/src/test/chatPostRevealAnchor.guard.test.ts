import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const list = [
  "src/components/chat/VirtualizedChatMessageList.tsx",
  "src/components/chat/useChatJumpAnchor.ts",
].map((path) => readFileSync(path, "utf8")).join("\n");

describe("chat post-reveal jump anchor (notification tap settle)", () => {
  it("arms the anchor in the content-gate reveal before unmasking", () => {
    expect(list).toContain("postJumpAnchorRef");
    expect(list).toContain("setJumpAnchorNonce");
    // The sticky user-scroll flag must reset so a repeat jump in an
    // already-open chat still gets its full anchor window.
    expect(list).toContain("userHasScrolledAfterPinRef.current = false;");
  });

  it("keeps the jump target glued with the same exact-DOM alignment", () => {
    expect(list).toContain("const ANCHOR_WINDOW_MS = 6000");
    expect(list).toContain('alignMessageIdInViewRef.current?.(anchor.id, "end")');
  });

  it("never fights the user once they scroll after the reveal", () => {
    const anchorSection = list.slice(list.indexOf("POST-REVEAL JUMP ANCHOR"));
    expect(anchorSection).toContain("isViewportUserActive(viewport)");
    expect(anchorSection).toContain("userHasScrolledAfterPinRef.current");
    // Geometry-signature gate: mutation noise without movement must not
    // even run the DOM measurement.
    expect(anchorSection).toContain("if (signature === lastSignature) return;");
  });

  it("does not extend the skeleton wait (blank-chat regression guard)", () => {
    // The reveal budget stays short; post-reveal movement is absorbed by the
    // anchor instead of a longer mask (which caused multi-second blank chats).
    expect(list).toContain("const JUMP_REVEAL_FAILSAFE_MS = 4000");
    expect(list).toContain("quietMs: 240");
  });
});
