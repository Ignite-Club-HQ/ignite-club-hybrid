import { useEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useNativeIOSKeyboardState } from "@/hooks/useNativeIOSKeyboardState";
import { useNativeAndroidKeyboardState } from "@/hooks/useNativeAndroidKeyboardState";

const KEYBOARD_OPEN_THRESHOLD = 100;
const isNative = Capacitor.isNativePlatform();
const isNativeIOS = isNative && Capacitor.getPlatform() === "ios";
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

const isEditableTarget = (target: EventTarget | null) => {
  const element = target as HTMLElement | null;
  return !!element?.closest(
    "textarea, input:not([type='button']):not([type='checkbox']):not([type='file']):not([type='hidden']):not([type='radio']):not([type='reset']):not([type='submit']), [contenteditable='true']",
  );
};

/**
 * Detects soft keyboard visibility using native keyboard events when available,
 * otherwise falls back to visualViewport height changes.
 */
export function useKeyboardOpen(threshold = KEYBOARD_OPEN_THRESHOLD) {
  const { isKeyboardOpen: iosOpen, keyboardHeight: iosHeight } = useNativeIOSKeyboardState();
  const androidHeight = useNativeAndroidKeyboardState();
  const [fallbackOpen, setFallbackOpen] = useState(false);
  const [isEditableFocused, setIsEditableFocused] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined" || typeof document === "undefined") return;

    const syncFocusedEditable = () => {
      setIsEditableFocused(isEditableTarget(document.activeElement));
    };

    const handleFocusIn = (event: FocusEvent) => {
      setIsEditableFocused(isEditableTarget(event.target) || isEditableTarget(document.activeElement));
    };

    const handleFocusOut = () => {
      requestAnimationFrame(syncFocusedEditable);
    };

    syncFocusedEditable();
    window.addEventListener("focusin", handleFocusIn);
    window.addEventListener("focusout", handleFocusOut);
    window.addEventListener("blur", syncFocusedEditable);
    document.addEventListener("visibilitychange", syncFocusedEditable);

    return () => {
      window.removeEventListener("focusin", handleFocusIn);
      window.removeEventListener("focusout", handleFocusOut);
      window.removeEventListener("blur", syncFocusedEditable);
      document.removeEventListener("visibilitychange", syncFocusedEditable);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const vv = window.visualViewport;
    if (!vv) return;

    let baselineHeight = vv.height;

    const update = () => {
      if (vv.height > baselineHeight) {
        baselineHeight = vv.height;
      }
      setFallbackOpen(baselineHeight - vv.height > threshold);
    };

    update();
    vv.addEventListener("resize", update);

    return () => {
      vv.removeEventListener("resize", update);
    };
  }, [threshold]);

  // On native, trust Capacitor keyboard events as the sole source of truth.
  // Focusing an editable element does NOT mean the soft keyboard is up
  // (e.g. external keyboard, programmatic focus, popover trigger), and using
  // `isEditableFocused` here caused the BottomNav to vanish on pages with
  // any focused input (regression: Schedule page after closing the filter
  // popover, etc.).
  if (isNativeIOS) return iosOpen || iosHeight > threshold;
  if (isNativeAndroid) return androidHeight > threshold;
  // Web fallback: visualViewport shrink is authoritative; editable-focus is
  // only a last-resort signal when visualViewport isn't available.
  return fallbackOpen || (typeof window !== "undefined" && !window.visualViewport && isEditableFocused);
}

