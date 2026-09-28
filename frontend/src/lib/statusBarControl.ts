import { Capacitor } from '@capacitor/core';
import { StatusBar, Style } from '@capacitor/status-bar';

/**
 * Centralized status bar control with serial queue to prevent
 * interleaved async calls that cause icon color mismatches.
 *
 * Capacitor StatusBar Style semantics (per official plugin docs):
 *   Style.Dark  → "Light text for dark backgrounds"  (WHITE icons)
 *   Style.Light → "Dark text for light backgrounds"  (BLACK icons)
 *
 * So for our app:
 *   theme === 'dark'  → Style.Dark  (white icons on dark bg)
 *   theme === 'light' → Style.Light (dark icons on light bg)
 */

let pending: Promise<void> = Promise.resolve();
let lastAppliedTheme: 'light' | 'dark' | 'viewer' | null = null;

const LIGHT_BG = '#f5f7f6';
const DARK_BG = '#0f1512';
const VIEWER_BG = '#000000';

const getThemeSync = (): 'light' | 'dark' => {
  if (typeof window !== 'undefined' && typeof document !== 'undefined') {
    // Tailwind/next-themes uses the `dark` class. The `light` class is rarely
    // present, so DOM presence of `dark` is the most reliable signal.
    if (document.documentElement.classList.contains('dark')) return 'dark';
    if (document.documentElement.classList.contains('light')) return 'light';
    try {
      const stored = localStorage.getItem('app-theme');
      if (stored === 'dark' || stored === 'light') return stored;
    } catch {
      /* localStorage may be unavailable */
    }
  }
  return 'light';
};

/**
 * Apply status bar style for the given theme.
 * Calls are serialized so concurrent invocations never interleave.
 */
export const applyStatusBar = (theme?: 'light' | 'dark', force = false): void => {
  const resolved = theme ?? getThemeSync();

  // Enqueue – each call waits for the previous one to finish
  pending = pending
    .then(() => applyInternal(resolved, force))
    .catch((err) => console.warn('[StatusBar] queue error', err));
};

/**
 * Re-read the current theme from DOM and force-apply.
 * Useful after app resume or overlay unmount.
 */
export const refreshStatusBar = (): void => {
  // Force re-apply even if theme appears unchanged: native side may have
  // reset our settings (app resume, viewer unmount, orientation change).
  lastAppliedTheme = null;
  applyStatusBar(getThemeSync(), true);
};

/**
 * Apply dark status bar for fullscreen image/video viewers.
 * Goes through the serial queue to prevent interleaving.
 */
export const applyStatusBarForViewer = (): void => {
  pending = pending
    .then(() => applyViewerInternal())
    .catch((err) => console.warn('[StatusBar] viewer queue error', err));
};

// ── internal ────────────────────────────────────────────────
async function applyInternal(theme: 'light' | 'dark', force: boolean) {
  if (!Capacitor.isNativePlatform()) return;
  if (!force && lastAppliedTheme === theme) return;

  const platform = Capacitor.getPlatform();

  try {
    // Order matters on Android: toggling overlay or showing the bar can reset
    // the icon style. We therefore apply settings in this order:
    //   1. Make sure the bar is visible.
    //   2. Disable WebView overlay (so the bar has its own region).
    //   3. Set background color.
    //   4. Set icon style LAST so it sticks.
    await StatusBar.show().catch(() => {});

    if (platform === 'android') {
      // Disable overlay FIRST. Some Android WebView/OEM builds (notably
      // Samsung One UI) silently no-op the overlay toggle if it lands in
      // the same frame as a fresh viewer that set overlay=true — leaving
      // the system status bar painting over the app header until the
      // process is killed. We call it twice, with the bg/style apply
      // sandwiched between, so at least one call wins the race.
      await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
      await StatusBar.setBackgroundColor({
        color: theme === 'dark' ? DARK_BG : LIGHT_BG,
      }).catch(() => {});
    }

    await StatusBar.setStyle({
      style: theme === 'dark' ? Style.Dark : Style.Light,
    });

    if (platform === 'android') {
      // Second overlay-off pass — wins the race when the first was a no-op
      // (e.g. fired the same frame as a fullscreen viewer's overlay=true).
      await StatusBar.setOverlaysWebView({ overlay: false }).catch(() => {});
    }

    lastAppliedTheme = theme;
  } catch (error) {
    // If anything failed, clear the cache so the next call retries.
    lastAppliedTheme = null;
    console.warn('[StatusBar] Error configuring status bar:', error);
  }
}

// ── viewer (fullscreen black background) ────────────────────
async function applyViewerInternal() {
  if (!Capacitor.isNativePlatform()) return;

  const platform = Capacitor.getPlatform();

  try {
    await StatusBar.show().catch(() => {});

    if (platform === 'android') {
      // Overlay TRUE so the viewer paints under the bar (true fullscreen feel).
      await StatusBar.setOverlaysWebView({ overlay: true }).catch(() => {});
      await StatusBar.setBackgroundColor({ color: VIEWER_BG }).catch(() => {});
    }

    // White icons on the black viewer chrome.
    await StatusBar.setStyle({ style: Style.Dark });

    // Mark the cache as 'viewer' so the next theme-apply always re-runs.
    lastAppliedTheme = 'viewer';
  } catch (error) {
    lastAppliedTheme = null;
    console.warn('[StatusBar] Error configuring viewer status bar:', error);
  }
}
