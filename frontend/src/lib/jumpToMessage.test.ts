import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { jumpToMessageInVirtualizedChat } from "./jumpToMessage";

type Msg = { id: string };

const makeHandle = (scrollToMessageIdResult = false) => ({
  scrollToIndex: vi.fn((_idx: number, _align?: string) => {}),
  scrollToMessageId: vi.fn((_id: string, _align?: string) => scrollToMessageIdResult),
  scrollToBottom: vi.fn(),
});

describe("jumpToMessageInVirtualizedChat", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Spy on getElementById so we can assert it is NEVER consulted as a fallback.
    vi.spyOn(document, "getElementById");
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("drives Virtuoso via handle.scrollToIndex when the target is loaded", async () => {
    const messages: Msg[] = [{ id: "a" }, { id: "b" }, { id: "target" }, { id: "d" }];
    const handle = makeHandle();
    const setHighlight = vi.fn();

    jumpToMessageInVirtualizedChat(
      "target",
      () => messages,
      () => handle as any,
      setHighlight,
    );

    await vi.advanceTimersByTimeAsync(60);

    expect(handle.scrollToIndex).toHaveBeenCalledWith(2, "end");
    expect(setHighlight).toHaveBeenCalledWith("target");
    expect(document.getElementById).not.toHaveBeenCalled();
  });

  it("lands older targets at the bottom of the viewport above the composer", async () => {
    const messages: Msg[] = [{ id: "a" }, { id: "target" }, { id: "c" }, { id: "d" }, { id: "e" }];
    const handle = makeHandle();

    jumpToMessageInVirtualizedChat(
      "target",
      () => messages,
      () => handle as any,
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(60);

    expect(handle.scrollToIndex).toHaveBeenCalledWith(1, "end");

    for (const call of handle.scrollToIndex.mock.calls) {
      expect(call[0]).toBe(1);
    }
  });

  it("never falls back to document.getElementById even when the target is missing", async () => {
    const handle = makeHandle();
    jumpToMessageInVirtualizedChat(
      "missing",
      () => [{ id: "x" }],
      () => handle as any,
      vi.fn(),
      { maxAttempts: 5, intervalMs: 10 },
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(handle.scrollToIndex).not.toHaveBeenCalled();
    expect(document.getElementById).not.toHaveBeenCalled();
  });

  it("calls tryLoadOlder (throttled) when target is not yet in the loaded set", async () => {
    const tryLoadOlder = vi.fn();
    jumpToMessageInVirtualizedChat(
      "missing",
      () => [],
      () => makeHandle() as any,
      vi.fn(),
      { maxAttempts: 30, intervalMs: 10, tryLoadOlder },
    );

    await vi.advanceTimersByTimeAsync(1000);

    expect(tryLoadOlder).toHaveBeenCalled();
    // Throttle: must not fire on every tick.
    expect(tryLoadOlder.mock.calls.length).toBeLessThan(10);
    expect(document.getElementById).not.toHaveBeenCalled();
  });

  it("auto-cancels a previous in-flight jump on rapid re-invocation", async () => {
    const messages: Msg[] = [{ id: "a" }, { id: "b" }];
    const handle = makeHandle();
    const setHighlight = vi.fn();

    // First jump targets a not-yet-loaded id with a long polling window.
    jumpToMessageInVirtualizedChat(
      "missing",
      () => messages,
      () => handle as any,
      setHighlight,
      { maxAttempts: 40, intervalMs: 50 },
    );

    // Rapidly fire a second jump for a loaded id ("a", idx 0). If the first
    // jump were still alive it would never resolve to idx 0, but its polling
    // ticks would still fire — we assert the timers were cleared by checking
    // setHighlight is never called with the missing id and only idx 0 scrolls.
    jumpToMessageInVirtualizedChat(
      "a",
      () => messages,
      () => handle as any,
      setHighlight,
    );

    await vi.advanceTimersByTimeAsync(60);
    expect(handle.scrollToIndex).toHaveBeenCalledWith(0, "end");

    // Drain the second jump's settle (350ms) and highlight-clear (2500ms).
    await vi.advanceTimersByTimeAsync(3000);

    // Every scrollToIndex call must be for idx 0 — none for the cancelled jump.
    for (const call of handle.scrollToIndex.mock.calls) {
      expect(call[0]).toBe(0);
    }
    // Highlight is only ever set for "a"; the cancelled jump's polling
    // ticks never run a successful resolution.
    for (const call of setHighlight.mock.calls) {
      expect([null, "a"]).toContain(call[0]);
    }
    expect(document.getElementById).not.toHaveBeenCalled();
  });

  it("repeat notification taps never prime-scroll to the earlier row", async () => {
    const messages: Msg[] = [
      { id: "older-ground-message" },
      { id: "f3684898-38dd-4e25-8cf7-739bb0d76f16" },
      { id: "newer-ground-message" },
    ];
    const handle = makeHandle();

    jumpToMessageInVirtualizedChat(
      "f3684898-38dd-4e25-8cf7-739bb0d76f16",
      () => messages,
      () => handle as any,
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(5000);

    expect(handle.scrollToIndex).toHaveBeenCalled();
    for (const call of handle.scrollToIndex.mock.calls) {
      expect(call[0]).toBe(1);
    }
  });

  it("Grounds Dan notification repeat tap pre-warms latest rows before jumping to f368 target", async () => {
    const messages: Msg[] = Array.from({ length: 65 }, (_, i) => ({ id: `msg-${i}` }));
    messages[35] = { id: "7df96591-8532-4c27-aa89-dadc5795a3f7" };
    messages[37] = { id: "c6d02218-252b-4034-a591-273bef15ff4c" };
    messages[63] = { id: "f3684898-38dd-4e25-8cf7-739bb0d76f16" };
    const handle = makeHandle();

    jumpToMessageInVirtualizedChat(
      "f3684898-38dd-4e25-8cf7-739bb0d76f16",
      () => messages,
      () => handle as any,
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(60);
    expect(handle.scrollToIndex).toHaveBeenCalledWith(64, "end");
    expect(handle.scrollToIndex).not.toHaveBeenCalledWith(35, expect.anything());
    expect(handle.scrollToIndex).not.toHaveBeenCalledWith(37, expect.anything());

    await vi.advanceTimersByTimeAsync(100);
    expect(handle.scrollToIndex).toHaveBeenCalledWith(63, "center");
    expect(handle.scrollToIndex).toHaveBeenCalledWith(63, "end");
    expect(handle.scrollToMessageId).toHaveBeenCalledWith("f3684898-38dd-4e25-8cf7-739bb0d76f16", "end");
    expect(handle.scrollToMessageId).not.toHaveBeenCalledWith("7df96591-8532-4c27-aa89-dadc5795a3f7", expect.anything());
    expect(handle.scrollToMessageId).not.toHaveBeenCalledWith("c6d02218-252b-4034-a591-273bef15ff4c", expect.anything());
  });

  it("Grounds Dan repeat tap uses exact DOM correction before any estimated target jump", async () => {
    const messages: Msg[] = Array.from({ length: 65 }, (_, i) => ({ id: `msg-${i}` }));
    messages[35] = { id: "7df96591-8532-4c27-aa89-dadc5795a3f7" };
    messages[37] = { id: "c6d02218-252b-4034-a591-273bef15ff4c" };
    messages[63] = { id: "f3684898-38dd-4e25-8cf7-739bb0d76f16" };
    const handle = makeHandle(true);

    jumpToMessageInVirtualizedChat(
      "f3684898-38dd-4e25-8cf7-739bb0d76f16",
      () => messages,
      () => handle as any,
      vi.fn(),
    );

    await vi.advanceTimersByTimeAsync(60);
    expect(handle.scrollToIndex).toHaveBeenCalledWith(64, "end");

    await vi.advanceTimersByTimeAsync(100);
    expect(handle.scrollToMessageId).toHaveBeenCalledWith("f3684898-38dd-4e25-8cf7-739bb0d76f16", "end");
    expect(handle.scrollToIndex).not.toHaveBeenCalledWith(63, "center");
    expect(handle.scrollToIndex).not.toHaveBeenCalledWith(63, "end");
    expect(handle.scrollToIndex).not.toHaveBeenCalledWith(35, expect.anything());
    expect(handle.scrollToIndex).not.toHaveBeenCalledWith(37, expect.anything());
  });

  it("returns a cancel function that stops further scroll/highlight work", async () => {
    const handle = makeHandle();
    const setHighlight = vi.fn();
    const cancel = jumpToMessageInVirtualizedChat(
      "missing",
      () => [],
      () => handle as any,
      setHighlight,
      { maxAttempts: 40, intervalMs: 20 },
    );

    cancel();
    await vi.advanceTimersByTimeAsync(2000);

    expect(handle.scrollToIndex).not.toHaveBeenCalled();
    expect(setHighlight).not.toHaveBeenCalled();
  });

  it("falls back to parentMessageId when target is not loaded but parent is", async () => {
    const messages: Msg[] = [{ id: "a" }, { id: "parent" }, { id: "c" }];
    const handle = makeHandle();
    const setHighlight = vi.fn();

    jumpToMessageInVirtualizedChat(
      "reply-not-loaded",
      () => messages,
      () => handle as any,
      setHighlight,
      { maxAttempts: 20, intervalMs: 10, parentMessageId: "parent" },
    );

    // Walk past the half-way mark (10 ticks * 10ms = ~100ms) so the fallback
    // kicks in.
    await vi.advanceTimersByTimeAsync(200);

    expect(handle.scrollToIndex).toHaveBeenCalledWith(1, "end");
    expect(setHighlight).toHaveBeenCalledWith("parent");
    expect(document.getElementById).not.toHaveBeenCalled();
  });

  it("re-centres on the real target once it loads after a parent fallback", async () => {
    const handle = makeHandle();
    const setHighlight = vi.fn();
    let messages: Msg[] = [{ id: "parent" }];

    jumpToMessageInVirtualizedChat(
      "reply",
      () => messages,
      () => handle as any,
      setHighlight,
      { maxAttempts: 40, intervalMs: 10, parentMessageId: "parent" },
    );

    // Trigger parent fallback first.
    await vi.advanceTimersByTimeAsync(250);
    expect(setHighlight).toHaveBeenCalledWith("parent");

    // Now the real target arrives.
    messages = [{ id: "parent" }, { id: "reply" }];
    await vi.advanceTimersByTimeAsync(200);

    expect(setHighlight).toHaveBeenCalledWith("reply");
    expect(handle.scrollToIndex).toHaveBeenCalledWith(1, "end");
  });

  it("E2E: repeat notification taps always mount + focus the anchored target row", async () => {
    // Simulate the Grounds/Dan scenario: long history, target near the end.
    // Each notification tap re-invokes jumpToMessageInVirtualizedChat (as
    // GroupChatPage does on every nonce bump). We assert that on EVERY tap:
    //  (a) the target row is mounted (handle.scrollToMessageId fires for it)
    //  (b) the highlight is set to the target id
    //  (c) no scroll/highlight ever lands on an earlier neighbour
    const TARGET = "f3684898-38dd-4e25-8cf7-739bb0d76f16";
    const NEIGHBOUR_A = "7df96591-8532-4c27-aa89-dadc5795a3f7";
    const NEIGHBOUR_B = "c6d02218-252b-4034-a591-273bef15ff4c";
    const messages: Msg[] = Array.from({ length: 65 }, (_, i) => ({ id: `msg-${i}` }));
    messages[35] = { id: NEIGHBOUR_A };
    messages[37] = { id: NEIGHBOUR_B };
    messages[63] = { id: TARGET };

    const TAPS = 5;
    for (let tap = 0; tap < TAPS; tap++) {
      // Each tap remounts the virtualised list (GroupChatPage uses a key that
      // includes the jump nonce), so each tap gets a fresh handle whose
      // `scrollToMessageId` succeeds (target row guaranteed in DOM via the
      // anchored window). This mirrors the real anchored-jump behaviour.
      const handle = makeHandle(true);
      const setHighlight = vi.fn();

      jumpToMessageInVirtualizedChat(
        TARGET,
        () => messages,
        () => handle as any,
        setHighlight,
      );

      // Drain the full settle tail so any late re-centre passes also run.
      await vi.advanceTimersByTimeAsync(7000);

      // (a) target row mounted + driven via exact DOM correction
      expect(
        handle.scrollToMessageId.mock.calls.some(([id]) => id === TARGET),
        `tap ${tap}: target row was never focused via scrollToMessageId`,
      ).toBe(true);

      // (b) highlight reached the target
      expect(
        setHighlight.mock.calls.some(([id]) => id === TARGET),
        `tap ${tap}: highlight never set to target`,
      ).toBe(true);

      // (c) neither neighbour was scrolled to or highlighted
      for (const [id] of handle.scrollToMessageId.mock.calls) {
        expect(id).not.toBe(NEIGHBOUR_A);
        expect(id).not.toBe(NEIGHBOUR_B);
      }
      for (const [idx] of handle.scrollToIndex.mock.calls) {
        expect(idx).not.toBe(35);
        expect(idx).not.toBe(37);
      }
      for (const [id] of setHighlight.mock.calls) {
        expect([TARGET, null]).toContain(id);
      }
    }
  });
});
