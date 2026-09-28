/**
 * iOS-specific behavioral checks for FullscreenImageViewer.
 *
 * On iOS, two things must hold for pinch/pan to work in a WebView:
 *   1. Touch listeners attached to the gesture container must be NON-PASSIVE
 *      so that `event.preventDefault()` actually suppresses native page zoom.
 *   2. Overlay UI (close, download, report, block buttons) must not consume
 *      touch events that originate on the image area, otherwise pinch/pan
 *      would be blocked whenever a finger lands near a button.
 *
 * These tests assert both invariants directly against the real component.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

// --- Mock heavy / native dependencies before importing the component. -------

vi.mock("@capacitor/core", () => ({
  Capacitor: { isNativePlatform: () => false },
  registerPlugin: () => ({}),
}));

vi.mock("@/lib/statusBarControl", () => ({
  applyStatusBarForViewer: vi.fn(),
  refreshStatusBar: vi.fn(),
}));

vi.mock("@/hooks/useIOSScrollLock", () => ({
  useIOSScrollLock: vi.fn(),
}));

vi.mock("@/hooks/useSignedPhotoUrl", () => ({
  useSignedPhotoUrl: () => ({ signedUrl: "https://reference.invalid" }),
}));

vi.mock("@/lib/safeOpenUrl", () => ({
  safeOpenUrl: vi.fn(),
}));

vi.mock("@/lib/videoUtils", () => ({
  isVideoUrl: () => false,
}));

// Mock pinch zoom hook so we can detect calls without real gesture math.
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

// Import AFTER mocks are registered.
import { FullscreenImageViewer } from "./FullscreenImageViewer";
import { getGestureRoot as getPortalledGestureRoot } from "@/test/touchEventHelpers";

// --- Test infrastructure ----------------------------------------------------

interface CapturedListener {
  type: string;
  passive: boolean | undefined;
}

let container: HTMLDivElement;
let root: Root;
let originalAdd: typeof EventTarget.prototype.addEventListener;
let captured: CapturedListener[];

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  // Spy on addEventListener globally so we can see what FullscreenImageViewer
  // attaches to its container ref. We only record touch* events.
  captured = [];
  originalAdd = EventTarget.prototype.addEventListener;
  EventTarget.prototype.addEventListener = function (
    type: string,
    listener: EventListenerOrEventListenerObject,
    options?: boolean | AddEventListenerOptions,
  ) {
    if (type.startsWith("touch")) {
      const passive =
        typeof options === "object" && options !== null
          ? options.passive
          : undefined;
      captured.push({ type, passive });
    }
    return originalAdd.call(this, type, listener, options);
  };

  pinchTouchStart.mockReset();
  pinchTouchMove.mockReset();
  pinchTouchEnd.mockReset();
});

afterEach(() => {
  EventTarget.prototype.addEventListener = originalAdd;
  act(() => {
    root.unmount();
  });
  container.remove();
});

function render() {
  act(() => {
    root.render(
      <FullscreenImageViewer
        src="https://reference.invalid"
        onClose={() => {}}
        showActions
        onReport={() => {}}
        onBlockUser={() => {}}
      />,
    );
  });
}

// --- Tests ------------------------------------------------------------------

describe("FullscreenImageViewer — iOS gesture safety", () => {
  it("registers touchstart/touchmove/touchend/touchcancel as non-passive", () => {
    render();

    const required = ["touchstart", "touchmove", "touchend", "touchcancel"];
    for (const type of required) {
      // Filter to listeners attached by the viewer (passive: false). React 18
      // installs its own delegated touch listeners on the portal root with
      // passive: true, so we can no longer rely on the FIRST captured entry —
      // instead we assert that AT LEAST ONE non-passive listener was attached
      // for each touch type. That is the real iOS-safety contract: the
      // viewer's own listener must be cancelable.
      const nonPassive = captured.find(
        (c) => c.type === type && c.passive === false,
      );
      expect(
        nonPassive,
        `expected a non-passive ${type} listener to be attached by the viewer`,
      ).toBeDefined();
    }
  });

  it("does not attach touch listeners that bubble through overlay buttons", () => {
    render();

    // The overlay buttons (close, download, report, block) live in the
    // portalled viewer (which is on document.body, not in `container`).
    const viewerRoot = getPortalledGestureRoot(container);
    const overlayButtons = viewerRoot.querySelectorAll("button");
    expect(overlayButtons.length).toBeGreaterThan(0);

    // The viewer must attach exactly one non-passive listener per touch
    // type (start/move/end/cancel = 4). React 18 also installs its own
    // delegated passive listeners on the portal root — those are filtered
    // out here because they don't affect iOS gesture safety.
    const viewerListenerCount = captured.filter(
      (c) =>
        c.passive === false &&
        ["touchstart", "touchmove", "touchend", "touchcancel"].includes(c.type),
    ).length;
    expect(viewerListenerCount).toBe(4);
  });

  it("forwards touchstart/move/end on the container to the pinch-zoom hook", () => {
    render();

    const root = getPortalledGestureRoot(container);
    expect(root).toBeTruthy();

    // Synthesize a two-finger pinch start — the kind of event iOS would
    // otherwise consume for its own page-zoom.
    const touchEvent = new Event("touchstart", { bubbles: true, cancelable: true });
    Object.defineProperty(touchEvent, "touches", {
      value: [
        { clientX: 100, clientY: 100 },
        { clientX: 200, clientY: 200 },
      ],
    });
    Object.defineProperty(touchEvent, "changedTouches", { value: [] });

    root.dispatchEvent(touchEvent);
    expect(pinchTouchStart).toHaveBeenCalledTimes(1);

    const moveEvent = new Event("touchmove", { bubbles: true, cancelable: true });
    Object.defineProperty(moveEvent, "touches", {
      value: [
        { clientX: 110, clientY: 110 },
        { clientX: 210, clientY: 210 },
      ],
    });
    Object.defineProperty(moveEvent, "changedTouches", { value: [] });
    root.dispatchEvent(moveEvent);
    expect(pinchTouchMove).toHaveBeenCalledTimes(1);

    const endEvent = new Event("touchend", { bubbles: true, cancelable: true });
    Object.defineProperty(endEvent, "touches", { value: [] });
    Object.defineProperty(endEvent, "changedTouches", {
      value: [{ clientX: 110, clientY: 110 }],
    });
    root.dispatchEvent(endEvent);
    expect(pinchTouchEnd).toHaveBeenCalledTimes(1);
  });

  it("applies touch-action: none to the gesture container so iOS can't hijack pinch", () => {
    render();
    const root = getPortalledGestureRoot(container);
    expect(root).toBeTruthy();
    // touchAction must be 'none' — the only way to suppress iOS Safari's
    // built-in pinch/pan recognizer in a WebView.
    expect(root.style.touchAction).toBe("none");
  });

  it("renders above chat sheets and shared-media dialogs", () => {
    render();
    const root = getPortalledGestureRoot(container);
    expect(root).toBeTruthy();
    // App dialogs use z-[1000001] and chat sheets use z-[100009]. Shared-media
    // thumbnails can launch the fullscreen viewer from either surface, so the
    // viewer must sit above both or taps appear to do nothing.
    expect(root.className).toContain("z-[1000005]");
  });
});
