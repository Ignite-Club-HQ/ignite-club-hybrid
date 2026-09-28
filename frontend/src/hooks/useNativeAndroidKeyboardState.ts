import { useLayoutEffect, useRef, useState } from "react";
import { Capacitor } from "@capacitor/core";
import { Keyboard } from "@capacitor/keyboard";

const isNativeAndroid =
  Capacitor.isNativePlatform() && Capacitor.getPlatform() === "android";

/**
 * Returns the current soft-keyboard height (in CSS px) on native Android.
 *
 * Since the Capacitor config uses `Keyboard.resize: 'none'`, the WebView
 * viewport does NOT shrink when the keyboard opens. We rely on Capacitor
 * keyboard plugin events to get the keyboard height and manually offset
 * chat layouts.
 */
export function useNativeAndroidKeyboardState(): number {
  const [keyboardHeight, setKeyboardHeight] = useState(0);
  const rafRef = useRef(0);

  useLayoutEffect(() => {
    if (!isNativeAndroid) return;

    let keyboardWillShowHandle: { remove: () => void } | undefined;
    let keyboardDidShowHandle: { remove: () => void } | undefined;
    let keyboardWillHideHandle: { remove: () => void } | undefined;
    let keyboardDidHideHandle: { remove: () => void } | undefined;

    // Track last reported plugin height so visualViewport-driven reconciliation
    // can run while the keyboard is open (e.g. Gboard toolbar toggle, emoji
    // panel, predictive bar appearing). Without this, the composer pins to a
    // stale show-time value and drifts mid-session.
    let pluginHeight = 0;
    let keyboardOpen = false;
    let baselineLayoutHeight = typeof window !== "undefined" ? window.innerHeight : 0;

    const readCssPx = (name: string) => {
      if (typeof window === "undefined" || typeof document === "undefined") return 0;
      const raw = window.getComputedStyle(document.documentElement).getPropertyValue(name);
      const parsed = Number.parseFloat(raw);
      return Number.isFinite(parsed) ? parsed : 0;
    };

    const getLayoutBaseline = () => {
      const current = typeof window !== "undefined" ? window.innerHeight : 0;
      const lockedVisual = readCssPx("--visual-vh");
      baselineLayoutHeight = Math.max(baselineLayoutHeight, current, lockedVisual);
      return baselineLayoutHeight;
    };

    const applyHeight = (nextHeight: number) => {
      const rounded = Math.max(0, Math.round(nextHeight));
      setKeyboardHeight((current) => (current === rounded ? current : rounded));
    };

    const computeHeight = (rawPluginHeight: number): number => {
      const dpr = typeof window !== "undefined" && window.devicePixelRatio > 0
        ? window.devicePixelRatio
        : 1;
      const layoutH = typeof window !== "undefined" ? window.innerHeight : 0;
      const baselineH = getLayoutBaseline();
      const raw = rawPluginHeight || 0;
      const looksLikeDevicePx = layoutH > 0 && raw > layoutH * 0.6;
      const pluginCssPx = looksLikeDevicePx ? raw / dpr : raw;

      // The Capacitor Keyboard plugin reports the actual IME height from
      // Android's InputMethodManager — this is the ground truth. Prefer it
      // whenever available.
      //
      // visualViewport may be used as a SECONDARY signal to detect keyboard
      // presence when the plugin hasn't fired (e.g. focus-in on an already-open
      // IME), but MUST NOT be used to inflate the height above the plugin's
      // report. Historically we set `finalHeight = baselineH - vv.height`
      // whenever that was > 24, which over-reported the keyboard by hundreds
      // of pixels whenever `baselineH` (monotonic-max innerHeight) had been
      // locked to a value larger than the current WebView (rotation history,
      // OEM WebView shrink, split-screen leftover). That collapsed the chat
      // shell to composer-only, leaving a huge blank strip between the
      // composer and the actual keyboard.
      let finalHeight = pluginCssPx;

      if (typeof window !== "undefined") {
        const vv = window.visualViewport;
        if (vv) {
          // Current overlay = keyboard portion that actually covers the
          // present WebView. This is the tightest upper bound we can trust,
          // because it never over-reports even if baseline drifted.
          const currentOverlay = layoutH > 0
            ? Math.max(0, layoutH - vv.height)
            : 0;

          if (finalHeight <= 0 && currentOverlay > 24) {
            // Plugin never reported (focus-in on already-open IME): fall back
            // to current overlay only.
            finalHeight = currentOverlay;
          } else if (currentOverlay > finalHeight + 24 && currentOverlay < baselineH * 0.6) {
            // Plugin under-reported vs actual overlay (Gboard toolbar,
            // predictive strip). Bump up to current overlay — still bounded
            // by the current WebView, so cannot inflate past reality.
            finalHeight = currentOverlay;
          }
        }
      }

      if (baselineH > 0) {
        finalHeight = Math.min(finalHeight, baselineH * 0.6);
      }
      return Math.max(0, finalHeight);
    };

    const reconcile = () => {
      if (!keyboardOpen) return;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        applyHeight(computeHeight(pluginHeight));
      });
    };

    // Hide → show blips: a focus hand-off between two editable controls (or a
    // WebView-internal IME restart) can surface as keyboardWillHide followed
    // by keyboardWillShow a few frames later, even though the keyboard never
    // visibly leaves. Applying the 0px inset immediately collapses the chat
    // viewport for those frames and the thread visibly bounces. Hold the hide
    // for a short grace window; a show inside it cancels the collapse. A real
    // dismissal still lands well within the IME's own ~200ms slide-out.
    const HIDE_GRACE_MS = 100;
    let hideTimer = 0;

    const handleShow = ({ keyboardHeight: h }: { keyboardHeight: number }) => {
      window.clearTimeout(hideTimer);
      hideTimer = 0;
      pluginHeight = h || 0;
      keyboardOpen = true;
      cancelAnimationFrame(rafRef.current);
      rafRef.current = requestAnimationFrame(() => {
        applyHeight(computeHeight(pluginHeight));
      });
    };

    const handleHide = () => {
      pluginHeight = 0;
      keyboardOpen = false;
      cancelAnimationFrame(rafRef.current);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => {
        hideTimer = 0;
        if (keyboardOpen) return;
        applyHeight(0);
      }, HIDE_GRACE_MS);
    };

    Keyboard.addListener("keyboardWillShow", handleShow)
      .then((handle) => { keyboardWillShowHandle = handle; })
      .catch(() => {});

    Keyboard.addListener("keyboardDidShow", handleShow)
      .then((handle) => { keyboardDidShowHandle = handle; })
      .catch(() => {});

    Keyboard.addListener("keyboardWillHide", handleHide)
      .then((handle) => { keyboardWillHideHandle = handle; })
      .catch(() => {});

    Keyboard.addListener("keyboardDidHide", handleHide)
      .then((handle) => { keyboardDidHideHandle = handle; })
      .catch(() => {});

    // Continuous reconciliation against visualViewport while the keyboard
    // is open. Catches: IME toolbar toggle, emoji/GIF panel switching,
    // predictive bar appearing, voice input, OEM keyboards that don't
    // refire Capacitor events on resize.
    const vv = typeof window !== "undefined" ? window.visualViewport : null;
    const handleWindowResize = () => {
      if (!keyboardOpen) {
        getLayoutBaseline();
        return;
      }
      reconcile();
    };

    vv?.addEventListener("resize", reconcile);
    vv?.addEventListener("scroll", reconcile);
    window.addEventListener("resize", handleWindowResize);

    // Re-measure when an editable element gains focus while the keyboard
    // may already be open (e.g. tapping Reply re-focuses the composer
    // textarea without a new keyboardWillShow firing).
    const handleFocusIn = (e: FocusEvent) => {
      const el = e.target as Element | null;
      if (!el) return;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (el as HTMLElement).isContentEditable) {
        // Give the IME a tick to settle, then reconcile against vv.
        setTimeout(() => {
          if (typeof window !== "undefined" && window.visualViewport) {
            const layoutH = window.innerHeight;
            const vvShrink = Math.max(0, layoutH - window.visualViewport.height);
            if (vvShrink > 24) {
              keyboardOpen = true;
              reconcile();
            }
          }
        }, 50);
      }
    };
    document.addEventListener("focusin", handleFocusIn, true);

    // Safety net: Capacitor's keyboardDidHide can be missed on Android when
    // the user navigates away before the keyboard finishes its hide animation.
    const isEditable = (el: Element | null): boolean => {
      if (!el) return false;
      const tag = el.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
      return (el as HTMLElement).isContentEditable === true;
    };

    let focusoutTimer = 0;
    const handleFocusOut = () => {
      window.clearTimeout(focusoutTimer);
      focusoutTimer = window.setTimeout(() => {
        if (!isEditable(document.activeElement)) {
          keyboardOpen = false;
          pluginHeight = 0;
          applyHeight(0);
        }
      }, 250);
    };

    const handleVisibility = () => {
      if (document.visibilityState === "visible" && !isEditable(document.activeElement)) {
        keyboardOpen = false;
        pluginHeight = 0;
        applyHeight(0);
      }
    };

    document.addEventListener("focusout", handleFocusOut, true);
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      keyboardWillShowHandle?.remove();
      keyboardDidShowHandle?.remove();
      keyboardWillHideHandle?.remove();
      keyboardDidHideHandle?.remove();
      vv?.removeEventListener("resize", reconcile);
      vv?.removeEventListener("scroll", reconcile);
      window.removeEventListener("resize", handleWindowResize);
      document.removeEventListener("focusin", handleFocusIn, true);
      document.removeEventListener("focusout", handleFocusOut, true);
      document.removeEventListener("visibilitychange", handleVisibility);
      window.clearTimeout(focusoutTimer);
      window.clearTimeout(hideTimer);
      cancelAnimationFrame(rafRef.current);
    };

  }, []);

  return isNativeAndroid ? keyboardHeight : 0;
}
