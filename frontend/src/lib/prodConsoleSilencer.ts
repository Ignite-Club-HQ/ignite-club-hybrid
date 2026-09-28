/**
 * Production console silencer.
 *
 * In production builds, `console.log` and `console.debug` calls become no-ops.
 * We keep `console.warn`, `console.error`, and `console.info` intact so real
 * problems still surface in browser consoles, Sentry-style aggregators, and
 * Android Logcat / iOS Console.
 *
 * Why: hot-path logs (e.g. `[ClubTheme]`, `[SYNC]`, `[NativePush]`,
 * `[AppLayout] Profile state`) fire dozens of times per second on Android
 * WebViews, where each log synchronously bridges to Logcat. That bridge is
 * a measurable source of jank during initial load and theme/auth transitions.
 *
 * Dev builds (`import.meta.env.DEV === true`) are unaffected — full logging
 * remains for local debugging.
 *
 * This module has side effects on import. Import it once, as early as possible,
 * from `main.tsx` BEFORE any other module that might log on evaluation.
 */
if (!import.meta.env.DEV) {
  const noop = () => {};

  // Preserve original references in case anything downstream wants to opt-in
  // to verbose logging for a specific debug session.
  const original = {
    log: console.log.bind(console),
    debug: console.debug.bind(console),
  };

  // Expose escape hatches for emergency debugging in production:
  //   window.__enableConsoleLogs() – restore noisy logs
  //   window.__disableConsoleLogs() – mute again (default)
  (window as unknown as Record<string, unknown>).__enableConsoleLogs = () => {
    console.log = original.log;
    console.debug = original.debug;
  };
  (window as unknown as Record<string, unknown>).__disableConsoleLogs = () => {
    console.log = noop;
    console.debug = noop;
  };

  console.log = noop;
  console.debug = noop;
}

export {};
