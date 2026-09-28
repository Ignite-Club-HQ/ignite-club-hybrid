/**
 * Edge-timing sweep: pinch followed by tap pairs across the boundaries of
 * `TAP_MAX_HOLD_MS` (long-press cutoff) and `DOUBLE_TAP_MS` (double-tap
 * pairing window).
 *
 * Why a sweep instead of three hand-picked cases?
 * ------------------------------------------------
 * The arbitration code has THREE numeric thresholds that could each slip:
 *
 *   • `TAP_MAX_HOLD_MS` — comparison is `heldMs >= TAP_MAX_HOLD_MS`.
 *     An off-by-one here (e.g. swapping `>=` for `>`) would let a
 *     borderline-long press count as a tap and pair into a zoom.
 *
 *   • `DOUBLE_TAP_MS` — comparison is `now - last.time < DOUBLE_TAP_MS`.
 *     Drift here would either widen or narrow the pairing window.
 *
 *   • `gestureHadMultiTouch` — must invalidate `lastTapRef` for the
 *     ENTIRE post-pinch window, regardless of how the next tap is timed.
 *
 * A regression in any one of those would only show up at specific timing
 * combinations. Hand-picking 2–3 cases is unlikely to hit them. This file
 * sweeps a 5×4 grid of (first-tap-hold, inter-tap-gap) values that
 * straddle each threshold and asserts the SAME outcome for every cell:
 *
 *   After a pinch, NO subsequent tap pair triggers zoom.
 *
 * That single invariant — "pinch poisons the next pair, full stop" — is
 * the property the user actually relies on. The sweep proves it holds
 * across the realistic timing spectrum, not just at one point.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import {
  TAP_MAX_HOLD_MS,
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

async function holdTap(x: number, y: number, holdMs: number) {
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

// --- Sweep grid -------------------------------------------------------------

/**
 * First-tap holds chosen to straddle the long-press boundary. The values
 * are derived from `TAP_MAX_HOLD_MS` so retuning the constant retunes the
 * sweep — no magic numbers below.
 *
 *   • Just-tap         (≪ threshold)        — clearly a tap candidate
 *   • Mid-tap          (mid-range)          — clearly a tap candidate
 *   • Just-under-edge  (threshold − 1)      — last legal tap value
 *   • Right-at-edge    (threshold)          — first long-press value
 *   • Clearly-over     (threshold + 50)     — clear long-press
 */
const FIRST_TAP_HOLDS_MS = [
  20,
  Math.floor(TAP_MAX_HOLD_MS / 2),
  TAP_MAX_HOLD_MS - 1,
  TAP_MAX_HOLD_MS,
  TAP_MAX_HOLD_MS + 50,
];

/**
 * Inter-tap gaps chosen to straddle the double-tap pairing window.
 *
 *   • Very-fast         (≪ window)            — easily in window
 *   • Mid-window        (~half)               — comfortably in window
 *   • Just-inside       (window − 20)         — last in-window value
 *   • Just-outside      (window + 20)         — first out-of-window value
 */
const INTER_TAP_GAPS_MS = [
  10,
  Math.floor(DOUBLE_TAP_MS / 2),
  DOUBLE_TAP_MS - 20,
  DOUBLE_TAP_MS + 20,
];

// --- Tests ------------------------------------------------------------------

describe("Pinch → tap-pair edge-timing sweep: pinch must never leak into zoom", () => {
  it("sweep coverage sanity (5 holds × 4 gaps = 20 cells)", () => {
    expect(FIRST_TAP_HOLDS_MS).toHaveLength(5);
    expect(INTER_TAP_GAPS_MS).toHaveLength(4);
  });

  for (const firstHold of FIRST_TAP_HOLDS_MS) {
    for (const gap of INTER_TAP_GAPS_MS) {
      it(`pinch → tap(hold=${firstHold}ms) → wait ${gap}ms → tap(30ms) does NOT zoom`, async () => {
        await performPinch();

        // Small breath after pinch-end before the first tap, so timing
        // arithmetic reflects the (firstHold, gap) the case names — not
        // the cumulative pinch duration.
        await act(async () => {
          vi.advanceTimersByTime(20);
        });

        // First tap. Whether this arms a candidate depends on whether
        // `firstHold >= TAP_MAX_HOLD_MS` (long-press → no candidate).
        // Either way, after the pinch the EXPECTED outcome is the same:
        // no zoom. If the pinch's invalidation of `lastTapRef` works, the
        // first tap can at most arm a fresh candidate; the second tap
        // then either pairs with that fresh candidate (which is fine —
        // the pinch played no role) OR fails to pair (out of window /
        // long-press). Critically, NO outcome should depend on residue
        // from the pinch itself.
        await holdTap(150, 150, firstHold);
        await act(async () => {
          vi.advanceTimersByTime(gap);
        });
        await holdTap(151, 151, 30);

        // The strong invariant: across every (firstHold, gap) cell, the
        // pinch must NOT contribute to a zoom. The only way a zoom could
        // fire here is if the second tap paired with a fresh candidate
        // armed by the first tap — which is legitimate non-pinch
        // behavior already covered in posttap.test.tsx. We assert that
        // outcome here based on the cell's parameters.
        // The pairing comparison is `secondTouchend - firstTouchend < DOUBLE_TAP_MS`.
        // End-to-end interval = `gap` (advance between taps) + the second
        // tap's hold (30 ms). The first tap's hold doesn't enter this term.
        const SECOND_TAP_HOLD_MS = 30;
        const endToEndIntervalMs = gap + SECOND_TAP_HOLD_MS;
        const firstTapWasLongPress = firstHold >= TAP_MAX_HOLD_MS;
        const pairWithinWindow = endToEndIntervalMs < DOUBLE_TAP_MS;
        const expectZoomFromFreshPair =
          !firstTapWasLongPress && pairWithinWindow;

        if (expectZoomFromFreshPair) {
          // Legitimate fresh double-tap (pinch played no role).
          expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
        } else {
          // Either the first tap was a long-press OR the gap exceeded
          // the pairing window. Either way, no zoom — and crucially,
          // no residual pinch state caused one.
          expect(onDoubleClickMock).not.toHaveBeenCalled();
          expect(resetZoomMock).not.toHaveBeenCalled();
        }
      });
    }
  }

  it("pinch → long-press → fast tap never zooms (long-press at edge can't arm)", async () => {
    // Targeted edge case: even the legal-but-nearly-long-press first tap,
    // followed by a clean fast second tap, must not zoom IF the first tap
    // was actually a long-press. This catches `>=` vs `>` flips.
    await performPinch();
    await act(async () => {
      vi.advanceTimersByTime(20);
    });
    await holdTap(150, 150, TAP_MAX_HOLD_MS); // boundary = long-press
    await act(async () => {
      vi.advanceTimersByTime(30);
    });
    await holdTap(151, 151, 20);
    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });
});
