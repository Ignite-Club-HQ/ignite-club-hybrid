import { useLayoutEffect, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { useNativeKeyboardHeight } from "@/hooks/useNativeKeyboardHeight";

const isNative = Capacitor.isNativePlatform();
const isNativeAndroid = isNative && Capacitor.getPlatform() === "android";

const readRootPx = (name: string) => {
  if (typeof window === "undefined" || typeof document === "undefined") return 0;
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
  const parsed = Number.parseFloat(raw);
  return Number.isFinite(parsed) ? parsed : 0;
};

function computeAndroidFixedBottomInset(totalKeyboardHeight: number) {
  if (typeof window === "undefined" || totalKeyboardHeight <= 0) return 0;

  const currentLayoutHeight = window.innerHeight || 0;
  const lockedLayoutHeight = readRootPx("--visual-vh");
  const baselineHeight = Math.max(lockedLayoutHeight, currentLayoutHeight);
  const webViewResizedBy = Math.max(0, baselineHeight - currentLayoutHeight);

  let bottomInset = Math.max(0, totalKeyboardHeight - webViewResizedBy);

  const vv = window.visualViewport;
  if (vv && currentLayoutHeight > 0) {
    const visualOverlayInset = Math.max(0, currentLayoutHeight - vv.height);
    if (visualOverlayInset > 24) {
      bottomInset = Math.min(bottomInset, visualOverlayInset);
    }
  }

  return Math.round(Math.min(totalKeyboardHeight, bottomInset));
}

/**
 * Bottom offset for fixed UI that must sit on top of the soft keyboard.
 *
 * Android needs this separated from `useNativeKeyboardHeight()`: chat layout
 * must subtract the total IME-hidden region from the locked app viewport, but
 * fixed composers only need the remaining overlay amount after any OEM WebView
 * resize has already moved the fixed viewport above part/all of the keyboard.
 */
export function useNativeKeyboardBottomInset(): number {
  const nativeKeyboardHeight = useNativeKeyboardHeight();
  const [androidInset, setAndroidInset] = useState(0);

  useLayoutEffect(() => {
    if (!isNativeAndroid) return;

    const sync = () => {
      const next = computeAndroidFixedBottomInset(nativeKeyboardHeight);
      setAndroidInset((current) => (current === next ? current : next));
    };

    sync();
    window.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("resize", sync);
    window.visualViewport?.addEventListener("scroll", sync);

    return () => {
      window.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("resize", sync);
      window.visualViewport?.removeEventListener("scroll", sync);
    };
  }, [nativeKeyboardHeight]);

  if (isNativeAndroid) return androidInset;
  return nativeKeyboardHeight;
}