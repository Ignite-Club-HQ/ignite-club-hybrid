/**
 * Boundary tests for the configurable long-press threshold
 * (`TAP_MAX_HOLD_MS`) used in FullscreenImageViewer.
 *
 * Why these tests matter
 * ----------------------
 * The threshold determines whether a touch sequence is classified as a
 * "tap" (eligible to pair into a double-tap zoom) or a "long-press"
 * (which must be ignored — it's a context menu / text-selection gesture).
 * Drift in either direction breaks user expectations:
 *
 *   • Too low  → slow taps get reclassified as long-press; double-tap
 *                zoom feels broken on devices/users with slow fingers.
 *   • Too high → context-menu long-presses race the zoom toggle and
 *                accidentally zoom while the system context menu opens.
 *
 * We exercise three boundary points around the configured threshold:
 *
 *   1. Hold = (threshold − 1) ms  → still a tap, double-tap MUST trigger.
 *   2. Hold = threshold          ms → boundary, treated as long-press
 *                                     (the comparison in the component is
 *                                     `>=`), so double-tap MUST NOT trigger.
 *   3. Hold = (threshold + 50)   ms → clearly long-press, MUST NOT trigger.
 *
 * The constant is imported from the same module the component uses, so
 * tuning the threshold automatically retunes these assertions — no magic
 * numbers in the test body.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TAP_MAX_HOLD_MS } from "./fullscreenImageViewerConfig";

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

// Touch-event polyfill is shared across gesture suites — see module docs.
import { makeTouchEvent } from "@/test/touchEventHelpers";

import { getGestureRoot as getPortalledGestureRoot } from "@/test/touchEventHelpers";

function getGestureRoot(): HTMLElement {
  return getPortalledGestureRoot(container);
}

function dispatch(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  touches: { clientX: number; clientY: number }[],
  changed?: { clientX: number; clientY: number }[],
) {
  act(() => {
    getGestureRoot().dispatchEvent(makeTouchEvent(type, touches, changed));
  });
}

/**
 * Simulate a single tap that is *held* for `holdMs` between touchstart and
 * touchend. Uses fake timers so the component's `Date.now() - gestureStartTime`
 * comparison sees exactly the hold duration we asked for.
 */
async function holdTap(x: number, y: number, holdMs: number) {
  dispatch("touchstart", [{ clientX: x, clientY: y }]);
  await act(async () => {
    vi.advanceTimersByTime(holdMs);
  });
  dispatch("touchend", [], [{ clientX: x, clientY: y }]);
}

beforeEach(() => {
  vi.useFakeTimers();
  // Anchor at a stable epoch so Date.now() arithmetic is predictable.
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
  // post-render invocations triggered by gestures.
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

describe("TAP_MAX_HOLD_MS — long-press boundary behavior", () => {
  it("exports a sensible default (300–800 ms range)", () => {
    // Sanity-check the constant itself so a future edit that accidentally
    // sets it to 0 or 60_000 fails fast in CI.
    expect(TAP_MAX_HOLD_MS).toBeGreaterThanOrEqual(300);
    expect(TAP_MAX_HOLD_MS).toBeLessThanOrEqual(800);
  });

  it(`hold = (TAP_MAX_HOLD_MS − 1) → still classified as a tap`, async () => {
    // The just-under-threshold hold is technically still a tap. We verify
    // this by following it with a clean fast tap *within* DOUBLE_TAP_MS of
    // the long hold's touchend — they must pair into a double-tap zoom.
    //
    // Note: pairing requires both taps' touchends to fall within
    // DOUBLE_TAP_MS (300 ms) of each other, so the second tap's hold is
    // intentionally tiny. The first tap's near-threshold hold is what
    // we're actually testing.
    await holdTap(150, 150, TAP_MAX_HOLD_MS - 1);
    await act(async () => {
      vi.advanceTimersByTime(80); // < DOUBLE_TAP_MS gap
    });
    await holdTap(151, 151, 30);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it(`hold = TAP_MAX_HOLD_MS → boundary classified as long-press; no zoom`, async () => {
    // The component uses `heldMs >= TAP_MAX_HOLD_MS`, so exactly the
    // threshold value is treated as a long-press, not a tap. Even followed
    // by a clean fast tap inside the double-tap window, no pair forms.
    await holdTap(150, 150, TAP_MAX_HOLD_MS);
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    await holdTap(151, 151, 30);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it(`hold = (TAP_MAX_HOLD_MS + 50) → clear long-press; never zooms`, async () => {
    await holdTap(150, 150, TAP_MAX_HOLD_MS + 50);
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    await holdTap(151, 151, 30);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("a fast tap followed by a long-press does NOT pair into a double-tap", async () => {
    // First tap arms a candidate.
    await holdTap(150, 150, 50);
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    // Second touch is held past the threshold — even though the *first*
    // tap was a valid candidate, the long-press second touch must not
    // complete the pair.
    await holdTap(151, 151, TAP_MAX_HOLD_MS + 20);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });

  it("a long-press followed by a fast tap does NOT pair into a double-tap", async () => {
    // First touch is a long-press — must NOT arm a tap candidate.
    await holdTap(150, 150, TAP_MAX_HOLD_MS + 20);
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    // Second touch is a clean fast tap — without an armed candidate from
    // the long-press, it can only arm a fresh one, not complete a pair.
    await holdTap(151, 151, 40);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
  });
});
