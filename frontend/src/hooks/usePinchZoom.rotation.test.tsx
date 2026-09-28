/**
 * Rotation guard for usePinchZoom.
 *
 * On iOS, two-finger gestures often include unintended rotation as the user
 * regrips the screen. We must:
 *   1. Keep scaling responsive to pinch distance even while the user rotates.
 *   2. Suppress center-tracking pan once rotation crosses ~12° so the image
 *      doesn't drift sideways.
 *   3. Never start a single-finger pan while a two-finger pinch is active.
 *   4. Always preventDefault on two-finger touchmove to block iOS system
 *      page-zoom / rotation gestures.
 */

import { describe, it, expect } from "vitest";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { usePinchZoom } from "./usePinchZoom";

// Minimal hook host — we render once and capture the latest hook return value.
function mountHook<T>(hook: () => T): { current: T; unmount: () => void } {
  const ref = { current: undefined as unknown as T };
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  function Host() {
    ref.current = hook();
    return null;
  }
  act(() => {
    root.render(<Host />);
  });
  return {
    get current() {
      return ref.current;
    },
    unmount: () => {
      act(() => root.unmount());
      container.remove();
    },
  };
}

interface FakeTouch {
  clientX: number;
  clientY: number;
}

function makeTouchEvent(touches: FakeTouch[]): React.TouchEvent {
  let prevented = false;
  const evt = {
    touches,
    changedTouches: touches,
    preventDefault: () => {
      prevented = true;
    },
    get defaultPrevented() {
      return prevented;
    },
  };
  return evt as unknown as React.TouchEvent;
}

describe("usePinchZoom — two-finger rotation guard", () => {
  it("scales while the user rotates the gesture (rotation must not block pinch)", () => {
    const host = mountHook(() => usePinchZoom(1, 4));

    // Two fingers, ~100px apart, horizontal.
    const start = makeTouchEvent([
      { clientX: 100, clientY: 200 },
      { clientX: 200, clientY: 200 },
    ]);
    act(() => {
      host.current.onTouchStart(start);
    });

    // Spread fingers (200px apart) AND rotate ~45° relative to start.
    // Distance went from 100 → 200 → expect scale ~2.
    const move = makeTouchEvent([
      { clientX: 100, clientY: 200 },
      { clientX: 100 + Math.cos(Math.PI / 4) * 200, clientY: 200 + Math.sin(Math.PI / 4) * 200 },
    ]);
    act(() => {
      host.current.onTouchMove(move);
    });

    expect(host.current.scale).toBeGreaterThan(1.5);
    expect(host.current.scale).toBeLessThanOrEqual(4);

    host.unmount();
  });

  it("suppresses center-tracking pan once rotation exceeds ~12°", () => {
    const host = mountHook(() => usePinchZoom(1, 4));

    const start = makeTouchEvent([
      { clientX: 100, clientY: 200 },
      { clientX: 200, clientY: 200 },
    ]);
    act(() => host.current.onTouchStart(start));

    // Same distance (~100), but rotated ~30° AND midpoint shifted right by 80px.
    // Without the guard, translateX would jump by ~80. With the guard, the
    // rotation lock kicks in and translateX stays at 0.
    const cx = 180; // midpoint shifted right
    const cy = 200;
    const half = 50;
    const angle = (30 * Math.PI) / 180;
    const move = makeTouchEvent([
      { clientX: cx - Math.cos(angle) * half, clientY: cy - Math.sin(angle) * half },
      { clientX: cx + Math.cos(angle) * half, clientY: cy + Math.sin(angle) * half },
    ]);
    act(() => host.current.onTouchMove(move));

    // translateX must NOT have jumped by anywhere near 80px — rotation lock
    // suppresses center-tracking pan.
    expect(Math.abs(host.current.translateX)).toBeLessThan(10);
    expect(Math.abs(host.current.translateY)).toBeLessThan(10);

    host.unmount();
  });

  it("calls preventDefault on every two-finger touchmove (blocks iOS system gesture)", () => {
    const host = mountHook(() => usePinchZoom(1, 4));

    const start = makeTouchEvent([
      { clientX: 100, clientY: 200 },
      { clientX: 200, clientY: 200 },
    ]);
    act(() => host.current.onTouchStart(start));
    expect(start.defaultPrevented).toBe(true);

    // Even a pure-rotation move (no distance change) must be prevented.
    const angle = (20 * Math.PI) / 180;
    const move = makeTouchEvent([
      { clientX: 150 - Math.cos(angle) * 50, clientY: 200 - Math.sin(angle) * 50 },
      { clientX: 150 + Math.cos(angle) * 50, clientY: 200 + Math.sin(angle) * 50 },
    ]);
    act(() => host.current.onTouchMove(move));
    expect(move.defaultPrevented).toBe(true);

    host.unmount();
  });

  it("does not start a single-finger pan while a two-finger pinch is active", () => {
    const host = mountHook(() => usePinchZoom(1, 4));

    // First, zoom in so single-finger pan would normally be eligible.
    const pinchStart = makeTouchEvent([
      { clientX: 100, clientY: 200 },
      { clientX: 200, clientY: 200 },
    ]);
    act(() => host.current.onTouchStart(pinchStart));
    const pinchMove = makeTouchEvent([
      { clientX: 50, clientY: 200 },
      { clientX: 250, clientY: 200 },
    ]);
    act(() => host.current.onTouchMove(pinchMove));
    expect(host.current.scale).toBeGreaterThan(1);

    // While still pinching, simulate touch events with 1 finger reported
    // (e.g. one finger lifted briefly). The hook should NOT initiate a pan
    // until touchend fully resets the gesture.
    const xBefore = host.current.translateX;
    const ghostStart = makeTouchEvent([{ clientX: 500, clientY: 500 }]);
    act(() => host.current.onTouchStart(ghostStart));
    const ghostMove = makeTouchEvent([{ clientX: 800, clientY: 800 }]);
    act(() => host.current.onTouchMove(ghostMove));

    // translate must not have shifted by ~300px from a phantom pan.
    expect(Math.abs(host.current.translateX - xBefore)).toBeLessThan(20);

    host.unmount();
  });
});
