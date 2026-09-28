import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";
import { Capacitor } from "@capacitor/core";

const isNative = Capacitor.isNativePlatform();
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

/**
 * Returns the current soft-keyboard height (in CSS px) on native platforms.
 *
 * IMPORTANT: do NOT add extra vvShrink / baseline math here. The underlying
 * `useNativeAndroidKeyboardState` hook already:
 *  - converts Capacitor's raw plugin height (sometimes device-px) to CSS px,
 *  - reconciles against `visualViewport.height` (the actual region above the
 *    IME) whenever the WebView shrinks despite `Keyboard.resize: 'none'`,
 *  - caps at 60% of `window.innerHeight` to avoid runaway values.
 *
 * A previous version of this file ran the SAME `vvShrink` subtraction a
 * SECOND time on the already-reconciled value. That double-processing
 * produced inverted/over-corrected insets that floated the fixed-position
 * chat composer mid-screen on Samsung/Xiaomi devices (Gboard configs that
 * partially shrink the visual viewport). Treat the per-platform hooks as
 * the single source of truth.
 */
export function useNativeKeyboardHeight(): number {
  const iosState = useNativeIOSKeyboardState();
  const androidHeight = useNativeAndroidKeyboardState();

  if (isNativeAndroid) return androidHeight;
  return iosState.keyboardHeight;
}
