import "@testing-library/jest-dom/vitest";

// ────────────────────────────────────────────────────────────────────────────
// React test environment
// ────────────────────────────────────────────────────────────────────────────
// Tell React we're in a test environment so act() warnings are properly handled.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// ────────────────────────────────────────────────────────────────────────────
// matchMedia stub (existing) — many UI components query it on mount.
// ────────────────────────────────────────────────────────────────────────────
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});

// ────────────────────────────────────────────────────────────────────────────
// jsdom touch-event fidelity for iOS-like gesture tests
// ────────────────────────────────────────────────────────────────────────────
// jsdom does not implement TouchEvent. Our gesture tests synthesize touch
// events with Object.defineProperty on plain Events, but third-party code
// (and future tests) often uses `instanceof TouchEvent` checks. Provide a
// minimal global so those checks don't blow up.
if (typeof (globalThis as unknown as { TouchEvent?: unknown }).TouchEvent === "undefined") {
  class TouchEventPolyfill extends Event {
    touches: ReadonlyArray<unknown>;
    targetTouches: ReadonlyArray<unknown>;
    changedTouches: ReadonlyArray<unknown>;
    constructor(type: string, init: TouchEventInit = {}) {
      super(type, init);
      this.touches = init.touches ?? [];
      this.targetTouches = init.targetTouches ?? [];
      this.changedTouches = init.changedTouches ?? [];
    }
  }
  (globalThis as unknown as { TouchEvent: typeof TouchEventPolyfill }).TouchEvent =
    TouchEventPolyfill;
}

// Some user-agent feature checks gate touch handling on `'ontouchstart' in
// window`. Pin it true so we always exercise the iOS gesture path.
if (!("ontouchstart" in window)) {
  Object.defineProperty(window, "ontouchstart", {
    value: null,
    writable: true,
    configurable: true,
  });
}

// ────────────────────────────────────────────────────────────────────────────
// requestAnimationFrame backed by setTimeout so vi.useFakeTimers() controls
// it. jsdom's default RAF runs on the macrotask queue at indeterminate times,
// which makes any test that schedules a frame after a touchend flaky.
// ────────────────────────────────────────────────────────────────────────────
const FRAME_MS = 16;
globalThis.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
  return setTimeout(() => cb(performance.now()), FRAME_MS) as unknown as number;
}) as typeof requestAnimationFrame;

globalThis.cancelAnimationFrame = ((id: number): void => {
  clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
}) as typeof cancelAnimationFrame;

// ────────────────────────────────────────────────────────────────────────────
// performance.now() — keep in lockstep with Date.now() so fake-timer advances
// also move performance time. Without this, RAF callbacks see real wall-clock
// timestamps even under fake timers.
// ────────────────────────────────────────────────────────────────────────────
if (typeof globalThis.performance === "undefined") {
  (globalThis as unknown as { performance: Performance }).performance = {
    now: () => Date.now(),
  } as Performance;
} else {
  // Replace .now() unconditionally so it tracks the (possibly faked) Date.
  globalThis.performance.now = () => Date.now();
}
