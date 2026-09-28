/**
 * Positive-path test for FullscreenImageViewer double-tap zoom.
 *
 * The other suites in this directory (`mixed`, `threefinger`, `doubletap`,
 * `transition`) mostly verify that double-tap zoom is *suppressed* during
 * compound gestures. This file complements them by asserting the OPPOSITE:
 *
 *   A genuine single-finger double-tap MUST still toggle zoom even after a
 *   pinch sequence has fully ended, and across a range of realistic
 *   inter-tap timings (very fast, mid-window, near-window-edge).
 *
 * Why this matters
 * ----------------
 * Suppression logic works by invalidating `lastTapRef` whenever a multi-touch
 * (`gestureHadMultiTouch`) or multi-finger (`gestureHadMultiFinger`) flag is
 * tripped. Those flags are reset on the *next* fresh single-finger touchstart
 * (`e.touches.length === 1`). A regression here — e.g. a flag that "sticks"
 * across the pinch boundary, or a tap-candidate that fails to arm because
 * the previous gesture's state leaked — would silently break the most common
 * post-zoom interaction: pinch in, pinch out, double-tap to reset.
 *
 * Test matrix
 * -----------
 *   1. Pinch end → fresh double-tap (80 ms gap)        → zoom triggers
 *   2. Pinch end → very-rapid double-tap (10 ms gap)   → zoom triggers
 *   3. Pinch end → double-tap near DOUBLE_TAP_MS edge  → zoom triggers
 *   4. Pinch end → double-tap just OVER DOUBLE_TAP_MS  → zoom does NOT trigger
 *      (boundary check that suppression isn't silently extending the window)
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DOUBLE_TAP_MS } from "./fullscreenImageViewerConfig";

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
    // Always report scale=1 so triggerZoomToggle takes the zoom-IN branch
    // (which calls pinchDoubleClick → onDoubleClickMock). That gives us a
    // single, easy-to-assert signal for "double-tap fired."
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

/** Simulate a complete two-finger pinch that starts and ends cleanly. */
async function performPinch() {
  // Both fingers down
  dispatch("touchstart", [
    { clientX: 100, clientY: 200 },
    { clientX: 200, clientY: 200 },
  ]);
  // Pinch out
  dispatch("touchmove", [
    { clientX: 80, clientY: 200 },
    { clientX: 220, clientY: 200 },
  ]);
  // First finger lifts (1 touch remaining)
  dispatch(
    "touchend",
    [{ clientX: 220, clientY: 200 }],
    [{ clientX: 80, clientY: 200 }],
  );
  // Second finger lifts (0 touches remaining) — this closes the pinch
  // sequence; gestureHadMultiTouch is true so lastTapRef is cleared.
  dispatch("touchend", [], [{ clientX: 220, clientY: 200 }]);
  await act(async () => {
    vi.advanceTimersByTime(0);
  });
}

/** Simulate a clean, brief single-finger tap. */
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
  // Mount effect calls resetZoom — clear so test assertions only count
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

describe("Genuine double-tap still works after pinch end", () => {
  it("pinch end → standard double-tap (80 ms gap) toggles zoom", async () => {
    await performPinch();

    // Brief breath so the pinch's touchend is clearly in the past.
    await act(async () => {
      vi.advanceTimersByTime(50);
    });

    // First clean tap arms a fresh candidate (the pinch's lastTapRef was
    // cleared, but the next touchstart with touches.length===1 resets the
    // multi-touch flag, allowing a brand-new candidate to arm).
    await singleTap(150, 150);
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    await singleTap(151, 151);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("pinch end → very-rapid double-tap (10 ms gap) toggles zoom", async () => {
    // Stress-tests the case where a user performs an almost-instant
    // double-tap immediately after pinching. The 10 ms inter-tap gap is
    // well below DOUBLE_TAP_MS and well above the realistic minimum.
    await performPinch();
    await act(async () => {
      vi.advanceTimersByTime(20);
    });

    await singleTap(160, 160, 20);
    await act(async () => {
      vi.advanceTimersByTime(10);
    });
    await singleTap(160, 160, 20);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it(`pinch end → double-tap near DOUBLE_TAP_MS edge (gap = ${DOUBLE_TAP_MS - 30} ms) toggles zoom`, async () => {
    // Picks a gap that's safely inside the window but close enough to the
    // edge to catch off-by-one regressions in the timing comparison.
    // Inter-touchend gap = (first hold after touchstart timing) + advance.
    // We use small holds to keep the math simple: touchend-to-touchend gap
    // ≈ first_hold + advance + second_hold. Keep total < DOUBLE_TAP_MS.
    await performPinch();
    await act(async () => {
      vi.advanceTimersByTime(40);
    });

    await singleTap(170, 170, 20);
    await act(async () => {
      // Aim for an end-to-end gap just under DOUBLE_TAP_MS.
      vi.advanceTimersByTime(DOUBLE_TAP_MS - 80);
    });
    await singleTap(171, 171, 20);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it(`pinch end → second tap OUTSIDE DOUBLE_TAP_MS does NOT toggle zoom`, async () => {
    // Sanity boundary: confirms the suppression code isn't accidentally
    // *extending* the double-tap window after a pinch. Two genuine taps
    // with too large a gap must NOT pair into a double-tap.
    await performPinch();
    await act(async () => {
      vi.advanceTimersByTime(40);
    });

    await singleTap(180, 180, 20);
    await act(async () => {
      // Push end-to-end gap clearly past DOUBLE_TAP_MS.
      vi.advanceTimersByTime(DOUBLE_TAP_MS + 100);
    });
    await singleTap(181, 181, 20);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("pinch end → drift double-tap (slight movement between taps) still pairs within DOUBLE_TAP_DIST", async () => {
    // Real fingers don't land in the exact same pixel twice. As long as the
    // two taps are within DOUBLE_TAP_DIST (32 px), they must still pair.
    await performPinch();
    await act(async () => {
      vi.advanceTimersByTime(30);
    });

    await singleTap(200, 200, 25);
    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    // ~14 px diagonal drift — well within the 32 px tolerance.
    await singleTap(210, 210, 25);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });
});
