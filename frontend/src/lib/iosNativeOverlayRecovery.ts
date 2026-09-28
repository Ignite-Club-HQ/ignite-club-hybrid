import { Capacitor } from "@capacitor/core";
import { emitIOSLayoutReset, emitIOSNavGuard } from "@/lib/iosLayoutStability";
import { refreshStatusBar } from "@/lib/statusBarControl";

const DEFAULT_RECOVERY_DELAYS_MS = [0, 320, 1100, 1800] as const;

export const isNativeIOS = () => Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";

export const isIOSEnvironment = () => {
  if (isNativeIOS()) return true;
  if (typeof navigator === "undefined") return Capacitor.getPlatform() === "ios";

  const userAgent = navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(userAgent);
  const iPadOSDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;

  return iOSDevice || iPadOSDesktopMode || Capacitor.getPlatform() === "ios";
};

export const temporarilyReleaseBodyScrollLock = () => {
  if (typeof document === "undefined") {
    return () => {};
  }

  const savedBodyStyles = {
    position: document.body.style.position,
    top: document.body.style.top,
    left: document.body.style.left,
    right: document.body.style.right,
    overflow: document.body.style.overflow,
    width: document.body.style.width,
  };

  const bodyWasFixed = savedBodyStyles.position === "fixed";

  if (bodyWasFixed) {
    document.body.style.position = "";
    document.body.style.top = "";
    document.body.style.left = "";
    document.body.style.right = "";
    document.body.style.overflow = "";
    document.body.style.width = "";
  }

  return () => {
    if (!bodyWasFixed) return;

    document.body.style.position = savedBodyStyles.position;
    document.body.style.top = savedBodyStyles.top;
    document.body.style.left = savedBodyStyles.left;
    document.body.style.right = savedBodyStyles.right;
    document.body.style.overflow = savedBodyStyles.overflow;
    document.body.style.width = savedBodyStyles.width;
  };
};

export const scheduleIOSNativeOverlayRecovery = (
  delaysMs: readonly number[] = DEFAULT_RECOVERY_DELAYS_MS,
) => {
  if (!isIOSEnvironment() || typeof window === "undefined") {
    return () => {};
  }

  const runRecovery = () => {
    refreshStatusBar();
    emitIOSLayoutReset();
    emitIOSNavGuard(1200, { forceFloor: true });
  };

  const timeoutIds = delaysMs.map((delayMs) =>
    window.setTimeout(() => {
      if (delayMs === 0) {
        requestAnimationFrame(runRecovery);
        return;
      }

      runRecovery();
    }, delayMs),
  );

  return () => {
    timeoutIds.forEach((timeoutId) => window.clearTimeout(timeoutId));
  };
};