/**
 * Verifies that the smooth transition installed during a double-tap zoom is
 * cleared after the animation completes — and that subsequent double-taps
 * therefore install a fresh transition every time, instead of getting stuck
 * with a stale one.
 *
 * Why this matters: the <img> uses `transition: isAnimating ? "transform
 * 220ms ..." : "none"`. If `isAnimating` ever got stuck at `true`, the next
 * double-tap would still appear to work but the toggle after it would feel
 * "weird" because the browser would try to interpolate between two states
 * mid-flight. Repeated double-taps must behave identically.
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

// We don't need real pinch math — we just need the touch listener path to
// fire so that triggerZoomToggle runs and flips isAnimating.
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
    onDoubleClick: vi.fn(),
    resetZoom: vi.fn(),
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

function getImage(): HTMLImageElement {
  // Image lives in the portalled viewer overlay, not in the test container.
  const img = getGestureRoot().querySelector("img");
  if (!img) throw new Error("expected <img> in viewer");
  return img;
}

/** Single-finger touchstart + touchend at a point — counts as one tap. */
function tap(x: number, y: number) {
  const node = getGestureRoot();
  act(() => {
    node.dispatchEvent(makeTouchEvent("touchstart", [{ clientX: x, clientY: y }]));
    node.dispatchEvent(makeTouchEvent("touchend", [], [{ clientX: x, clientY: y }]));
  });
}

/** Two quick taps at roughly the same point — fires the double-tap path. */
function doubleTap(x = 150, y = 150) {
  tap(x, y);
  tap(x + 1, y + 1);
}

beforeEach(() => {
  vi.useFakeTimers();
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
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe("FullscreenImageViewer — transition lifecycle", () => {
  it("installs a transform transition during a double-tap zoom", () => {
    doubleTap();
    const img = getImage();
    // While the animation is in flight, the inline transition must be set so
    // the scale change is visually smooth (not an instant jump).
    expect(img.style.transition).toMatch(/transform \d+ms/);
  });

  it("clears the transition after the animation duration elapses", async () => {
    doubleTap();

    // The component schedules setIsAnimating(false) at ~220ms. Advance past
    // that boundary and let React flush the effect.
    await act(async () => {
      vi.advanceTimersByTime(260);
    });

    const img = getImage();
    // After the animation ends, transition must revert to "none" so the next
    // gesture (pan/pinch) doesn't get an unwanted interpolation.
    expect(img.style.transition).toBe("none");
  });

  it("re-installs the transition on a second double-tap after the first finishes", async () => {
    // First double-tap → transition is set.
    doubleTap();
    let img = getImage();
    expect(img.style.transition).toMatch(/transform \d+ms/);

    // Animation completes → transition cleared.
    await act(async () => {
      vi.advanceTimersByTime(260);
    });
    img = getImage();
    expect(img.style.transition).toBe("none");

    // Second double-tap (well past the double-tap pairing window so it's a
    // fresh sequence) → transition must be installed again, identically to
    // the first one. This is the "repeated double-taps behave consistently"
    // contract.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    doubleTap();
    img = getImage();
    expect(img.style.transition).toMatch(/transform \d+ms/);
  });

  it("a third double-tap after two complete cycles still installs the transition", async () => {
    // Run through three full toggle/reset cycles to catch any drift in the
    // isAnimating state machine over time.
    for (let i = 0; i < 3; i++) {
      doubleTap();
      const img = getImage();
      expect(
        img.style.transition,
        `cycle ${i}: transition should be set during animation`,
      ).toMatch(/transform \d+ms/);

      await act(async () => {
        vi.advanceTimersByTime(260);
      });
      expect(
        getImage().style.transition,
        `cycle ${i}: transition should be cleared after animation`,
      ).toBe("none");

      // Pause well past the double-tap window before the next cycle begins.
      await act(async () => {
        vi.advanceTimersByTime(500);
      });
    }
  });
});
