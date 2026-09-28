/**
 * Tests for edge-cases and known risks in the message jump / scroll system.
 *
 * Risks covered:
 *  1. Duplicate message IDs → findIndex picks the first occurrence (may be wrong clone).
 *  2. BasicChatMessageList kill-switch path: scrollToIndex is a no-op when the
 *     target row falls outside the rendered window (index ≥ chunk).
 *  3. Parent fallback activates at the halfway mark and highlights a DIFFERENT
 *     message (same thread, not the real target) — it must not clear once the
 *     real target loads.
 *  4. Single-slot sessionStorage in consumePendingChatJump: a second write
 *     overwrites the first; kind/targetId mismatch returns null.
 *  5. related_id ambiguity: pickMessageId prefers explicit message_id fields
 *     over related_id so an old DM notification doesn't jump to the conversation id.
 *  6. Polling exhausts without target → hydration overlay is released (no stuck skeleton).
 *  7. tryLoadOlder is NOT called if hasOlderMessages is false (pages don't hammer backend).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jumpToMessageInVirtualizedChat } from "./jumpToMessage";
import {
  setPendingChatJump,
  consumePendingChatJump,
  getLastConsumedPendingChatJumpTs,
  normalizeNotificationChatUrl,
} from "./pendingChatJump";
import { resolveChatJumpTarget } from "./resolveChatJumpTarget";

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------
type Msg = { id: string };

const makeHandle = () => ({
  scrollToIndex: vi.fn(),
  scrollToBottom: vi.fn(),
  isAtBottom: vi.fn(() => false),
  isNearBottom: vi.fn(() => false),
});

// ---------------------------------------------------------------------------

describe("Risk 1 – duplicate message IDs in the messages array", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("scrolls to the FIRST occurrence when the id appears more than once", async () => {
    // Simulates a race where a realtime append duplicates an already-cached row.
    const messages: Msg[] = [
      { id: "a" },
      { id: "target" }, // index 1 – first (correct cache entry)
      { id: "b" },
      { id: "target" }, // index 3 – duplicate from realtime append
    ];
    const handle = makeHandle();

    jumpToMessageInVirtualizedChat(
      "target",
      () => messages,
      () => handle as any,
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(60);

    // findIndex returns 1 (first match); this is the documented behaviour —
    // callers must deduplicate the messages array to avoid landing on a clone.
    expect(handle.scrollToIndex).toHaveBeenCalledWith(1, "end");
    // Guard: must NOT have scrolled to index 3.
    const calls = handle.scrollToIndex.mock.calls.filter((c) => c[0] === 3);
    expect(calls.length).toBe(0);
  });

  it("highlights only the first occurrence, never the duplicate", async () => {
    const messages: Msg[] = [{ id: "target" }, { id: "b" }, { id: "target" }];
    const handle = makeHandle();
    const setHighlight = vi.fn();

    jumpToMessageInVirtualizedChat("target", () => messages, () => handle as any, setHighlight);
    await vi.advanceTimersByTimeAsync(60);

    const highlightCalls = setHighlight.mock.calls.filter((c) => c[0] === "target");
    // Only one highlight call for the target (not one per occurrence).
    expect(highlightCalls.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------

describe("Risk 2 – BasicChatMessageList kill-switch path: out-of-window target", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("keeps polling and calls tryLoadOlder when the handle exists but target is absent", async () => {
    // Simulates the BasicChatMessageList scenario: handle exists (kill-switch active),
    // but the target message is NOT in the 100-row window.
    const handle = makeHandle();
    const tryLoadOlder = vi.fn();

    jumpToMessageInVirtualizedChat(
      "ancient-msg",
      () => [{ id: "recent" }], // target not here
      () => handle as any,
      vi.fn(),
      { maxAttempts: 30, intervalMs: 10, tryLoadOlder },
    );

    await vi.advanceTimersByTimeAsync(500);

    // scrollToIndex must NOT have been called with any index.
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
    // tryLoadOlder must have been called to attempt to page back.
    expect(tryLoadOlder).toHaveBeenCalled();
  });

  it("resolves correctly once the target appears after a load-older cycle", async () => {
    const handle = makeHandle();
    let messages: Msg[] = [{ id: "recent" }];
    const tryLoadOlder = vi.fn(() => {
      messages = [{ id: "ancient-msg" }, { id: "recent" }];
    });

    jumpToMessageInVirtualizedChat(
      "ancient-msg",
      () => messages,
      () => handle as any,
      vi.fn(),
      { maxAttempts: 40, intervalMs: 20, tryLoadOlder },
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(handle.scrollToIndex).toHaveBeenCalledWith(0, "end");
  });
});

// ---------------------------------------------------------------------------

describe("Risk 3 – parent fallback highlights the wrong message temporarily", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("parent fallback fires at half-way mark, then re-centres on real target", async () => {
    const handle = makeHandle();
    const setHighlight = vi.fn();
    let messages: Msg[] = [{ id: "parent-msg" }];

    jumpToMessageInVirtualizedChat(
      "reply-msg",
      () => messages,
      () => handle as any,
      setHighlight,
      { maxAttempts: 20, intervalMs: 10, parentMessageId: "parent-msg" },
    );

    // Half-way: ~100ms → parent fallback should have fired.
    await vi.advanceTimersByTimeAsync(200);
    expect(setHighlight).toHaveBeenCalledWith("parent-msg");

    // Real target arrives.
    messages = [{ id: "parent-msg" }, { id: "reply-msg" }];
    await vi.advanceTimersByTimeAsync(150);

    expect(setHighlight).toHaveBeenCalledWith("reply-msg");
    // After the real target is highlighted, "parent-msg" must NOT be
    // re-highlighted (no extra parent call after the real target resolved).
    const parentHighlightCallIndices = setHighlight.mock.calls
      .map((c, i) => ({ i, val: c[0] }))
      .filter((x) => x.val === "parent-msg")
      .map((x) => x.i);
    const replyHighlightCallIndices = setHighlight.mock.calls
      .map((c, i) => ({ i, val: c[0] }))
      .filter((x) => x.val === "reply-msg")
      .map((x) => x.i);
    // All parent highlights must come before the first real-target highlight.
    if (replyHighlightCallIndices.length > 0) {
      const firstReply = Math.min(...replyHighlightCallIndices);
      const lastParent = Math.max(...parentHighlightCallIndices);
      expect(lastParent).toBeLessThan(firstReply);
    }
  });

  it("does NOT jump to parent when parentMessageId is absent", async () => {
    const handle = makeHandle();
    const setHighlight = vi.fn();

    jumpToMessageInVirtualizedChat(
      "reply-msg",
      () => [{ id: "some-other-msg" }],
      () => handle as any,
      setHighlight,
      { maxAttempts: 20, intervalMs: 10 /* no parentMessageId */ },
    );

    await vi.advanceTimersByTimeAsync(300);

    // No highlight at all — target never loaded, no parent fallback.
    expect(setHighlight).not.toHaveBeenCalled();
    expect(handle.scrollToIndex).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------

describe("Risk 4 – single-slot sessionStorage in consumePendingChatJump", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("second setPendingChatJump overwrites the first (slot collision)", () => {
    setPendingChatJump("team", "team-1", "msg-aaa");
    setPendingChatJump("club", "club-1", "msg-bbb");

    // The team jump is gone.
    expect(consumePendingChatJump("team", "team-1")).toBeNull();
    // The club jump wins.
    expect(consumePendingChatJump("club", "club-1")).toBe("msg-bbb");
  });

  it("kind mismatch returns null without consuming the stored entry", () => {
    setPendingChatJump("group", "grp-1", "msg-ccc");
    expect(consumePendingChatJump("team", "grp-1")).toBeNull();
    // Entry is still there for the correct kind.
    expect(consumePendingChatJump("group", "grp-1")).toBe("msg-ccc");
  });

  it("targetId mismatch returns null", () => {
    setPendingChatJump("dm", "conv-A", "msg-ddd");
    expect(consumePendingChatJump("dm", "conv-B")).toBeNull();
    expect(consumePendingChatJump("dm", "conv-A")).toBe("msg-ddd");
  });

  it("broadcast (null targetId) is matched correctly", () => {
    setPendingChatJump("broadcast", null, "msg-eee");
    expect(consumePendingChatJump("broadcast", null)).toBe("msg-eee");
  });

  it("keeps the consumed timestamp so fallback can beat stale URL params", () => {
    setPendingChatJump("group", "grp-1", "new-msg");
    expect(consumePendingChatJump("group", "grp-1")).toBe("new-msg");

    const fallbackJumpTs = getLastConsumedPendingChatJumpTs("new-msg");
    expect(typeof fallbackJumpTs).toBe("number");

    const resolved = resolveChatJumpTarget({
      urlMessageId: "old-msg",
      urlJumpNonce: String((fallbackJumpTs ?? 0) - 5_000),
      liveJumpId: null,
      liveJumpTs: undefined,
      fallbackJumpId: "new-msg",
      fallbackJumpTs,
    });
    expect(resolved.messageId).toBe("new-msg");
  });

  it("expired entry (> 60s) returns null", () => {
    setPendingChatJump("team", "team-1", "msg-fff");
    // Manually corrupt the timestamp to be 61s ago.
    const raw = JSON.parse(sessionStorage.getItem("ignite_pending_chat_jump_v1")!);
    raw.ts = Date.now() - 61_000;
    sessionStorage.setItem("ignite_pending_chat_jump_v1", JSON.stringify(raw));
    expect(consumePendingChatJump("team", "team-1")).toBeNull();
  });
});

// ---------------------------------------------------------------------------

describe("Risk 5 – related_id ambiguity in pickMessageId / normalizeNotificationChatUrl", () => {
  it("prefers explicit message_id over related_id", () => {
    const url = normalizeNotificationChatUrl(
      { message_id: "real-msg-id", related_id: "conversation-id" },
      "/messages/team-abc",
    );
    expect(url).toContain("message=real-msg-id");
    expect(url).not.toContain("message=conversation-id");
  });

  it("prefers messageId (camelCase) over related_id", () => {
    const url = normalizeNotificationChatUrl(
      { messageId: "camel-msg-id", related_id: "conv-id" },
      "/messages/team-abc",
    );
    expect(url).toContain("message=camel-msg-id");
  });

  it("falls back to related_id only when no explicit message field is present", () => {
    const url = normalizeNotificationChatUrl(
      { related_id: "fallback-id", team_id: "team-abc" },
      "/messages/team-abc",
    );
    // related_id is the last-resort; it ends up in the ?message= param.
    expect(url).toContain("message=fallback-id");
  });
});

// ---------------------------------------------------------------------------

describe("Risk 6 – polling exhausts without target: hydration overlay released", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("dispatches chat:jump-hydration-end after maxAttempts with no target", async () => {
    const endEvents: Event[] = [];
    const listener = (e: Event) => endEvents.push(e);
    window.addEventListener("chat:jump-hydration-end", listener);

    jumpToMessageInVirtualizedChat(
      "ghost-msg",
      () => [],
      () => makeHandle() as any,
      vi.fn(),
      { maxAttempts: 5, intervalMs: 10 },
    );

    await vi.advanceTimersByTimeAsync(500);
    window.removeEventListener("chat:jump-hydration-end", listener);

    expect(endEvents.length).toBeGreaterThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------

describe("Risk 7 – tryLoadOlder throttle: not called before attempt > 6", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

  it("does not call tryLoadOlder on the very first few ticks", async () => {
    const tryLoadOlder = vi.fn();

    jumpToMessageInVirtualizedChat(
      "missing",
      () => [],
      () => makeHandle() as any,
      vi.fn(),
      { maxAttempts: 20, intervalMs: 10, tryLoadOlder },
    );

    // Only advance 5 ticks (< 6 threshold).
    await vi.advanceTimersByTimeAsync(55); // 50ms initial delay + ~0 ticks

    expect(tryLoadOlder).not.toHaveBeenCalled();

    // Past the threshold now.
    await vi.advanceTimersByTimeAsync(150);
    expect(tryLoadOlder).toHaveBeenCalled();
  });
});
