/**
 * 3+ finger system gesture tests for FullscreenImageViewer.
 *
 * On both iOS (App Switcher 4-finger swipe, Accessibility triple-tap) and
 * Android (split-screen, screenshot 3-finger swipe), gestures with 3+
 * simultaneous fingers must NEVER trigger the image's double-tap zoom — they
 * belong to the OS, not us. This file asserts that the touch arbiter:
 *   1. Suppresses double-tap toggling for the entire 3+ finger sequence.
 *   2. Suppresses the React synthetic onDoubleClick that some browsers
 *      synthesize after multi-touch ends.
 *   3. Re-enables double-tap once a clean single-finger sequence resumes.
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
const pinchTouchStartMock = vi.fn();
const pinchTouchEndMock = vi.fn();

vi.mock("@/hooks/usePinchZoom", () => ({
  usePinchZoom: () => ({
    scale: 1,
    translateX: 0,
    translateY: 0,
    onTouchStart: pinchTouchStartMock,
    onTouchMove: vi.fn(),
    onTouchEnd: pinchTouchEndMock,
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

function singleTap(x: number, y: number) {
  dispatch("touchstart", [{ clientX: x, clientY: y }]);
  dispatch("touchend", [], [{ clientX: x, clientY: y }]);
}

beforeEach(() => {
  vi.useFakeTimers();
  pinchTouchStartMock.mockClear();
  pinchTouchEndMock.mockClear();
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
  // post-render invocations.
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

describe("FullscreenImageViewer — 3+ finger system gestures", () => {
  it("does not forward 3-finger touchstart to the pinch-zoom hook", () => {
    // 3 fingers down all at once (e.g. Android screenshot swipe begins).
    dispatch("touchstart", [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
      { clientX: 300, clientY: 100 },
    ]);

    // The touch arbiter should bail before invoking the pinch handler —
    // 3 fingers is never a pinch and forwarding it would confuse the hook.
    expect(pinchTouchStartMock).not.toHaveBeenCalled();
  });

  it("3-finger swipe does not trigger double-tap zoom", async () => {
    // 3 fingers land.
    dispatch("touchstart", [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
      { clientX: 300, clientY: 100 },
    ]);
    // All 3 fingers lift simultaneously.
    dispatch("touchend", [], [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
      { clientX: 300, clientY: 100 },
    ]);

    // Even a fast follow-up tap right after the 3-finger gesture must NOT
    // pair into a double-tap.
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    singleTap(200, 100);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("4-finger swipe (iOS app switcher) is fully ignored", async () => {
    dispatch("touchstart", [
      { clientX: 50, clientY: 100 },
      { clientX: 150, clientY: 100 },
      { clientX: 250, clientY: 100 },
      { clientX: 350, clientY: 100 },
    ]);
    // Swipe motion — touchmove with 4 fingers.
    dispatch("touchmove", [
      { clientX: 50, clientY: 200 },
      { clientX: 150, clientY: 200 },
      { clientX: 250, clientY: 200 },
      { clientX: 350, clientY: 200 },
    ]);
    dispatch("touchend", [], [
      { clientX: 50, clientY: 200 },
      { clientX: 150, clientY: 200 },
      { clientX: 250, clientY: 200 },
      { clientX: 350, clientY: 200 },
    ]);

    await act(async () => {
      vi.advanceTimersByTime(60);
    });
    // A single tap right after the 4-finger gesture must NOT pair with the
    // multi-finger touchend as a "double-tap". The 4-finger sequence cleared
    // any pending tap candidate, so this tap can only arm a fresh candidate
    // — it cannot retroactively complete a pair.
    singleTap(200, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("gesture that escalates from 1 → 2 → 3 fingers mid-sequence is ignored", async () => {
    // One finger lands as a potential tap candidate.
    dispatch("touchstart", [{ clientX: 150, clientY: 150 }]);
    // Second finger joins — would normally be a pinch.
    dispatch("touchstart", [
      { clientX: 150, clientY: 150 },
      { clientX: 250, clientY: 150 },
    ]);
    // Third finger joins — promotes to a system gesture.
    dispatch("touchstart", [
      { clientX: 150, clientY: 150 },
      { clientX: 250, clientY: 150 },
      { clientX: 350, clientY: 150 },
    ]);
    dispatch("touchend", [], [
      { clientX: 150, clientY: 150 },
      { clientX: 250, clientY: 150 },
      { clientX: 350, clientY: 150 },
    ]);

    await act(async () => {
      vi.advanceTimersByTime(40);
    });
    singleTap(200, 200);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("React synthetic onDoubleClick is suppressed for 350ms after a 3-finger gesture", async () => {
    dispatch("touchstart", [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
      { clientX: 300, clientY: 100 },
    ]);
    dispatch("touchend", [], [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
      { clientX: 300, clientY: 100 },
    ]);

    // Within the suppression window — synthetic dblclick must be ignored.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    act(() => {
      getGestureRoot().dispatchEvent(
        new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
      );
    });
    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("after the suppression window expires, normal double-tap zoom is restored", async () => {
    // 3-finger gesture poisons the synthetic dblclick path.
    dispatch("touchstart", [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
      { clientX: 300, clientY: 100 },
    ]);
    dispatch("touchend", [], [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 100 },
      { clientX: 300, clientY: 100 },
    ]);

    // Wait past the 350ms suppression window.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });

    // Now a clean double-tap (two single-finger taps) must work again.
    singleTap(200, 200);
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    singleTap(201, 201);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });
});
