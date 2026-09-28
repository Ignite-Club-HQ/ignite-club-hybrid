/**
 * Integration test for mixed gesture sequences in FullscreenImageViewer.
 *
 * Real iOS users often perform compound gestures: a pinch followed by a quick
 * tap, a pinch with one finger lifting before the other, or a pinch ended by
 * a finger drag. In every case, the touchend that closes the multi-touch
 * sequence must NOT pair with a single-finger tap immediately after as a
 * double-tap. This file walks several realistic mixed-gesture scenarios and
 * asserts the zoom toggle stays suppressed.
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

// We track when the pinch-zoom hook reports it's mid-pinch so the component
// treats post-pinch taps as "not a clean tap" candidates.
let pinchActive = false;
const onDoubleClickMock = vi.fn();
const resetZoomMock = vi.fn();
const pinchTouchStartMock = vi.fn((e: React.TouchEvent) => {
  // Mimic the real hook: when 2+ fingers land, it's a pinch.
  if ((e as unknown as TouchEvent).touches.length >= 2) pinchActive = true;
});
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
    isPanningOrPinching: () => pinchActive,
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

function dispatch(type: "touchstart" | "touchmove" | "touchend" | "touchcancel", touches: { clientX: number; clientY: number }[], changed?: { clientX: number; clientY: number }[]) {
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
  pinchActive = false;
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
  // The component runs resetZoom() in its mount effect — clear so the test
  // assertions only count post-render calls.
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

describe("FullscreenImageViewer — mixed pinch + tap sequences", () => {
  it("pinch (start → end) immediately followed by a single tap does not toggle", async () => {
    // Two fingers down.
    dispatch("touchstart", [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 200 },
    ]);
    // Both fingers lift simultaneously (the pinch ends).
    dispatch("touchend", [], [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 200 },
    ]);
    pinchActive = false;

    // 50ms later, user taps once. This must NOT register as a double-tap
    // because the previous touchend was multi-finger, not a tap candidate.
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    singleTap(150, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("pinch where one finger lifts then the other, followed by a tap, does not toggle", async () => {
    // Two fingers land.
    dispatch("touchstart", [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 200 },
    ]);
    // First finger lifts — second still down. Component sees touches.length=1.
    dispatch(
      "touchend",
      [{ clientX: 200, clientY: 200 }],
      [{ clientX: 100, clientY: 100 }],
    );
    // Second finger lifts.
    dispatch("touchend", [], [{ clientX: 200, clientY: 200 }]);
    pinchActive = false;

    // Quick tap after the pinch ends. Must not pair into a double-tap.
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    singleTap(150, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("a tap then a pinch then a tap never produces a toggle", async () => {
    // Single tap arms a tap candidate.
    singleTap(150, 150);

    // Pinch immediately after — second finger landing must invalidate the
    // pending tap candidate so the post-pinch tap can't pair with it.
    await act(async () => {
      vi.advanceTimersByTime(40);
    });
    dispatch("touchstart", [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 200 },
    ]);
    dispatch("touchend", [], [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 200 },
    ]);
    pinchActive = false;

    // Final tap right after pinch — must NOT trigger zoom.
    await act(async () => {
      vi.advanceTimersByTime(40);
    });
    singleTap(150, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("rapid pinch → tap → pinch → tap loop never toggles zoom", async () => {
    for (let i = 0; i < 3; i++) {
      // Pinch.
      dispatch("touchstart", [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 200 },
      ]);
      dispatch("touchend", [], [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 200 },
      ]);
      pinchActive = false;

      // Tap.
      await act(async () => {
        vi.advanceTimersByTime(50);
      });
      singleTap(150, 150);

      await act(async () => {
        vi.advanceTimersByTime(50);
      });
    }

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("after a mixed sequence ends, a clean double-tap still works", async () => {
    // Pinch + tap.
    dispatch("touchstart", [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 200 },
    ]);
    dispatch("touchend", [], [
      { clientX: 100, clientY: 100 },
      { clientX: 200, clientY: 200 },
    ]);
    pinchActive = false;
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    singleTap(150, 150);

    // Pause, then perform a clean double-tap. This MUST work — the gesture
    // arbiter shouldn't permanently disable double-tap after a mixed sequence.
    await act(async () => {
      vi.advanceTimersByTime(400);
    });
    singleTap(150, 150);
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    singleTap(151, 151);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });
});
