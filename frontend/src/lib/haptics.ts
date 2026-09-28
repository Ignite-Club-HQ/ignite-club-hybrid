import { Capacitor } from "@capacitor/core";

/**
 * Cross-platform haptic feedback utility.
 * Uses Capacitor Haptics on native, falls back to navigator.vibrate on web.
 *
 * The Capacitor Haptics plugin is eagerly imported (top-level await via
 * a resolved-promise cache) so that the first long-press haptic never
 * silently fails due to a lazy-import race.
 */

type HapticsMod = typeof import("@capacitor/haptics");

let _mod: HapticsMod | null = null;
let _loading: Promise<HapticsMod> | null = null;

function getHaptics(): Promise<HapticsMod | null> {
  if (_mod) return Promise.resolve(_mod);
  if (!Capacitor.isNativePlatform()) return Promise.resolve(null);
  if (!_loading) {
    _loading = import("@capacitor/haptics").then((m) => {
      _mod = m;
      return m;
    });
  }
  return _loading;
}

// Kick off the import immediately so it's ready before first interaction
getHaptics();

let _loggedVibrate = false;
function vibrateFallback(ms: number) {
  try {
    if (typeof navigator === "undefined" || !navigator.vibrate) {
      if (!_loggedVibrate) {
        _loggedVibrate = true;
        console.info("[haptics] navigator.vibrate not supported on this browser/device");
      }
      return;
    }
    const ok = navigator.vibrate(ms);
    if (!_loggedVibrate) {
      _loggedVibrate = true;
      console.info(
        `[haptics] navigator.vibrate(${ms}) -> ${ok} (false = blocked by browser, e.g. cross-origin preview iframe or desktop)`,
      );
    }
  } catch (err) {
    if (!_loggedVibrate) {
      _loggedVibrate = true;
      console.info("[haptics] vibrate threw:", err);
    }
  }
}

/** Light haptic tap — long-press confirmation, emoji picker open, send */
export const hapticImpactLight = () => {
  if (_mod && Capacitor.isNativePlatform()) {
    _mod.Haptics.impact({ style: _mod.ImpactStyle.Light }).catch(() => {});
  } else if (Capacitor.isNativePlatform()) {
    getHaptics().then((m) => {
      if (m) m.Haptics.impact({ style: m.ImpactStyle.Light }).catch(() => {});
      else vibrateFallback(25);
    });
  } else {
    vibrateFallback(25);
  }
};

/** Medium haptic tap — action confirmation */
export const hapticImpactMedium = () => {
  if (_mod && Capacitor.isNativePlatform()) {
    _mod.Haptics.impact({ style: _mod.ImpactStyle.Medium }).catch(() => {});
  } else if (Capacitor.isNativePlatform()) {
    getHaptics().then((m) => {
      if (m) m.Haptics.impact({ style: m.ImpactStyle.Medium }).catch(() => {});
      else vibrateFallback(18);
    });
  } else {
    vibrateFallback(18);
  }
};

/** Tiny selection tick — short tap, swipe threshold */
export const hapticSelectionTick = () => {
  if (_mod && Capacitor.isNativePlatform()) {
    _mod.Haptics.selectionChanged().catch(() => {});
  } else if (Capacitor.isNativePlatform()) {
    getHaptics().then((m) => {
      if (m) m.Haptics.selectionChanged().catch(() => {});
      else vibrateFallback(6);
    });
  } else {
    vibrateFallback(6);
  }
};
