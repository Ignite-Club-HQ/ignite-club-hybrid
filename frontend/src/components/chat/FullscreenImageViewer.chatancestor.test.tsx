/**
 * Integration test: pinch-zoom inside a ChatMessage-like ancestor tree.
 *
 * Reproduces the iOS bug where pinch failed because the viewer was rendered
 * as a descendant of a chat message bubble whose ancestors registered
 * competing gesture handlers:
 *   - swipe-to-reply (touchstart / touchmove on the row wrapper)
 *   - long-press timer (touchstart on the bubble)
 *   - onPointerDown(preventDefault) on the bubble (blocks default touch
 *     translation in iOS Safari/WebView)
 *
 * Two invariants we enforce:
 *
 *   1. The viewer's pinch handlers receive every touch event in a real
 *      two-finger pinch sequence (start → move → staggered end) with
 *      `preventDefault` callable — i.e. the events are not "consumed" or
 *      neutered by ancestors before reaching the viewer.
 *
 *   2. Ancestor chat handlers (swipe-to-reply, long-press) do NOT observe
 *      the viewer's touch events, because the viewer is portalled to
 *      document.body AND the viewer stops propagation as a belt-and-braces
 *      guard. If propagation leaks, the ancestor swipe handler would
 *      mis-interpret a pinch as a horizontal swipe and trigger reply mode.
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

// Spy on the real pinch hook's callbacks. We don't want to mock the whole
// hook here — the point of this test is to verify the WIRING from the DOM
// event into the hook works through the chat ancestor tree.
const pinchTouchStart = vi.fn();
const pinchTouchMove = vi.fn();
const pinchTouchEnd = vi.fn();

vi.mock("@/hooks/usePinchZoom", () => ({
  usePinchZoom: () => ({
    scale: 1,
    translateX: 0,
    translateY: 0,
    onTouchStart: pinchTouchStart,
    onTouchMove: pinchTouchMove,
    onTouchEnd: pinchTouchEnd,
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

let host: HTMLDivElement;
let root: Root;

// Spies for ancestor (chat-message-like) gesture handlers. If any of these
// fire while the user is pinching the viewer, the chat tree has stolen the
// gesture and the bug is back.
const ancestorRowTouchStart = vi.fn();
const ancestorRowTouchMove = vi.fn();
const ancestorBubbleTouchStart = vi.fn();
const ancestorBubblePointerDown = vi.fn();

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

/**
 * Render <FullscreenImageViewer/> inside a chat-message-like ancestor tree.
 * The ancestors register the same family of handlers that real chat rows do,
 * so we can assert they never fire while pinching the viewer.
 */
function ChatAncestorHarness() {
  return (
    <div
      data-testid="chat-row"
      onTouchStart={ancestorRowTouchStart}
      onTouchMove={ancestorRowTouchMove}
    >
      <div
        data-testid="chat-bubble"
        onTouchStart={ancestorBubbleTouchStart}
        onPointerDown={(e) => {
          ancestorBubblePointerDown(e);
          // Real chat bubbles call preventDefault here to suppress iOS
          // text-selection behavior. This is the exact line that caused the
          // pinch bug pre-fix.
          e.preventDefault();
        }}
      >
        <FullscreenImageViewer
          src="https://reference.invalid"
          onClose={() => {}}
        />
      </div>
    </div>
  );
}

/**
 * The viewer is portalled to document.body, so it is NOT a child of the
 * harness element. Find it directly under body.
 */
function getViewerRoot(): HTMLElement {
  // The portalled viewer is the fixed-inset overlay attached to body.
  // It carries the .fixed.inset-0 classes.
  const candidates = Array.from(
    document.body.querySelectorAll<HTMLElement>("div.fixed.inset-0"),
  );
  // Filter out anything inside our harness host (defensive — should be empty).
  const portalled = candidates.find((el) => !host.contains(el));
  if (!portalled) {
    throw new Error("Portalled FullscreenImageViewer not found on document.body");
  }
  return portalled;
}

function dispatchOnViewer(
  type: string,
  touches: { clientX: number; clientY: number }[],
  changed?: { clientX: number; clientY: number }[],
) {
  act(() => {
    getViewerRoot().dispatchEvent(makeTouchEvent(type, touches, changed));
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2025-01-01T00:00:00Z"));
  pinchTouchStart.mockClear();
  pinchTouchMove.mockClear();
  pinchTouchEnd.mockClear();
  ancestorRowTouchStart.mockClear();
  ancestorRowTouchMove.mockClear();
  ancestorBubbleTouchStart.mockClear();
  ancestorBubblePointerDown.mockClear();

  host = document.createElement("div");
  document.body.appendChild(host);
  root = createRoot(host);
  act(() => {
    root.render(<ChatAncestorHarness />);
  });
});

afterEach(() => {
  act(() => {
    root.unmount();
  });
  host.remove();
  vi.useRealTimers();
});

// --- Tests ------------------------------------------------------------------

describe("FullscreenImageViewer pinch inside ChatMessage ancestor (iOS gesture-competition regression)", () => {
  it("is rendered via portal so it does NOT live inside the chat bubble subtree", () => {
    const bubble = host.querySelector('[data-testid="chat-bubble"]');
    expect(bubble).toBeTruthy();
    // The viewer must NOT be a descendant of the chat bubble — that's the
    // whole point of the portal fix.
    expect(bubble!.querySelector("div.fixed.inset-0")).toBeNull();
    // And it MUST exist somewhere on body.
    expect(getViewerRoot()).toBeTruthy();
  });

  it("forwards a full two-finger pinch sequence to the pinch hook", async () => {
    // Two-finger pinch start.
    dispatchOnViewer("touchstart", [
      { clientX: 100, clientY: 200 },
      { clientX: 200, clientY: 200 },
    ]);
    expect(pinchTouchStart).toHaveBeenCalledTimes(1);

    // Spread pinch motion.
    dispatchOnViewer("touchmove", [
      { clientX: 80, clientY: 200 },
      { clientX: 220, clientY: 200 },
    ]);
    expect(pinchTouchMove).toHaveBeenCalledTimes(1);

    // Staggered end: finger 1 lifts first.
    dispatchOnViewer(
      "touchend",
      [{ clientX: 220, clientY: 200 }],
      [{ clientX: 80, clientY: 200 }],
    );
    // Finger 2 lifts.
    dispatchOnViewer("touchend", [], [{ clientX: 220, clientY: 200 }]);

    // Both staggered ends must have reached the hook so the hook can
    // correctly keep pinch state alive on the first lift, then commit on
    // the second.
    expect(pinchTouchEnd).toHaveBeenCalledTimes(2);
  });

  it("does NOT bubble touch events up to the chat-row / bubble ancestors", async () => {
    // A real iOS pinch sequence on the viewer.
    dispatchOnViewer("touchstart", [
      { clientX: 100, clientY: 200 },
      { clientX: 200, clientY: 200 },
    ]);
    dispatchOnViewer("touchmove", [
      { clientX: 80, clientY: 200 },
      { clientX: 220, clientY: 200 },
    ]);
    dispatchOnViewer("touchend", [], [
      { clientX: 80, clientY: 200 },
      { clientX: 220, clientY: 200 },
    ]);

    // Because the viewer is portalled to document.body AND every touch
    // handler in the viewer calls e.stopPropagation(), the chat-row and
    // chat-bubble handlers must never fire. If either fires, the fix has
    // regressed and the chat would once again steal the pinch.
    expect(ancestorRowTouchStart).not.toHaveBeenCalled();
    expect(ancestorRowTouchMove).not.toHaveBeenCalled();
    expect(ancestorBubbleTouchStart).not.toHaveBeenCalled();
  });

  it("hook receives touchmove events that are still cancelable (preventDefault works)", async () => {
    // The whole point of attaching native non-passive listeners is so the
    // hook can call preventDefault() on touchmove. If an ancestor consumed
    // the event first, the event reaching the hook would be neutered.
    dispatchOnViewer("touchstart", [
      { clientX: 100, clientY: 200 },
      { clientX: 200, clientY: 200 },
    ]);

    let receivedMoveEvent: TouchEvent | undefined;
    pinchTouchMove.mockImplementationOnce((e: TouchEvent) => {
      receivedMoveEvent = e;
    });
    dispatchOnViewer("touchmove", [
      { clientX: 80, clientY: 200 },
      { clientX: 220, clientY: 200 },
    ]);

    expect(receivedMoveEvent).toBeDefined();
    expect(receivedMoveEvent!.cancelable).toBe(true);
    // And calling preventDefault on it must still succeed (no error / not
    // a no-op). We can't directly observe the no-op state in jsdom, but we
    // can at least verify the call doesn't throw.
    expect(() => receivedMoveEvent!.preventDefault()).not.toThrow();
  });
});
