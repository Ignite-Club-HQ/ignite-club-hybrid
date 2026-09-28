import { useEffect } from "react";

// Ref-count so nested modals don't conflict
let lockCount = 0;
let savedScrollY = 0;
let savedBodyStyles: {
  position: string;
  top: string;
  left: string;
  right: string;
  overflow: string;
  width: string;
} | null = null;

const isIOSEnvironment = () => {
  const userAgent = navigator.userAgent;
  const iOSDevice = /iPad|iPhone|iPod/.test(userAgent);
  const iPadOSDesktopMode = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
  const capacitorPlatform = (window as Window & { Capacitor?: { getPlatform?: () => string } }).Capacitor?.getPlatform?.();

  return iOSDevice || iPadOSDesktopMode || capacitorPlatform === "ios";
};

export function useIOSScrollLock(active: boolean) {
  useEffect(() => {
    if (!active || !isIOSEnvironment()) return;

    if (lockCount === 0) {
      savedScrollY = window.scrollY;

      savedBodyStyles = {
        position: document.body.style.position,
        top: document.body.style.top,
        left: document.body.style.left,
        right: document.body.style.right,
        overflow: document.body.style.overflow,
        width: document.body.style.width,
      };

      document.body.style.position = "fixed";
      document.body.style.top = `-${savedScrollY}px`;
      document.body.style.left = "0";
      document.body.style.right = "0";
      document.body.style.overflow = "hidden";
      document.body.style.width = "100%";
    }

    lockCount += 1;

    return () => {
      lockCount = Math.max(0, lockCount - 1);

      if (lockCount === 0) {
        document.body.style.position = savedBodyStyles?.position ?? "";
        document.body.style.top = savedBodyStyles?.top ?? "";
        document.body.style.left = savedBodyStyles?.left ?? "";
        document.body.style.right = savedBodyStyles?.right ?? "";
        document.body.style.overflow = savedBodyStyles?.overflow ?? "";
        document.body.style.width = savedBodyStyles?.width ?? "";

        savedBodyStyles = null;
        window.scrollTo(0, savedScrollY);
      }
    };
  }, [active]);
}
