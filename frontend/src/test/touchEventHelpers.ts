/**
 * Shared test helpers for synthesizing TouchEvent-like objects in jsdom.
 *
 * Why this module exists
 * ----------------------
 * jsdom does not implement the `Touch` constructor or true `TouchEvent`
 * objects, so every gesture test in this repo previously hand-rolled the
 * same polyfill — creating a `new Event(type)` and stamping `touches` /
 * `changedTouches` onto it via `Object.defineProperty`. That worked, but:
 *
 *   • Each test file had a near-identical copy that drifted slightly.
 *   • New gesture tests had to discover the jsdom quirk from scratch.
 *   • Bugs in the polyfill (e.g. forgetting `cancelable: true`, which
 *     breaks `e.preventDefault()`-dependent component code) had to be
 *     fixed in N places.
 *
 * Centralizing the helpers here lets future gesture tests focus on the
 * gesture semantics, not the event-shape boilerplate. The helpers are
 * intentionally minimal — they implement only the surface area that the
 * production code reads (`touches`, `changedTouches`, `type`, `bubbles`,
 * `cancelable`, `preventDefault`). They do NOT try to be a full
 * TouchEvent polyfill.
 *
 * Conventions
 * -----------
 *   • All coordinates are CSS pixels. Tests should pick numbers far from
 *     the viewport edge so jsdom layout never affects gesture math.
 *   • `touches` describes fingers CURRENTLY on the screen.
 *     `changedTouches` describes fingers that triggered THIS event
 *     (the lifted finger on touchend, the new finger on touchstart, etc.).
 *     If you don't pass `changedTouches`, it defaults to `touches`,
 *     which matches the most common touchstart/touchmove case.
 *   • The helpers do not advance fake timers. Use `vi.advanceTimersByTime`
 *     wrapped in `act()` between events when you need time to pass.
 *
 * Example
 * -------
 *   import { dispatchTouch, getGestureRoot } from "@/test/touchEventHelpers";
 *
 *   beforeEach(() => { container = ...; root.render(<Viewer />); });
 *
 *   it("double-tap zooms", () => {
 *     const root = getGestureRoot(container);
 *     dispatchTouch(root, "touchstart", [{ clientX: 100, clientY: 100 }]);
 *     dispatchTouch(root, "touchend", [], [{ clientX: 100, clientY: 100 }]);
 *     // ...
 *   });
 */

import { act } from "react";

/** A single touch point. Only the fields the production code reads. */
export interface TouchPoint {
  clientX: number;
  clientY: number;
}

/**
 * Build a synthetic TouchEvent-like object that satisfies the surface
 * area the FullscreenImageViewer (and similar gesture components) read.
 *
 * The returned object is a real `Event` (so `dispatchEvent` works and
 * React's event system can handle it), with `touches` and
 * `changedTouches` defined as read-only properties.
 *
 * @param type            "touchstart" | "touchmove" | "touchend" | "touchcancel"
 * @param touches         Fingers currently on the screen.
 * @param changedTouches  Fingers that triggered this event. Defaults to
 *                        `touches` (the touchstart / touchmove case).
 *                        For touchend, pass the lifted finger here and
 *                        the remaining fingers (or `[]`) in `touches`.
 *
 * Notes
 *   • `cancelable: true` is REQUIRED so the production code's
 *     `e.preventDefault()` calls succeed — many gesture-suppression
 *     paths depend on this.
 *   • `bubbles: true` matches real browser TouchEvents and lets event
 *     delegation work if a test ever needs it.
 */
export function makeTouchEvent(
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  touches: TouchPoint[],
  changedTouches: TouchPoint[] = touches,
): Event {
  const ev = new Event(type, { bubbles: true, cancelable: true });
  // jsdom's Event doesn't expose `touches` / `changedTouches` — define
  // them as non-enumerable, non-writable own properties so production
  // code reads them just like a real browser TouchEvent.
  Object.defineProperty(ev, "touches", { value: touches });
  Object.defineProperty(ev, "changedTouches", { value: changedTouches });
  return ev;
}

/**
 * Convenience: get the element that the FullscreenImageViewer attaches
 * its native touch listeners to.
 *
 * The viewer is portalled to `document.body` (so it escapes parent chat
 * gesture handlers on iOS), so `container.firstElementChild` no longer
 * works. Instead we look for the viewer's fixed-inset overlay on body
 * and prefer one that is NOT inside the test's host container — that way
 * tests that wrap the viewer in a harness still find the right element.
 *
 * Other gesture components may need their own root selector — in that
 * case, dispatch directly on the relevant element instead of using
 * this helper.
 */
export function getGestureRoot(container: HTMLElement): HTMLElement {
  const candidates = Array.from(
    document.body.querySelectorAll<HTMLElement>("div.fixed.inset-0"),
  );
  // Prefer a viewer that lives OUTSIDE the test container (i.e. portalled).
  const portalled = candidates.find((el) => !container.contains(el));
  const root = portalled ?? candidates[0] ?? container.firstElementChild;
  if (!root) {
    throw new Error(
      "getGestureRoot: no viewer overlay found. Did the component render?",
    );
  }
  return root as HTMLElement;
}

/**
 * Dispatch a synthetic touch event on a target element, wrapped in
 * `act()` so React state updates flush before the next assertion.
 *
 * This is the standard entry point for gesture tests — most call sites
 * use this rather than `makeTouchEvent` directly.
 */
export function dispatchTouch(
  target: EventTarget,
  type: "touchstart" | "touchmove" | "touchend" | "touchcancel",
  touches: TouchPoint[],
  changedTouches?: TouchPoint[],
): void {
  act(() => {
    target.dispatchEvent(makeTouchEvent(type, touches, changedTouches));
  });
}

/**
 * Advance fake timers by `ms` inside an `act()` boundary so any
 * setTimeout-driven state updates (e.g. the viewer's snap-back animation
 * end) flush before the next assertion.
 *
 * Only useful when the surrounding test has called `vi.useFakeTimers()`.
 */
export async function advanceFakeTimers(ms: number): Promise<void> {
  // Imported lazily so this module doesn't force vitest as a runtime dep
  // on consumers that only need `makeTouchEvent`.
  const { vi } = await import("vitest");
  await act(async () => {
    vi.advanceTimersByTime(ms);
  });
}
