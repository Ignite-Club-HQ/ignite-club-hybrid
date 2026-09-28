/**
 * Integration test: consecutive pinches with STAGGERED finger liftoffs,
 * followed immediately by a single tap. Zoom must stay suppressed across
 * the entire compound sequence.
 *
 * Why staggered liftoffs matter
 * -----------------------------
 * In real-world iOS/Android touch traces, a two-finger pinch rarely ends
 * with both fingers lifting in the same touchend event. One finger almost
 * always lifts a few milliseconds before the other:
 *
 *     touchend #1  → touches.length === 1, changedTouches.length === 1
 *     touchend #2  → touches.length === 0, changedTouches.length === 1
 *
 * The arbitration code's "this could be a double-tap" check explicitly
 * requires `e.changedTouches.length === 1 && e.touches.length === 0`, so
 * the FIRST staggered touchend (touches.length === 1) is correctly
 * skipped. But the SECOND touchend looks superficially like a clean
 * single-finger lift — IT MUST NOT trigger tap-candidate arming because
 * `gestureHadMultiTouch` is still true from the pinch.
 *
 * Things that could regress
 * -------------------------
 *   • If `gestureHadMultiTouch` were reset on the first staggered
 *     touchend (when one finger lifts), the second touchend would arm
 *     a tap candidate that pairs with the next real tap → ghost zoom.
 *   • If `lastTapRef` were re-armed by the second touchend instead of
 *     cleared, two consecutive pinches' tail touchends could pair with
 *     each other into a "double-tap" → ghost zoom.
 *   • If the *between-pinches* idle time reset arbitration flags before
 *     the next touchstart, the second pinch could leak.
 *
 * This file walks several variations of consecutive staggered pinches
 * and asserts the same invariant: zoom never fires.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// --- Mocks ------------------------------------------------------------------

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));
vi.mock("@/lib/statusBarControl", () => ({
  applyStatusBarForViewer: vi.fn(),
  refreshStatusBar: vi.fn(),
}));
vi.mock("@/hooks/useIOSScrollLock", () => ({ useIOSScrollLock: vi.fn() }));
vi.mock("@/hooks/useSignedPhotoUrl", () => ({
  useSignedPhotoUrl: () => ({ signedUrl: "https://reference.invalid" }),
}));
vi.mock("@/lib/safeOpenUrl", () => ({ safeOpenUrl: vi.fn() }));
vi.mock("@/lib/videoUtils", () => ({ isVideoUrl: () => false }));

const onDoubleClickMock = vi.fn();
const resetZoomMock = vi.fn();

vi.mock("@/hooks/usePinchZoom", () => ({
  usePinchZoom: () => ({
    scale: 1,
    translateX: 0,
    translateY: 0,
    onTouchStart: vi.fn(),
    onTouchMove: vi.fn(),
    onTouchEnd: vi.fn(),
    onWheel: vi.fn(),
    onMouseDown: vi.fn(),
    onMouseMove: vi.fn(),
    onMouseUp: vi.fn(),
    onDoubleClick: onDoubleClickMock,
    resetZoom: resetZoomMock,
    isPanningOrPinching: () => false,
  }),
}));

import { FullscreenImageViewer } from "./FullscreenImageViewer";

// --- Helpers ----------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

function makeTouchEvent(
  type: string,
  touches: { clientX: number; clientY: number }[],
  changedTouches: { clientX: number; clientY: number }[] = touches,
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  Object.defineProperty(ev, "touches", { value: touches });
  Object.defineProperty(ev, "changedTouches", { value: changedTouches });
  return ev;
}

import { getGestureRoot as getPortalledGestureRoot } from "@/test/touchEventHelpers";

function getGestureRoot(): HTMLElement {
  return getPortalledGestureRoot(container);
}

function dispatch(
  type: string,
  touches: { clientX: number; clientY: number }[],
  changed?: { clientX: number; clientY: number }[],
) {
  act(() => {
    getGestureRoot().dispatchEvent(makeTouchEvent(type, touches, changed));
  });
}

/**
 * A two-finger pinch where the two fingers lift on SEPARATE touchend events,
 * separated by `liftGapMs`. This mirrors real device traces.
 *
 *   sequence:
 *     touchstart [F1, F2]
 *     touchmove  [F1', F2']        ← pinch motion
 *     touchend   [F2'] (changed: [F1'])   ← finger 1 lifts
 *     [advance liftGapMs]
 *     touchend   []     (changed: [F2'])   ← finger 2 lifts
 */
async function performStaggeredPinch(opts?: {
  liftGapMs?: number;
  f1Start?: { x: number; y: number };
  f2Start?: { x: number; y: number };
}) {
  const liftGapMs = opts?.liftGapMs ?? 25;
  const f1 = opts?.f1Start ?? { x: 100, y: 200 };
  const f2 = opts?.f2Start ?? { x: 200, y: 200 };

  dispatch("touchstart", [
    { clientX: f1.x, clientY: f1.y },
    { clientX: f2.x, clientY: f2.y },
  ]);
  dispatch("touchmove", [
    { clientX: f1.x - 20, clientY: f1.y },
    { clientX: f2.x + 20, clientY: f2.y },
  ]);
  // Finger 1 lifts; finger 2 still down.
  dispatch(
    "touchend",
    [{ clientX: f2.x + 20, clientY: f2.y }],
    [{ clientX: f1.x - 20, clientY: f1.y }],
  );
  await act(async () => {
    vi.advanceTimersByTime(liftGapMs);
  });
  // Finger 2 lifts; sequence ends.
  dispatch("touchend", [], [{ clientX: f2.x + 20, clientY: f2.y }]);
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
}

/** Brief, non-moving single tap. */
async function singleTap(x: number, y: number, holdMs = 30) {
  dispatch("touchstart", [{ clientX: x, clientY: y }]);
  await act(async () => {
    vi.advanceTimersByTime(holdMs);
  });
  dispatch("touchend", [], [{ clientX: x, clientY: y }]);
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  onDoubleClickMock.mockClear();
  resetZoomMock.mockClear();

  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  act(() => {
    root.render(
      <FullscreenImageViewer
        src="https://reference.invalid"
        onClose={() => {}}
      />,
    );
  });
  resetZoomMock.mockClear();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe("Consecutive staggered pinches → tap: zoom stays suppressed", () => {
  it("two staggered pinches → immediate single tap does NOT zoom", async () => {
    // Two pinches back to back, each ending with a staggered finger lift.
    // The trailing single tap could naively pair with either pinch's tail
    // touchend if arbitration leaks. It must not.
    await performStaggeredPinch({ liftGapMs: 25 });
    await act(async () => {
      vi.advanceTimersByTime(40);
    });
    await performStaggeredPinch({ liftGapMs: 30 });
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    await singleTap(150, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("three staggered pinches → immediate single tap does NOT zoom", async () => {
    // Stress: three back-to-back staggered pinches. Each pinch's trailing
    // touchend (touches.length===0) must NOT arm a tap candidate, even if
    // the previous gesture's flags were briefly cleared between pinches.
    await performStaggeredPinch({ liftGapMs: 20 });
    await act(async () => {
      vi.advanceTimersByTime(30);
    });
    await performStaggeredPinch({ liftGapMs: 35 });
    await act(async () => {
      vi.advanceTimersByTime(25);
    });
    await performStaggeredPinch({ liftGapMs: 15 });
    await act(async () => {
      vi.advanceTimersByTime(15);
    });
    await singleTap(160, 160);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("two staggered pinches with NO breath in between → tap does NOT zoom", async () => {
    // Adversarial: the second pinch's touchstart fires immediately after
    // the first pinch's tail touchend. Catches regressions where the
    // multi-touch flag is reset prematurely on the back-to-back boundary.
    await performStaggeredPinch({ liftGapMs: 25 });
    // Zero idle time before next pinch.
    await performStaggeredPinch({ liftGapMs: 25 });
    await singleTap(170, 170);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("staggered pinch with LONG lift gap → tap does NOT zoom", async () => {
    // The two staggered touchends are separated by 200ms — enough that a
    // naive implementation might think the gesture "ended" before the
    // second finger lifted. The arbitration must still treat the entire
    // span as one multi-touch sequence.
    await performStaggeredPinch({ liftGapMs: 200 });
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    await singleTap(180, 180);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("staggered pinch → tap → staggered pinch → tap: neither tap zooms", async () => {
    // Interleaved sequence. Each tap follows a pinch — neither should
    // pair with anything from the pinch tails. (The first tap also can't
    // pair with the second tap because a pinch sits between them and
    // clears `lastTapRef`.)
    await performStaggeredPinch({ liftGapMs: 25 });
    await act(async () => {
      vi.advanceTimersByTime(30);
    });
    await singleTap(150, 150);

    await act(async () => {
      vi.advanceTimersByTime(40);
    });

    await performStaggeredPinch({ liftGapMs: 25 });
    await act(async () => {
      vi.advanceTimersByTime(30);
    });
    await singleTap(151, 151);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("staggered pinch → tap (within DOUBLE_TAP_MS of pinch tail) does NOT zoom", async () => {
    // Tightest timing: the single tap's touchend lands well within the
    // double-tap pairing window of the pinch's trailing touchend.
    // Even though the time-distance check would pass if a candidate were
    // armed, no candidate exists — and this test verifies that.
    await performStaggeredPinch({ liftGapMs: 20 });
    // Only 30ms breath — comfortably inside any reasonable DOUBLE_TAP_MS.
    await act(async () => {
      vi.advanceTimersByTime(30);
    });
    await singleTap(150, 150, 25);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });
});
