/**
 * Normalises the Capacitor Keyboard plugin's `keyboardHeight` to CSS px.
 *
 * On Android the plugin reports DEVICE pixels on many builds/OEM WebViews;
 * on iOS it reports points (== CSS px). Using the raw Android value in layout
 * math inflates offsets by ~devicePixelRatio×, which over-scrolls focused
 * inputs and leaves a huge blank gap between the input and the keyboard
 * (e.g. the Photos upload caption field).
 *
 * Heuristic mirrors `useNativeAndroidKeyboardState.computeHeight`: a raw
 * value above 60% of the window height cannot be a real CSS-px keyboard,
 * so it must be device px → divide by DPR. Result is clamped to 60% of the
 * window as a runaway guard (same ceiling used app-wide).
 */
export function resolveKeyboardCssHeight(
  rawHeight: number,
  windowHeight?: number,
  dpr?: number,
): number {
  const winH =
    windowHeight ?? (typeof window !== "undefined" ? window.innerHeight : 0);
  const ratio =
    dpr ??
    (typeof window !== "undefined" && window.devicePixelRatio > 0
      ? window.devicePixelRatio
      : 1);
  const raw = Number.isFinite(rawHeight) ? Math.max(0, rawHeight) : 0;

  if (winH <= 0) return Math.round(raw);

  const looksLikeDevicePx = raw > winH * 0.6;
  const cssPx = looksLikeDevicePx ? raw / ratio : raw;

  return Math.round(Math.max(0, Math.min(cssPx, winH * 0.6)));
}
