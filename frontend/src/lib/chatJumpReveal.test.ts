import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  evaluateChatJumpRevealGate,
  waitForChatJumpTargetReveal,
} from "@/lib/chatJumpReveal";
import {
  beginChatJumpLifecycle,
  endChatJumpLifecycle,
  getChatJumpLifecycle,
  __resetChatJumpLifecycleForTests,
} from "@/lib/chatJumpLifecycle";

/**
 * Deterministic coverage for the single authoritative reveal lifecycle used by
 * exact-message jumps (notification / search / reply / pinned taps).
 */

const SCROLLER_RECT = { top: 0, bottom: 600, left: 0, right: 400, width: 400, height: 600 };

function rect(top: number, bottom: number) {
  return {
    top,
    bottom,
    left: 0,
    right: 400,
    width: 400,
    height: bottom - top,
    x: 0,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeScroller() {
  const el = document.createElement("div");
  document.body.appendChild(el);
  el.getBoundingClientRect = () => rect(SCROLLER_RECT.top, SCROLLER_RECT.bottom);
  Object.defineProperty(el, "scrollTop", { value: 0, writable: true });
  Object.defineProperty(el, "scrollHeight", { value: 2000, writable: true });
  Object.defineProperty(el, "clientHeight", { value: 600, writable: true });
  return el;
}

function addRow(scroller: HTMLElement, id: string, top: number, bottom: number) {
  const row = document.createElement("div");
  row.setAttribute("data-row-id", id);
  row.getBoundingClientRect = () => rect(top, bottom);
  scroller.appendChild(row);
  return row;
}

beforeEach(() => {
  document.body.innerHTML = "";
  __resetChatJumpLifecycleForTests();
  vi.useFakeTimers();
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) =>
    setTimeout(() => cb(0), 16) as unknown as number,
  );
  vi.stubGlobal("cancelAnimationFrame", (id: number) => clearTimeout(id));
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("evaluateChatJumpRevealGate", () => {
  it("blocks while the exact target row is not mounted", () => {
    const scroller = makeScroller();
    addRow(scroller, "other", 100, 200);
    expect(evaluateChatJumpRevealGate(scroller, { targetMessageId: "target" }))
      .toBe("target-not-mounted");
  });

  it("blocks while the target is clipped by the fixed composer", () => {
    const scroller = makeScroller();
    addRow(scroller, "target", 400, 590);
    expect(
      evaluateChatJumpRevealGate(scroller, {
        targetMessageId: "target",
        usableBottomInsetPx: 120,
      }),
    ).toBe("target-clipped-by-composer");
  });

  it("blocks while the target sits above the usable viewport", () => {
    const scroller = makeScroller();
    addRow(scroller, "target", -120, -20);
    expect(evaluateChatJumpRevealGate(scroller, { targetMessageId: "target" }))
      .toBe("target-above-viewport");
  });

  it("blocks while visible row content is still hydrating", () => {
    const scroller = makeScroller();
    const row = addRow(scroller, "target", 300, 420);
    const pulse = document.createElement("div");
    pulse.className = "animate-pulse";
    row.appendChild(pulse);
    expect(evaluateChatJumpRevealGate(scroller, { targetMessageId: "target" }))
      .toBe("visible-row-hydrating");
  });

  it("ignores off-screen skeletons in Virtuoso's overscan window", () => {
    const scroller = makeScroller();
    addRow(scroller, "target", 300, 420);
    const offscreen = addRow(scroller, "way-above", -4000, -3900);
    const pulse = document.createElement("div");
    pulse.className = "animate-pulse";
    offscreen.appendChild(pulse);
    expect(evaluateChatJumpRevealGate(scroller, { targetMessageId: "target" })).toBe("");
  });

  it("releases when the target is mounted, aligned and fully above the composer", () => {
    const scroller = makeScroller();
    addRow(scroller, "target", 300, 470);
    expect(
      evaluateChatJumpRevealGate(scroller, {
        targetMessageId: "target",
        usableBottomInsetPx: 120,
      }),
    ).toBe("");
  });
});

describe("waitForChatJumpTargetReveal", () => {
  it("reveals once geometry is stable for two consecutive frames", () => {
    const scroller = makeScroller();
    addRow(scroller, "target", 300, 420);
    const reveal = vi.fn();
    waitForChatJumpTargetReveal(
      scroller,
      { targetMessageId: "target", quietMs: 0, budgetMs: 5000 },
      reveal,
    );
    vi.advanceTimersByTime(100);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("keeps the overlay opaque while a mounted target is still moving", () => {
    const scroller = makeScroller();
    const row = addRow(scroller, "target", 300, 420);
    let top = 300;
    row.getBoundingClientRect = () => rect(top, top + 120);
    const reveal = vi.fn();
    waitForChatJumpTargetReveal(
      scroller,
      { targetMessageId: "target", quietMs: 0, budgetMs: 60000 },
      reveal,
    );
    for (let i = 0; i < 20; i++) {
      top += 10;
      vi.advanceTimersByTime(20);
    }
    expect(reveal).not.toHaveBeenCalled();
  });

  it("keeps the overlay opaque while the target is clipped, then releases", () => {
    const scroller = makeScroller();
    const row = addRow(scroller, "target", 500, 620);
    row.getBoundingClientRect = () => rect(500, 620);
    const reveal = vi.fn();
    waitForChatJumpTargetReveal(
      scroller,
      { targetMessageId: "target", usableBottomInsetPx: 120, quietMs: 0, budgetMs: 60000 },
      reveal,
    );
    vi.advanceTimersByTime(200);
    expect(reveal).not.toHaveBeenCalled();

    row.getBoundingClientRect = () => rect(300, 420);
    vi.advanceTimersByTime(200);
    expect(reveal).toHaveBeenCalledTimes(1);
  });

  it("fail-safe performs one final alignment and reveals on the next stable frames", () => {
    const scroller = makeScroller();
    const row = addRow(scroller, "target", 500, 620);
    row.getBoundingClientRect = () => rect(500, 620);
    const reveal = vi.fn();
    const finalAlign = vi.fn(() => {
      row.getBoundingClientRect = () => rect(300, 420);
    });
    waitForChatJumpTargetReveal(
      scroller,
      {
        targetMessageId: "target",
        usableBottomInsetPx: 120,
        quietMs: 0,
        budgetMs: 1000,
        finalAlign,
      },
      reveal,
    );
    vi.advanceTimersByTime(900);
    expect(finalAlign).not.toHaveBeenCalled();
    expect(reveal).not.toHaveBeenCalled();

    vi.advanceTimersByTime(300);
    expect(finalAlign).toHaveBeenCalledTimes(1);
    expect(reveal).toHaveBeenCalledTimes(1);
    // Never leaves the thread blank indefinitely.
    expect(reveal).toHaveBeenCalled();
  });

  it("cancelling never reveals", () => {
    const scroller = makeScroller();
    addRow(scroller, "target", 300, 420);
    const reveal = vi.fn();
    const cancel = waitForChatJumpTargetReveal(
      scroller,
      { targetMessageId: "target", quietMs: 0, budgetMs: 500 },
      reveal,
    );
    cancel();
    vi.advanceTimersByTime(2000);
    expect(reveal).not.toHaveBeenCalled();
  });
});

describe("chat jump lifecycle", () => {
  it("does not re-arm the budget for duplicate starts on the same target", () => {
    const first = beginChatJumpLifecycle("m1");
    const again = beginChatJumpLifecycle("m1");
    expect(again.generation).toBe(first.generation);
    expect(again.startedAt).toBe(first.startedAt);
  });

  it("supersedes an older lifecycle when a newer jump targets another message", () => {
    const first = beginChatJumpLifecycle("m1");
    const second = beginChatJumpLifecycle("m2");
    expect(second.generation).toBe(first.generation + 1);
    expect(second.targetMessageId).toBe("m2");
    expect(second.ended).toBe(false);
  });

  it("treats repeated end signals as no-ops", () => {
    beginChatJumpLifecycle("m1");
    const first = endChatJumpLifecycle();
    const second = endChatJumpLifecycle();
    expect(first.ended).toBe(true);
    expect(second.generation).toBe(first.generation);
    expect(getChatJumpLifecycle().ended).toBe(true);
  });
});
