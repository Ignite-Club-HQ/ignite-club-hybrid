import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";

const list = readFileSync("src/components/chat/VirtualizedChatMessageList.tsx", "utf8");
const jump = readFileSync("src/lib/jumpToMessage.ts", "utf8");
const lifecycle = readFileSync("src/lib/chatJumpLifecycle.ts", "utf8");

describe("chat jump hydration reveal lifecycle", () => {
  it("measures the reveal budget once, from the original jump start", () => {
    expect(jump).toContain("beginChatJumpLifecycle(messageId)");
    expect(lifecycle).toContain("sameTargetStillRunning");
    expect(list).toContain("chatJumpLifecycleRemaining(");
  });

  it("uses one target-gated reveal wait instead of two chained settle waits", () => {
    expect(list).toContain("waitForChatJumpTargetReveal(");
    // The old design chained a 2.2s jump tail onto a fresh 6.5s settle wait
    // that was re-armed every 80ms while the jump was active.
    expect(list).not.toContain("Math.min(6500, remainingBudget())");
    expect(list).not.toContain("isChatJumpActive() && remainingBudget() > 120");
    expect(list).not.toContain("maxMs: Math.min(8000, budget)");
  });

  it("keeps duplicate start/end notifications idempotent", () => {
    expect(list).toContain("if (hydrating) return;");
    expect(list).toContain("if (cancelSettleWait) return;");
    expect(jump).toContain("if (hydrationEnded) return;");
    expect(lifecycle).toContain("if (current.ended) return");
  });

  it("retains a never-blank-forever backstop plus a short reveal fail-safe", () => {
    expect(list).toContain("const OVERLAY_HARD_DEADLINE_MS = 32000");
    expect(list).toContain("const OVERLAY_REVEAL_FAILSAFE_MS = 4000");
    expect(list).toContain("const JUMP_REVEAL_FAILSAFE_MS = 4000");
    expect(list).toContain("if (isChatJumpActive()) onStart();");
    expect(jump).toContain("const OVERLAY_RELEASE_MS = maxAttempts * intervalMs + 3000");
    expect(jump).toContain('new CustomEvent("chat:jump-hydration-end")');
  });

  it("performs one final exact-DOM alignment when the fail-safe fires", () => {
    expect(list).toContain("finalAlign:");
    expect(list).toContain('alignMessageIdInView(initialTargetMessageId, "end")');
  });

  it("keeps the skeleton masking and exact-target selection intact", () => {
    expect(list).toContain("{!initialRevealReady ? <JumpHydrationSkeleton /> : null}");
    expect(list).toContain("initialTargetMessageId && initialTargetIndex >= 0");
    expect(list).toContain("initialBottomPinned, initialTargetMessageId]");
  });
});
