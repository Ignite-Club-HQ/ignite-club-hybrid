/**
 * Unit tests for the shared touch-event helpers. These exist mostly as a
 * regression net: if the jsdom polyfill ever stops behaving the way
 * gesture tests expect (e.g. `e.preventDefault()` becomes a no-op, or
 * `changedTouches` defaults wrong), every gesture suite breaks at once
 * with mysterious failures. Catching it here gives a clear root cause.
 */

import { describe, it, expect, vi } from "vitest";
import {
  makeTouchEvent,
  dispatchTouch,
  getGestureRoot,
} from "./touchEventHelpers";

describe("makeTouchEvent", () => {
  it("returns an Event of the requested type", () => {
    const ev = makeTouchEvent("touchstart", [{ clientX: 10, clientY: 20 }]);
    expect(ev).toBeInstanceOf(Event);
    expect(ev.type).toBe("touchstart");
  });

  it("exposes touches and changedTouches as readable own properties", () => {
    const touches = [{ clientX: 10, clientY: 20 }];
    const changed = [{ clientX: 30, clientY: 40 }];
    const ev = makeTouchEvent("touchend", touches, changed);
    expect((ev as unknown as TouchEvent).touches).toEqual(touches);
    expect((ev as unknown as TouchEvent).changedTouches).toEqual(changed);
  });

  it("defaults changedTouches to touches when omitted", () => {
    const touches = [{ clientX: 5, clientY: 5 }];
    const ev = makeTouchEvent("touchmove", touches);
    expect((ev as unknown as TouchEvent).changedTouches).toEqual(touches);
  });

  it("is cancelable so production preventDefault() calls succeed", () => {
    // CRITICAL invariant: gesture-suppression code in the viewer relies
    // on `e.preventDefault()`. If `cancelable` ever flips to false,
    // double-tap suppression silently breaks across every test.
    const ev = makeTouchEvent("touchstart", [{ clientX: 0, clientY: 0 }]);
    expect(ev.cancelable).toBe(true);
    ev.preventDefault();
    expect(ev.defaultPrevented).toBe(true);
  });

  it("is bubbling so event delegation works in tests that need it", () => {
    const ev = makeTouchEvent("touchstart", [{ clientX: 0, clientY: 0 }]);
    expect(ev.bubbles).toBe(true);
  });
});

describe("dispatchTouch", () => {
  it("delivers the synthetic event to the target's listener", () => {
    const target = document.createElement("div");
    const handler = vi.fn();
    target.addEventListener("touchstart", handler);
    dispatchTouch(target, "touchstart", [{ clientX: 1, clientY: 2 }]);
    expect(handler).toHaveBeenCalledTimes(1);
    const ev = handler.mock.calls[0][0] as TouchEvent;
    expect(ev.touches[0]).toEqual({ clientX: 1, clientY: 2 });
  });

  it("forwards changedTouches when provided", () => {
    const target = document.createElement("div");
    const handler = vi.fn();
    target.addEventListener("touchend", handler);
    dispatchTouch(
      target,
      "touchend",
      [],
      [{ clientX: 50, clientY: 60 }],
    );
    const ev = handler.mock.calls[0][0] as TouchEvent;
    expect(ev.touches.length).toBe(0);
    expect(ev.changedTouches[0]).toEqual({ clientX: 50, clientY: 60 });
  });
});

describe("getGestureRoot", () => {
  it("returns the first child of the container", () => {
    const container = document.createElement("div");
    const child = document.createElement("section");
    container.appendChild(child);
    expect(getGestureRoot(container)).toBe(child);
  });

  it("throws a clear error if the container is empty", () => {
    const container = document.createElement("div");
    expect(() => getGestureRoot(container)).toThrow(/no viewer overlay/);
  });
});
