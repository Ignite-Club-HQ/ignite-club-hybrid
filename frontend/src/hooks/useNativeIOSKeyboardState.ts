import { useLayoutEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

const isNativeIOS =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

/**
 * Shared native iOS keyboard state.
 *
 * Prefers Capacitor keyboard events (most reliable in WKWebView) and falls back
 * to visualViewport deltas for extra resilience during keyboard transitions.
 */
export function useNativeIOSKeyboardState() {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const baselineRef = useRef(0);
  const pluginHeightRef = useRef(0);
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    if (!isNativeIOS) return;

    const vv = window.visualViewport;
    baselineRef.current = vv?.height ?? window.innerHeight ?? 0;

    const applyKeyboardHeight = (nextHeight: number) => {
      const roundedHeight = Math.max(0, Math.round(nextHeight));
      setKeyboardHeight((currentHeight) =>
        currentHeight === roundedHeight ? currentHeight : roundedHeight,
      );
    };

    const syncFromViewport = () => {
      if (!vv) return;

      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        if (vv.height > baselineRef.current) {
          baselineRef.current = vv.height;
        }

        const viewportDiff = Math.max(0, baselineRef.current - vv.height);
        const nextHeight = pluginHeightRef.current > 0
          ? Math.max(pluginHeightRef.current, viewportDiff)
          : viewportDiff;

        applyKeyboardHeight(nextHeight);
      });
    };

    syncFromViewport();

    let keyboardWillShowHandle: { remove: () => void } | undefined;
    let keyboardDidShowHandle: { remove: () => void } | undefined;
    let keyboardWillHideHandle: { remove: () => void } | undefined;
    let keyboardDidHideHandle: { remove: () => void } | undefined;

    const handleKeyboardShow = ({ keyboardHeight: nextHeight }: { keyboardHeight: number }) => {
      pluginHeightRef.current = Math.max(0, nextHeight || 0);
      applyKeyboardHeight(pluginHeightRef.current);
    };

    const handleKeyboardHide = () => {
      pluginHeightRef.current = 0;
      applyKeyboardHeight(0);

      const nextBaseline = window.visualViewport?.height ?? window.innerHeight ?? 0;
      if (nextBaseline > 0) {
        baselineRef.current = nextBaseline;
      }
    };

    Keyboard.addListener("keyboardWillShow", handleKeyboardShow).then((handle) => {
      keyboardWillShowHandle = handle;
    }).catch(() => {});

    Keyboard.addListener("keyboardDidShow", handleKeyboardShow).then((handle) => {
      keyboardDidShowHandle = handle;
    }).catch(() => {});

    Keyboard.addListener("keyboardWillHide", handleKeyboardHide).then((handle) => {
      keyboardWillHideHandle = handle;
    }).catch(() => {});

    Keyboard.addListener("keyboardDidHide", handleKeyboardHide).then((handle) => {
      keyboardDidHideHandle = handle;
    }).catch(() => {});

    vv?.addEventListener("resize", syncFromViewport);

    return () => {
      vv?.removeEventListener("resize", syncFromViewport);
      keyboardWillShowHandle?.remove();
      keyboardDidShowHandle?.remove();
      keyboardWillHideHandle?.remove();
      keyboardDidHideHandle?.remove();
      cancelAnimationFrame(rafRef.current);
    };
  }, []);

  return {
    keyboardHeight: isNativeIOS ? keyboardHeight : 0,
    isKeyboardOpen: isNativeIOS ? keyboardHeight > 0 : false,
  };
}
