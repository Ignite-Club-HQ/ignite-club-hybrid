import { useEffect, useRef } from "react";

/**
 * Prevents background scrolling on iOS when a full-screen fixed overlay is open.
 *
 * Unlike useIOSScrollLock (which uses position:fixed on body), this hook uses
 * a passive-false touchmove listener to prevent scroll-through without modifying
 * any body/html styles. This avoids conflicts with useIOSScrollLock's saved-state
 * tracking and prevents stale overflow:hidden from persisting after close.
 */

const isIOSEnvironment = () => {
  if (typeof navigator === "undefined") return false;

  const userAgent = navigator.userAgent;
  const isIOSDevice = /iPad|iPhone|iPod/.test(userAgent);
  const isIpadDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const capacitorPlatform = (window as Window & { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();

  return isIOSDevice || isIpadDesktopMode || capacitorPlatform === "ios";
};

export function useIOSOverlayScrollLock(active: boolean) {
  const overlayRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!active || !isIOSEnvironment()) return;

    // Prevent touchmove on the document root so the body can't scroll behind
    // the overlay. Events inside a [data-radix-scroll-area-viewport] or the
    // overlay itself are allowed through so internal scrolling still works.
    const handler = (e: TouchEvent) => {
      const target = e.target as HTMLElement | null;
      if (!target) return;

      // Allow scrolling inside scroll-area viewports (comment list etc.)
      if (target.closest("[data-radix-scroll-area-viewport]")) return;
      // Allow scrolling inside textareas
      if (target.tagName === "TEXTAREA") return;
      // Allow scrolling inside explicitly scrollable containers
      if (target.closest("[data-allow-scroll]")) return;

      // Block body scroll-through
      e.preventDefault();
    };

    document.addEventListener("touchmove", handler, { passive: false });

    return () => {
      document.removeEventListener("touchmove", handler);
    };
  }, [active]);

  return overlayRef;
}
