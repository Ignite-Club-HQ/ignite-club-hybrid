/**
 * Drag-cancellation × double-tap integration tests for FullscreenImageViewer.
 *
 * Covers the interaction between the "tap-becomes-drag" reclassification
 * path and the double-tap arming bookkeeping. The component tracks a
 * `lastTapRef` candidate from the first finger lift; if a subsequent
 * touch sequence moves more than `TAP_SLOP` pixels before lifting, that
 * sequence MUST NOT pair with the pending candidate, AND the pending
 * candidate MUST be cleared so it can't pair with a *later* tap either.
 *
 * Why this matters: users routinely tap an image, then slightly drag it
 * to reposition before tapping again. Without strict cancellation, the
 * first tap could silently pair with a tap that happens 250 ms later
 * across an unrelated drag, producing a phantom zoom toggle.
 *
 * Each test uses a single mounted viewer and asserts cumulative
 * `onDoubleClick` counts so we catch state leaks across sequences — a
 * strictly stronger invariant than per-sequence assertions.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  TAP_SLOP,
  DOUBLE_TAP_MS,
} from "./fullscreenImageViewerConfig";

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
import { makeTouchEvent } from "@/test/touchEventHelpers";

// --- Harness ----------------------------------------------------------------

let container: HTMLDivElement;
let root: Root;

function renderViewer() {
  act(() => {
    root.render(
      <FullscreenImageViewer
        src="https://reference.invalid"
        onClose={() => {}}
      />,
    );
  });
  // Clear the initial mount-effect resetZoom() so counts reflect taps only.
  resetZoomMock.mockClear();
  onDoubleClickMock.mockClear();
}

import { getGestureRoot as getPortalledGestureRoot } from "@/test/touchEventHelpers";

function gestureRoot(): HTMLElement {
  return getPortalledGestureRoot(container);
}

function dispatch(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  touches: { clientX: number; clientY: number }[],
  changed?: { clientX: number; clientY: number }[],
) {
  act(() => {
    gestureRoot().dispatchEvent(makeTouchEvent(type, touches, changed));
  });
}

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** A clean stationary tap. Arms or pairs with `lastTapRef`. */
function singleTap(x: number, y: number) {
  dispatch("touchstart", [{ clientX: x, clientY: y }]);
  dispatch("touchend", [], [{ clientX: x, clientY: y }]);
}

/**
 * A touch sequence that starts at (x,y), drags by `dx,dy` past TAP_SLOP,
 * then lifts. The component must reclassify this from "tap" to "drag"
 * and refuse to use it as either side of a double-tap pair.
 */
function dragCancel(x: number, y: number, dx: number, dy: number) {
  dispatch("touchstart", [{ clientX: x, clientY: y }]);
  // Single touchmove past slop is enough to flip `gestureMoved`.
  dispatch("touchmove", [{ clientX: x + dx, clientY: y + dy }]);
  dispatch(
    "touchend",
    [],
    [{ clientX: x + dx, clientY: y + dy }],
  );
}

// Sanity: the slop in pixels we drag past in tests must exceed TAP_SLOP.
const PAST_SLOP = TAP_SLOP + 5;

beforeEach(() => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  onDoubleClickMock.mockReset();
  resetZoomMock.mockReset();
  renderViewer();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe("FullscreenImageViewer — double-tap × drag cancellation", () => {
  it("a drag between two taps prevents pairing (no zoom)", async () => {
    // tap → quick drag → tap, all within the double-tap window.
    singleTap(100, 100);
    await advance(50);
    dragCancel(120, 120, PAST_SLOP, 0);
    await advance(50);
    singleTap(105, 105);

    // The drag's touchend MUST NOT pair with the first tap, and the drag
    // MUST clear lastTapRef so the third tap has nothing to pair with.
    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("a drag clears the candidate so a follow-up legitimate double-tap still works after a fresh first tap", async () => {
    // Sequence: tap → drag (clears candidate) → tap (arms new candidate)
    //         → tap (pairs with the new candidate, IS a double-tap).
    singleTap(100, 100);
    await advance(40);
    dragCancel(150, 150, PAST_SLOP, PAST_SLOP);
    await advance(40);
    singleTap(200, 200); // arms fresh candidate
    await advance(60);
    singleTap(202, 198); // pairs with the freshly-armed one

    // Exactly one zoom: the legitimate post-drag double-tap.
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("the touchend of a drag never arms a candidate, even at the original start coords", async () => {
    // A drag that returns roughly to the start point still has gestureMoved
    // set and must NOT be treated as a tap. If the component used only
    // start-vs-end distance (instead of cumulative move), this would
    // wrongly arm a tap candidate.
    dragCancel(100, 100, PAST_SLOP, 0);
    // Now do a fast follow-up tap at the same place; if a candidate was
    // wrongly armed by the drag, this would pair into a double-tap.
    await advance(50);
    singleTap(100, 100);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("multiple consecutive drag-cancellations leave no residual tap state", async () => {
    // Five drags in a row, all within the double-tap window. Then a
    // single tap. Nothing should ever zoom — there's no pair anywhere.
    for (let i = 0; i < 5; i++) {
      dragCancel(100 + i * 10, 100, PAST_SLOP, 0);
      await advance(40);
    }
    singleTap(150, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("interleaved taps and drags only count true tap-pairs, regardless of timing", async () => {
    // Pattern: tap | drag | tap-tap (real double-tap) | drag | tap | drag.
    // Cumulative invariant: exactly ONE zoom from the middle pair.
    singleTap(100, 100);
    await advance(40);
    dragCancel(110, 110, PAST_SLOP, 0);
    await advance(40);

    singleTap(200, 200);
    await advance(60);
    singleTap(203, 198);
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);

    await advance(40);
    dragCancel(210, 210, PAST_SLOP, 0);
    await advance(40);
    singleTap(220, 220);
    await advance(40);
    dragCancel(230, 230, 0, PAST_SLOP);

    // No additional pairings happened.
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("a tap immediately AFTER the double-tap window expires cannot pair, even with no drag in between", async () => {
    // Control: confirms our timing helpers actually advance the clock so
    // the surrounding drag-cancellation tests aren't accidentally passing
    // for the wrong reason (e.g. stale candidates that never get a chance
    // to pair because no time advances).
    singleTap(100, 100);
    await advance(DOUBLE_TAP_MS + 50);
    singleTap(100, 100);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("a drag that crosses TAP_SLOP exactly is treated as a drag (boundary)", async () => {
    // The component uses strict >, so a move of exactly TAP_SLOP+1 must
    // be a drag. We pick TAP_SLOP+1 (not PAST_SLOP) to pin the boundary.
    singleTap(100, 100);
    await advance(40);
    dragCancel(150, 150, TAP_SLOP + 1, 0);
    await advance(40);
    singleTap(105, 105);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });
});
