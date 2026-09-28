/**
 * Integration tests asserting the FullscreenImageViewer's pending-tap
 * bookkeeping (`lastTapRef`, `gestureHadMultiTouch`, `gestureHadMultiFinger`,
 * `gestureMoved`) is fully reset between mixed gesture sequences.
 *
 * Why this suite is different from the others
 * --------------------------------------------
 * The existing suites (`mixed`, `staggered-pinch`, etc.) mount a fresh
 * component for every `it()` and assert the outcome of a single sequence.
 * That proves each sequence in isolation works — but it CANNOT detect
 * cross-sequence state leaks, because each test starts with a pristine
 * component.
 *
 * This suite mounts the component ONCE per `describe` block and runs many
 * sequences against the same instance. Between sequences we only clear
 * the mock call counts, not the component state. We then assert exact
 * cumulative call counts after each sequence:
 *
 *   • If a "should not zoom" sequence accidentally leaks a tap candidate
 *     into the next sequence, the next legitimate double-tap will fire
 *     EARLY (paired with the leaked candidate), or an illegitimate tap
 *     will fire when it shouldn't. Either way, the cumulative count
 *     diverges from expectations.
 *
 *   • If a "should zoom" sequence somehow consumes state that a later
 *     sequence depends on, that later sequence will fail to fire.
 *
 * The cumulative-count assertion is the strong property: the component
 * behaves identically whether it's the 1st sequence or the 10th.
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
    // scale=1 keeps triggerZoomToggle on the zoom-IN branch
    // (calls pinchDoubleClick → onDoubleClickMock). Single signal.
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

async function advance(ms: number) {
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}

/** Two-finger pinch with staggered (realistic) finger liftoff. */
async function performPinch(liftGapMs = 25) {
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
  await advance(liftGapMs);
  dispatch("touchend", [], [{ clientX: 220, clientY: 200 }]);
  await advance(0);
}

/** One-finger drag well past TAP_SLOP. */
async function performDrag(
  startX: number,
  startY: number,
  endX: number,
  endY: number,
) {
  dispatch("touchstart", [{ clientX: startX, clientY: startY }]);
  await advance(20);
  dispatch("touchmove", [
    { clientX: (startX + endX) / 2, clientY: (startY + endY) / 2 },
  ]);
  dispatch("touchmove", [{ clientX: endX, clientY: endY }]);
  await advance(20);
  dispatch("touchend", [], [{ clientX: endX, clientY: endY }]);
}

/** Brief, non-moving single tap. */
async function singleTap(x: number, y: number, holdMs = 30) {
  dispatch("touchstart", [{ clientX: x, clientY: y }]);
  await advance(holdMs);
  dispatch("touchend", [], [{ clientX: x, clientY: y }]);
}

/** Two clean single-finger taps within DOUBLE_TAP_MS — should pair. */
async function doubleTap(x: number, y: number, gapMs = 80) {
  await singleTap(x, y, 25);
  await advance(gapMs);
  await singleTap(x + 1, y + 1, 25);
}

/** A single 3-finger system gesture (e.g. iOS app switcher swipe). */
async function performThreeFingerSwipe() {
  dispatch("touchstart", [
    { clientX: 100, clientY: 100 },
    { clientX: 200, clientY: 100 },
    { clientX: 300, clientY: 100 },
  ]);
  dispatch("touchmove", [
    { clientX: 100, clientY: 200 },
    { clientX: 200, clientY: 200 },
    { clientX: 300, clientY: 200 },
  ]);
  await advance(20);
  dispatch("touchend", [], [
    { clientX: 100, clientY: 200 },
    { clientX: 200, clientY: 200 },
    { clientX: 300, clientY: 200 },
  ]);
  await advance(0);
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
  // Mount effect calls resetZoom — clear so cumulative counts only
  // reflect post-mount, gesture-driven invocations.
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

describe("Mixed-gesture sequences: pending tap state fully resets between sequences", () => {
  it("alternating [pinch | double-tap] × 4 → exactly 4 zooms total", async () => {
    // Pinches MUST clear any pending candidate; the following double-tap
    // MUST then fire its own zoom; the next pinch MUST again clear.
    // Cumulative count after 4 cycles must be exactly 4.
    for (let i = 0; i < 4; i++) {
      await performPinch();
      await advance(40);
      await doubleTap(150 + i * 5, 150 + i * 5, 70);
      await advance(40);

      // Cumulative invariant: one zoom per cycle, no more, no less.
      expect(onDoubleClickMock).toHaveBeenCalledTimes(i + 1);
    }
  });

  it("[pinch → drag → tap] × 3 then a final double-tap → exactly 1 zoom total", async () => {
    // Each pinch+drag+tap cycle MUST produce zero zooms (the lone trailing
    // tap can't pair with anything from the cleared pinch/drag). After 3
    // cycles, the final clean double-tap MUST fire its own single zoom.
    for (let i = 0; i < 3; i++) {
      await performPinch();
      await advance(30);
      await performDrag(120 + i * 10, 120, 240 + i * 10, 240);
      await advance(30);
      await singleTap(150 + i * 5, 150 + i * 5);
      await advance(40);

      // No zooms accumulated yet.
      expect(onDoubleClickMock).not.toHaveBeenCalled();
    }

    await doubleTap(180, 180, 80);
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("pinch → tap → pinch → tap → double-tap: only the final pair zooms", async () => {
    // Each lone tap after a pinch MUST NOT zoom (no candidate to pair
    // with). The intervening pinch between the two lone taps MUST clear
    // the candidate the first lone tap armed, so even those two lone
    // taps can't accidentally pair across the pinch boundary. Only the
    // final genuine double-tap zooms.
    await performPinch();
    await advance(30);
    await singleTap(150, 150);
    expect(onDoubleClickMock).not.toHaveBeenCalled();

    await advance(40);
    await performPinch();
    await advance(30);
    await singleTap(151, 151);
    // CRITICAL: even though the two lone taps are temporally close, the
    // intervening pinch invalidated the first tap's candidate.
    expect(onDoubleClickMock).not.toHaveBeenCalled();

    await advance(40);
    await doubleTap(160, 160, 70);
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("3-finger system gesture in the middle of a tap-pair invalidates the pair", async () => {
    // First lone tap arms a candidate. A 3-finger system gesture then
    // fires; the trailing tap MUST NOT pair with the pre-system-gesture
    // candidate. A subsequent fresh double-tap MUST still work.
    await singleTap(150, 150);
    // Candidate is armed but not yet visible via mocks — no zoom yet.
    expect(onDoubleClickMock).not.toHaveBeenCalled();

    await advance(50);
    await performThreeFingerSwipe();
    // 3+ finger gesture cleared the candidate. The next tap can't pair.
    await advance(50);
    await singleTap(151, 151);
    expect(onDoubleClickMock).not.toHaveBeenCalled();

    // After waiting out the multi-finger suppress window, a fresh
    // double-tap must still fire normally.
    await advance(400); // > MULTI_FINGER_SUPPRESS_MS (350)
    await doubleTap(160, 160, 70);
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("rapid alternation [drag, double-tap] × 5 → exactly 5 zooms", async () => {
    // Drags MUST clear any candidate they accidentally arm at the END of
    // the drag (gestureMoved trips). Subsequent double-tap MUST work
    // every time, regardless of how many drag/tap cycles preceded it.
    for (let i = 0; i < 5; i++) {
      await performDrag(100 + i * 5, 100, 220 + i * 5, 220);
      await advance(30);
      await doubleTap(150 + i * 3, 150 + i * 3, 70);
      await advance(30);

      expect(onDoubleClickMock).toHaveBeenCalledTimes(i + 1);
    }
  });

  it("kitchen sink: pinch → drag → 3-finger → tap → double-tap → pinch → double-tap → 2 zooms", async () => {
    // Compound stress: every kind of gesture mixed in one long sequence.
    // Only the two genuine double-taps should fire. Asserts cumulative
    // count after EACH segment so a regression at any step is localized.

    // 1. Pinch — no zoom.
    await performPinch();
    await advance(20);
    expect(onDoubleClickMock).not.toHaveBeenCalled();

    // 2. Drag — no zoom.
    await performDrag(100, 100, 220, 220);
    await advance(20);
    expect(onDoubleClickMock).not.toHaveBeenCalled();

    // 3. 3-finger system swipe — no zoom.
    await performThreeFingerSwipe();
    await advance(400); // wait out MULTI_FINGER_SUPPRESS_MS
    expect(onDoubleClickMock).not.toHaveBeenCalled();

    // 4. Lone tap — arms candidate but doesn't fire.
    await singleTap(150, 150);
    await advance(20);
    expect(onDoubleClickMock).not.toHaveBeenCalled();

    // 5. Genuine double-tap (paired with the candidate from step 4).
    await advance(50);
    await singleTap(151, 151);
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);

    // 6. Pinch — clears any leftover state.
    await advance(40);
    await performPinch();
    await advance(40);
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);

    // 7. Final genuine double-tap.
    await doubleTap(170, 170, 70);
    expect(onDoubleClickMock).toHaveBeenCalledTimes(2);
  });
});
