/**
 * Integration test: pinch → one-finger drag → double-tap arbitration.
 *
 * Real-world sequence under test:
 *
 *   1. User pinches (2 fingers down, move, both lift).
 *   2. Without a clean reset, user immediately drags one finger across
 *      the screen (touchstart → touchmove past TAP_SLOP → touchend).
 *   3. User lifts, then performs a clean single-finger double-tap.
 *
 * Expectations:
 *
 *   • The pinch alone must NOT leave a pending tap candidate. The drag
 *     in step 2 also must NOT leave a pending tap candidate (it's a drag,
 *     not a tap — `gestureMoved` trips and `lastTapRef` stays null).
 *   • Therefore, the *first* tap in step 3 cannot pair with anything
 *     from step 1 or 2 — it can only arm a fresh candidate.
 *   • The *second* tap in step 3 then pairs with that fresh candidate
 *     and triggers zoom exactly once.
 *
 * Negative companion test:
 *
 *   • Pinch → drag → single tap (only one tap, no pair) must NOT zoom,
 *     proving the drag's touchend didn't accidentally arm a tap candidate
 *     that a later lone tap could pair with.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TAP_SLOP } from "./fullscreenImageViewerConfig";

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
    // Hold scale=1 so triggerZoomToggle takes the zoom-IN branch
    // (calls pinchDoubleClick → onDoubleClickMock). Single, clear signal.
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

/** Two fingers down, pinch out, both lift cleanly. */
async function performPinch() {
  dispatch("touchstart", [
    { clientX: 100, clientY: 200 },
    { clientX: 200, clientY: 200 },
  ]);
  dispatch("touchmove", [
    { clientX: 80, clientY: 200 },
    { clientX: 220, clientY: 200 },
  ]);
  dispatch(
    "touchend",
    [{ clientX: 220, clientY: 200 }],
    [{ clientX: 80, clientY: 200 }],
  );
  dispatch("touchend", [], [{ clientX: 220, clientY: 200 }]);
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
}

/**
 * One-finger drag that travels well past TAP_SLOP so `gestureMoved` trips
 * and the ending touchend cannot arm a tap candidate.
 */
async function performDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  dispatch("touchstart", [{ clientX: startX, clientY: startY }]);
  await act(async () => {
    vi.advanceTimersByTime(20);
  });
  // Mid-points so movement is unambiguously a drag (> TAP_SLOP).
  dispatch("touchmove", [
    { clientX: (startX + endX) / 2, clientY: (startY + endY) / 2 },
  ]);
  dispatch("touchmove", [{ clientX: endX, clientY: endY }]);
  await act(async () => {
    vi.advanceTimersByTime(20);
  });
  dispatch("touchend", [], [{ clientX: endX, clientY: endY }]);
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
  // Mount effect calls resetZoom — clear so assertions only count
  // post-mount invocations triggered by gestures.
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

describe("Pinch → drag → tap arbitration clears pending double-tap state", () => {
  it("sanity: drag distance is meaningfully larger than TAP_SLOP", () => {
    // The drag below moves ~120 px diagonally; TAP_SLOP is 10 px. If anyone
    // ever tightens TAP_SLOP past this distance, the drag would no longer
    // be classified as a drag and the test would silently lose its meaning.
    expect(TAP_SLOP).toBeLessThan(50);
  });

  it("pinch → drag → single tap does NOT zoom (no candidate to pair with)", async () => {
    // After pinch, lastTapRef is cleared by gestureHadMultiTouch.
    // The drag's touchend trips gestureMoved, so it also can't arm a
    // candidate. A single subsequent tap therefore has nothing to pair
    // with — it can only arm a fresh candidate, never trigger zoom.
    await performPinch();
    await act(async () => {
      vi.advanceTimersByTime(40);
    });

    await performDrag(100, 100, 220, 220);
    await act(async () => {
      vi.advanceTimersByTime(40);
    });

    await singleTap(150, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("pinch → drag → clean double-tap DOES zoom (fresh candidate arms cleanly)", async () => {
    // The drag must NOT poison subsequent gesture arbitration. After both
    // the pinch and the drag end, the next single-finger touchstart
    // resets gestureHadMultiTouch / gestureMoved, so a fresh double-tap
    // can arm and pair normally.
    await performPinch();
    await act(async () => {
      vi.advanceTimersByTime(40);
    });

    await performDrag(100, 100, 230, 230);
    await act(async () => {
      vi.advanceTimersByTime(40);
    });

    // First tap — arms a fresh candidate.
    await singleTap(150, 150);
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    // Second tap within DOUBLE_TAP_MS / DOUBLE_TAP_DIST — pairs and zooms.
    await singleTap(151, 151);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("pinch → drag → fast double-tap close to drag-end timing still zooms", async () => {
    // Squeezes the timing: the first tap lands right after the drag's
    // touchend with minimal idle time. This catches regressions where
    // arbitration state from the drag bleeds into the next gesture.
    await performPinch();
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    await performDrag(120, 120, 250, 250);
    // Almost no breath — straight into the tap.
    await act(async () => {
      vi.advanceTimersByTime(5);
    });

    await singleTap(160, 160, 20);
    await act(async () => {
      vi.advanceTimersByTime(40);
    });
    await singleTap(160, 160, 20);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("pinch → drag → tap → drag → tap does NOT zoom (intervening drag re-clears)", async () => {
    // Even if a candidate gets armed between drags, a subsequent drag
    // must clear it. Sequence: pinch, drag, tap (arms candidate), drag
    // (clears it), tap (would-be pair). Result: no zoom, because the
    // second drag invalidated the candidate before the final tap.
    await performPinch();
    await act(async () => {
      vi.advanceTimersByTime(30);
    });
    await performDrag(100, 100, 220, 220);
    await act(async () => {
      vi.advanceTimersByTime(30);
    });

    await singleTap(150, 150); // arms candidate
    await act(async () => {
      vi.advanceTimersByTime(40);
    });

    await performDrag(150, 150, 270, 270); // clears candidate via gestureMoved
    await act(async () => {
      vi.advanceTimersByTime(40);
    });

    await singleTap(151, 151); // would have paired — but candidate is gone

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });
});
