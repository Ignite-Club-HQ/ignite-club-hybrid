/**
 * Double-tap behavior tests for FullscreenImageViewer.
 *
 * Simulates iOS-like touch sequences (touchstart → touchend pairs) and
 * verifies:
 *   1. Two quick single-finger taps within the threshold trigger a zoom
 *      toggle (transition animation kicks in on the <img>).
 *   2. Taps spaced too far apart in time do NOT trigger a toggle.
 *   3. A pinch (two-finger touch) suppresses double-tap so a follow-up tap
 *      can't pair with the pinch's release.
 *   4. A drag past the slop threshold suppresses double-tap.
 *   5. While zoomed, the snap-back animation uses the ease-out-back easing
 *      curve (the "settle" curve we install only on snap-back).
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

// Pinch zoom mock — we control scale/translate so we can test both the
// "zoom in" and "snap back" branches of triggerZoomToggle.
let mockScale = 1;
let mockTx = 0;
let mockTy = 0;
const onDoubleClickMock = vi.fn();
const resetZoomMock = vi.fn();

vi.mock("@/hooks/usePinchZoom", () => ({
  usePinchZoom: () => ({
    scale: mockScale,
    translateX: mockTx,
    translateY: mockTy,
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

function renderViewer() {
  act(() => {
    root.render(
      <FullscreenImageViewer
        src="https://reference.invalid"
        onClose={() => {}}
      />,
    );
  });
  // The component calls resetZoom() in a mount effect (whenever effectiveSrc
  // changes). Clear that initial call so the mock counts only reflect what
  // happens *after* render — i.e. our simulated taps.
  resetZoomMock.mockClear();
  onDoubleClickMock.mockClear();
}

interface TouchPoint {
  clientX: number;
  clientY: number;
}

// Touch-event polyfill is shared across gesture suites — see module docs.
import { makeTouchEvent, getGestureRoot as getPortalledGestureRoot } from "@/test/touchEventHelpers";

function getGestureRoot(): HTMLElement {
  return getPortalledGestureRoot(container);
}

function getImage(): HTMLImageElement {
  // Image lives in the portalled viewer overlay, not in the test container.
  const img = getGestureRoot().querySelector("img");
  if (!img) throw new Error("expected <img> in viewer");
  return img;
}

function tap(x: number, y: number) {
  const node = getGestureRoot();
  act(() => {
    node.dispatchEvent(makeTouchEvent("touchstart", [{ clientX: x, clientY: y }]));
    node.dispatchEvent(makeTouchEvent("touchend", [], [{ clientX: x, clientY: y }]));
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mockScale = 1;
  mockTx = 0;
  mockTy = 0;
  onDoubleClickMock.mockReset();
  resetZoomMock.mockReset();
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe("FullscreenImageViewer — double-tap detection", () => {
  it("two quick taps trigger the zoom-in toggle and apply a transition", () => {
    renderViewer();

    // First tap arms the lastTapRef; second tap within threshold fires toggle.
    tap(150, 200);
    tap(152, 198);

    // At 1× scale, triggerZoomToggle calls the pinch hook's onDoubleClick
    // (the "zoom in to 2.2×" branch).
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
    expect(resetZoomMock).not.toHaveBeenCalled();

    // The image should now have an active transform transition installed —
    // this is what makes the zoom feel smooth on iOS.
    const img = getImage();
    expect(img.style.transition).toMatch(/transform \d+ms cubic-bezier/);
  });

  it("taps spaced beyond the double-tap window do NOT trigger a toggle", async () => {
    vi.useFakeTimers();
    renderViewer();

    tap(100, 100);
    // Advance well past the 300ms double-tap window.
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    tap(100, 100);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("a pinch (two-finger touch) suppresses a follow-up double-tap", () => {
    renderViewer();
    const node = getGestureRoot();

    // Two-finger pinch sequence.
    act(() => {
      node.dispatchEvent(
        makeTouchEvent("touchstart", [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 200 },
        ]),
      );
      node.dispatchEvent(
        makeTouchEvent("touchend", [], [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 200 },
        ]),
      );
    });

    // A single tap right after pinch must not pair with anything — the
    // gesture arbiter should have cleared lastTapRef when a 2nd finger landed.
    tap(150, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("a drag past the slop threshold suppresses double-tap", () => {
    renderViewer();
    const node = getGestureRoot();

    // touchstart → touchmove (>10px) → touchend should NOT register a tap.
    act(() => {
      node.dispatchEvent(
        makeTouchEvent("touchstart", [{ clientX: 100, clientY: 100 }]),
      );
      node.dispatchEvent(
        makeTouchEvent("touchmove", [{ clientX: 140, clientY: 140 }]),
      );
      node.dispatchEvent(
        makeTouchEvent("touchend", [], [{ clientX: 140, clientY: 140 }]),
      );
    });

    // Now a clean tap arrives — it should arm the tap ref but the previous
    // drag-end must NOT have left a stale tap to pair with.
    tap(141, 141);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("double-tap while zoomed/panned snaps back with the ease-out-back curve", () => {
    // Simulate the post-zoom state coming from the pinch hook.
    mockScale = 2.2;
    mockTx = 80;
    mockTy = -40;

    renderViewer();

    tap(150, 150);
    tap(151, 151);

    // Snap-back path: resetZoom is called, the zoom-in path is NOT.
    expect(resetZoomMock).toHaveBeenCalledTimes(1);
    expect(onDoubleClickMock).not.toHaveBeenCalled();

    // The snap-back transition uses the "settle" curve cubic-bezier(0.22, 1, 0.36, 1)
    // — distinct from the zoom-in curve. This guards against the two branches
    // being accidentally collapsed in future refactors.
    const img = getImage();
    expect(img.style.transition).toContain("cubic-bezier(0.22, 1, 0.36, 1)");
  });
});

describe("FullscreenImageViewer — long-press gesture arbitration", () => {
  // A "long press" on iOS = finger down for ~600ms+ without significant
  // movement, then lifted. It must NOT pair with a subsequent tap as a
  // double-tap (the elapsed time exceeds the 300ms double-tap window) AND
  // must not block a real follow-up double-tap or pinch from working.

  it("a single long-press alone does not trigger zoom toggle", async () => {
    vi.useFakeTimers();
    renderViewer();
    const node = getGestureRoot();

    act(() => {
      node.dispatchEvent(makeTouchEvent("touchstart", [{ clientX: 150, clientY: 150 }]));
    });
    // Hold finger down for 700ms — well past the 300ms double-tap window.
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    act(() => {
      node.dispatchEvent(makeTouchEvent("touchend", [], [{ clientX: 150, clientY: 150 }]));
    });

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("a long-press followed by a quick tap does NOT register as double-tap", async () => {
    vi.useFakeTimers();
    renderViewer();
    const node = getGestureRoot();

    // Long press: hold ~600ms then release.
    act(() => {
      node.dispatchEvent(makeTouchEvent("touchstart", [{ clientX: 150, clientY: 150 }]));
    });
    await act(async () => {
      vi.advanceTimersByTime(600);
    });
    act(() => {
      node.dispatchEvent(makeTouchEvent("touchend", [], [{ clientX: 150, clientY: 150 }]));
    });

    // Immediately follow with a quick tap nearby. The first "tap" already
    // exceeded the 300ms window, so it should NOT pair with this one.
    await act(async () => {
      vi.advanceTimersByTime(50);
    });
    tap(151, 151);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("a long-press does not block a subsequent genuine double-tap", async () => {
    vi.useFakeTimers();
    renderViewer();
    const node = getGestureRoot();

    // Long press completes (the 1st "tap" of any potential pair is too old).
    act(() => {
      node.dispatchEvent(makeTouchEvent("touchstart", [{ clientX: 150, clientY: 150 }]));
    });
    await act(async () => {
      vi.advanceTimersByTime(700);
    });
    act(() => {
      node.dispatchEvent(makeTouchEvent("touchend", [], [{ clientX: 150, clientY: 150 }]));
    });

    // Small pause, then two quick taps that DO form a valid double-tap.
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    tap(150, 150);
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    tap(151, 151);

    // The double-tap must still fire — the long-press should not have
    // poisoned the gesture arbiter.
    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("a long-press that drifts past slop is treated as a drag, not a tap", async () => {
    vi.useFakeTimers();
    renderViewer();
    const node = getGestureRoot();

    act(() => {
      node.dispatchEvent(makeTouchEvent("touchstart", [{ clientX: 100, clientY: 100 }]));
    });
    await act(async () => {
      vi.advanceTimersByTime(500);
    });
    // Finger drifts > 10px slop while held.
    act(() => {
      node.dispatchEvent(makeTouchEvent("touchmove", [{ clientX: 130, clientY: 130 }]));
    });
    await act(async () => {
      vi.advanceTimersByTime(200);
    });
    act(() => {
      node.dispatchEvent(makeTouchEvent("touchend", [], [{ clientX: 130, clientY: 130 }]));
    });

    // Quick follow-up tap — must not pair (gesture was a drag, lastTapRef
    // should have been cleared).
    tap(131, 131);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("a long-press does not interfere with a subsequent pinch", async () => {
    vi.useFakeTimers();
    renderViewer();
    const node = getGestureRoot();

    // Long press, release.
    act(() => {
      node.dispatchEvent(makeTouchEvent("touchstart", [{ clientX: 150, clientY: 150 }]));
    });
    await act(async () => {
      vi.advanceTimersByTime(650);
    });
    act(() => {
      node.dispatchEvent(makeTouchEvent("touchend", [], [{ clientX: 150, clientY: 150 }]));
    });

    // Now the user starts a pinch. The 2nd finger landing must clear any
    // stale tap candidate so the pinch-end can't accidentally trigger a
    // zoom toggle.
    act(() => {
      node.dispatchEvent(
        makeTouchEvent("touchstart", [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 200 },
        ]),
      );
      node.dispatchEvent(
        makeTouchEvent("touchend", [], [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 200 },
        ]),
      );
    });

    // Single tap right after pinch — must not trigger toggle either.
    tap(150, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });
});

describe("FullscreenImageViewer — two-finger tap arbitration", () => {
  // A "two-finger tap" = both fingers down briefly, no movement, both lifted.
  // iOS apps sometimes treat this as a contextual gesture (e.g. zoom-out in
  // Maps). For our viewer it must:
  //   1. Never toggle zoom (it's not a double-tap, it's a multi-touch event).
  //   2. Clear any pending lastTapRef so a stale single-tap from before the
  //      two-finger tap can't pair with a tap that follows it.
  //   3. Not block subsequent legitimate double-taps from working.

  /** Two-finger touchstart immediately followed by two-finger touchend. */
  function twoFingerTap() {
    const node = getGestureRoot();
    act(() => {
      node.dispatchEvent(
        makeTouchEvent("touchstart", [
          { clientX: 100, clientY: 100 },
          { clientX: 200, clientY: 200 },
        ]),
      );
      // Both fingers lift simultaneously: touches=[] and changedTouches has 2.
      node.dispatchEvent(
        makeTouchEvent(
          "touchend",
          [],
          [
            { clientX: 100, clientY: 100 },
            { clientX: 200, clientY: 200 },
          ],
        ),
      );
    });
  }

  it("a two-finger tap alone does not toggle zoom", () => {
    renderViewer();
    twoFingerTap();

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("a two-finger tap clears a pending single-tap candidate", async () => {
    vi.useFakeTimers();
    renderViewer();

    // Arm a single-tap candidate.
    tap(150, 150);

    // A two-finger tap arrives shortly after — this must invalidate the
    // pending tap so the next single tap can NOT pair with it.
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    twoFingerTap();

    // A clean single tap right after — should NOT trigger zoom because the
    // two-finger tap cleared the previous candidate.
    await act(async () => {
      vi.advanceTimersByTime(80);
    });
    tap(150, 150);

    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });

  it("a two-finger tap does not block a subsequent legitimate double-tap", async () => {
    vi.useFakeTimers();
    renderViewer();

    twoFingerTap();

    // After a small pause, two clean single taps should still register.
    await act(async () => {
      vi.advanceTimersByTime(100);
    });
    tap(150, 150);
    await act(async () => {
      vi.advanceTimersByTime(120);
    });
    tap(151, 151);

    expect(onDoubleClickMock).toHaveBeenCalledTimes(1);
  });

  it("two two-finger taps in a row never produce a zoom toggle", () => {
    renderViewer();

    twoFingerTap();
    twoFingerTap();

    // Even though both events are "taps" in the loose sense, multi-touch
    // gestures must never satisfy the double-tap condition (which is strictly
    // single-finger).
    expect(onDoubleClickMock).not.toHaveBeenCalled();
    expect(resetZoomMock).not.toHaveBeenCalled();
  });
});
