import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { Capacitor } from '@capacitor/core';
import { Keyboard } from '@capacitor/keyboard';
import { resolveKeyboardCssHeight } from '@/lib/keyboardCssHeight';
import { App } from '@capacitor/app';
import { applyStatusBar, refreshStatusBar } from '@/lib/statusBarControl';
import { scheduleIOSNativeOverlayRecovery } from '@/lib/iosNativeOverlayRecovery';
import { readSafeAreaInsetBottomPx, readSafeAreaInsetTopPx } from '@/lib/iosLayoutStability';

/**
 * Manages native status bar appearance on Capacitor apps.
 * Delegates all style calls to the serialized queue in statusBarControl
 * to prevent interleaved async calls that cause icon color mismatches.
 */
export function StatusBarManager() {
  const location = useLocation();

  // Defensive: every route change, force-refresh status bar so a stale
  // overlay=true state (left over from fullscreen viewer / native sheet)
  // can never persist and push page content under the system status bar.
  useEffect(() => {
    if (Capacitor.isNativePlatform()) refreshStatusBar();
  }, [location.pathname]);

  useEffect(() => {
    const isNativePlatform = Capacitor.isNativePlatform();
    const isNativeIOS = isNativePlatform && Capacitor.getPlatform() === 'ios';
    const isNativeAndroid = isNativePlatform && Capacitor.getPlatform() === 'android';
    const isIOSLike = (() => {
      if (typeof navigator === 'undefined') return isNativeIOS;
      const userAgent = navigator.userAgent;
      const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent);
      const isIpadOSDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
      return isNativeIOS || isIOSDevice || isIpadOSDesktopMode;
    })();
    let cancelIOSRecovery: (() => void) | null = null;
    let lockedIOSSafeAreaTop = 0;
    let lockedIOSStableVh = 0;
    // Android: monotonic max of innerHeight. Some Android WebView builds /
    // OEMs shrink window.innerHeight when the soft keyboard opens even though
    // Capacitor's Keyboard.resize='none' is set. If we let that shrink leak
    // into --visual-vh, AppLayout's height drops AND useChatViewportHeight
    // still subtracts the full keyboard height — producing a large blank gap
    // between the composer and the keyboard mid-session. Locking to the max
    // ensures useChatViewportHeight remains the single source of truth.
    let lockedAndroidVisualVh = 0;

    const getNativeSafeAreaTopFloor = () => {
      if (!isIOSLike || typeof window === 'undefined') return 0;
      const shortestSide = Math.min(window.screen.width, window.screen.height);
      const longestSide = Math.max(window.screen.width, window.screen.height);
      const aspectRatio = longestSide / Math.max(shortestSide, 1);

      if (shortestSide >= 768) return 24;
      return aspectRatio >= 2 ? 44 : 20;
    };

    // Android floor for the status-bar inset. In edge-to-edge mode (and inside
    // the Lovable web preview running on a real Android device) the WebView
    // can report `env(safe-area-inset-top) = 0`, which collapses every
    // `pt-safe` to nothing and lets the system status bar paint OVER the app
    // header and the topmost chat message — exactly the "text going over the
    // status bar" symptom. 24px matches the historical Android status-bar
    // height and is a safe minimum across all current devices; if the WebView
    // does report a real (larger) inset we still honour it via Math.max below.
    const getAndroidSafeAreaTopFloor = () => {
      // CRITICAL: only apply this floor inside the native Capacitor WebView.
      // Web Android Chrome does NOT render under the system status bar (the
      // browser URL bar owns that area), so `env(safe-area-inset-top) = 0`
      // is correct there. Forcing 24px on web inflates `pt-safe` on AppHeader
      // by 24px, which makes the chat container (which only subtracts 4rem
      // for the header) overflow the viewport — the body then scrolls and
      // the AppHeader / chat header disappear off the top.
      if (!isNativeAndroid || typeof window === 'undefined') return 0;
      const shortestSide = Math.min(window.screen?.width ?? 0, window.screen?.height ?? 0);
      if (shortestSide >= 768) return 0;
      return 24;
    };

    const setSafeAreaInsets = (options?: { resetTopLock?: boolean }) => {
      if (typeof document === 'undefined') return;

      const measuredTop = readSafeAreaInsetTopPx();
      const measuredBottom = readSafeAreaInsetBottomPx();
      const currentComputedTop = Number.parseFloat(
        window.getComputedStyle(document.documentElement).getPropertyValue('--safe-area-top') || '0',
      );
      const safeTopBase = isIOSLike
        ? Math.max(measuredTop, getNativeSafeAreaTopFloor())
        : Math.max(measuredTop, getAndroidSafeAreaTopFloor());
      const preservedTop = isIOSLike && !options?.resetTopLock
        ? Math.max(
            lockedIOSSafeAreaTop,
            Number.isFinite(currentComputedTop) ? currentComputedTop : 0,
          )
        : 0;
      const safeTop = isIOSLike ? Math.max(safeTopBase, preservedTop) : safeTopBase;

      lockedIOSSafeAreaTop = safeTop;

      document.documentElement.style.setProperty('--safe-area-top', `${safeTop}px`);
      document.documentElement.style.setProperty('--safe-area-bottom', `${Math.max(measuredBottom, 0)}px`);
    };

    // Set a stable viewport height CSS variable using the actually visible native viewport.
    const setStableVh = (options?: { resetLock?: boolean }) => {
      const visualViewportHeight = window.visualViewport?.height ?? 0;
      const innerHeight = window.innerHeight ?? 0;
      const measuredHeight = Math.max(visualViewportHeight, innerHeight);
      const stableHeight = isIOSLike && !options?.resetLock
        ? Math.max(measuredHeight, lockedIOSStableVh)
        : measuredHeight;
      if (!stableHeight) return;
      lockedIOSStableVh = stableHeight;
      document.documentElement.style.setProperty('--stable-vh', `${stableHeight}px`);
    };
    const setVisualVh = (options?: { resetLock?: boolean }) => {
      // On native Android, Capacitor's Keyboard.resize='none' keeps the
      // WebView at full screen size when the keyboard opens. The visualViewport
      // API still reports the smaller visible area, but using that here would
      // shrink AppLayout — and useChatViewportHeight already subtracts the
      // native keyboard height for chat shells. Subtracting in both places
      // collapses the chat shell and pushes AppHeader / ChatHeaderShell off
      // the top of the screen. Always use innerHeight on native Android so
      // useChatViewportHeight remains the single source of truth.
      //
      // Edge case: some Android WebView/OEM builds DO shrink innerHeight when
      // the IME opens despite resize='none' (Samsung One UI, Xiaomi MIUI,
      // post-configuration-change, split-screen). Lock --visual-vh to the
      // monotonic max so a transient shrink can't leak into AppLayout.
      if (isNativeAndroid) {
        const innerHeight = window.innerHeight ?? window.visualViewport?.height ?? 0;
        if (!innerHeight) return;
        const next = options?.resetLock
          ? innerHeight
          : Math.max(lockedAndroidVisualVh, innerHeight);
        lockedAndroidVisualVh = next;
        document.documentElement.style.setProperty('--visual-vh', `${next}px`);
        return;
      }
      const visualHeight = window.visualViewport?.height ?? window.innerHeight ?? 0;
      if (!visualHeight) return;
      document.documentElement.style.setProperty('--visual-vh', `${visualHeight}px`);
    };
    setStableVh({ resetLock: true });
    setVisualVh({ resetLock: true });
    setSafeAreaInsets({ resetTopLock: true });
    // Only update on orientation change, not on keyboard resize
    const handleOrientationChange = () => {
      setTimeout(() => {
        setStableVh({ resetLock: true });
        setVisualVh({ resetLock: true });
        setSafeAreaInsets({ resetTopLock: true });
      }, 150);
    };
    window.addEventListener('orientationchange', handleOrientationChange);

    const visualViewport = window.visualViewport;
    const handleViewportInsetChange = () => {
      setStableVh();
      setVisualVh();
      setSafeAreaInsets();
    };

    visualViewport?.addEventListener('resize', handleViewportInsetChange);
    visualViewport?.addEventListener('scroll', handleViewportInsetChange);

    const queueIOSRecovery = () => {
      if (!isNativeIOS || typeof document === 'undefined') return;
      if (document.visibilityState === 'hidden') return;
      setStableVh();
      setSafeAreaInsets();
      window.setTimeout(setStableVh, 250);
      window.setTimeout(setStableVh, 1000);
      window.setTimeout(() => setSafeAreaInsets(), 250);
      window.setTimeout(() => setSafeAreaInsets(), 1000);
      cancelIOSRecovery?.();
      cancelIOSRecovery = scheduleIOSNativeOverlayRecovery([0, 320, 1100, 1800]);
    };

    // Initial apply (synchronous theme read inside statusBarControl)
    applyStatusBar();

    // iOS keyboard config
    if (isNativeIOS) {
      Keyboard.setAccessoryBarVisible({ isVisible: false }).catch(() => {});
    }

    // Scroll focused input into view when keyboard appears (Android + iOS)
    let keyboardShowListener: { remove: () => void } | undefined;
    if (isNativePlatform) {
      Keyboard.addListener('keyboardDidShow', (info) => {
        setTimeout(() => {
          const activeElement = document.activeElement as HTMLElement | null;
          if (!activeElement) return;

          const isFormField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName);
          if (!isFormField) return;

          const hasKeyboardScrollLock = activeElement.closest('[data-lock-keyboard-scroll="true"]');
          if (hasKeyboardScrollLock) return;

          // Per project memory: avoid scrollIntoView on Android — it over-scrolls
          // the WebView. Compute the delta manually and apply it to the nearest
          // scrollable ancestor (or window) so the input clears the keyboard.
          try {
            const rect = activeElement.getBoundingClientRect();
            // Plugin height is device px on Android — normalise before layout
            // math or high-DPR devices over-scroll and leave a huge blank gap
            // between the focused input and the keyboard (e.g. Photos caption).
            const rawKeyboardHeight = (info as { keyboardHeight?: number })?.keyboardHeight ?? 0;
            const keyboardHeight = resolveKeyboardCssHeight(rawKeyboardHeight);
            const visibleBottom = window.innerHeight - keyboardHeight;
            const padding = 24;
            const overlap = rect.bottom + padding - visibleBottom;
            if (overlap <= 0) return;

            // Find nearest scrollable ancestor.
            let node: HTMLElement | null = activeElement.parentElement;
            while (node) {
              const style = getComputedStyle(node);
              const canScroll = /(auto|scroll|overlay)/.test(style.overflowY) && node.scrollHeight > node.clientHeight;
              if (canScroll) break;
              node = node.parentElement;
            }
            if (node) {
              node.scrollBy({ top: overlap, behavior: 'auto' });
            } else {
              window.scrollBy({ top: overlap, behavior: 'auto' });
            }
          } catch {
            /* noop */
          }
        }, 100);
      }).then(handle => { keyboardShowListener = handle; });
    }

    // Re-apply on app resume with a small delay to let WebView settle
    let appListener: { remove: () => void } | undefined;
    if (isNativePlatform) {
      App.addListener('appStateChange', ({ isActive }) => {
        if (isActive) {
          if (isNativeIOS) {
            queueIOSRecovery();
          } else {
            // Android can reset status bar colors during resume – apply twice
            setTimeout(() => refreshStatusBar(), 80);
            setTimeout(() => refreshStatusBar(), 500);
          }
        }
      }).then(handle => { appListener = handle; });
    }

    const handleViewportResume = () => {
      queueIOSRecovery();
    };

    if (isNativeIOS && typeof document !== 'undefined' && typeof window !== 'undefined') {
      window.addEventListener('focus', handleViewportResume);
      window.addEventListener('pageshow', handleViewportResume);
      document.addEventListener('visibilitychange', handleViewportResume);
    }

    // Watch for theme changes via DOM class mutations
    const observer = new MutationObserver(() => {
      applyStatusBar(); // dedup handled inside queue
    });

    observer.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });

    return () => {
      observer.disconnect();
      appListener?.remove();
      keyboardShowListener?.remove();
      cancelIOSRecovery?.();
      window.removeEventListener('orientationchange', handleOrientationChange);
      visualViewport?.removeEventListener('resize', handleViewportInsetChange);
      visualViewport?.removeEventListener('scroll', handleViewportInsetChange);
      if (isNativeIOS && typeof document !== 'undefined' && typeof window !== 'undefined') {
        window.removeEventListener('focus', handleViewportResume);
        window.removeEventListener('pageshow', handleViewportResume);
        document.removeEventListener('visibilitychange', handleViewportResume);
      }
    };
  }, []);

  return null;
}
