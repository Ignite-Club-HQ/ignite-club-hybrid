import { useState, useEffect, useRef } from "react";
import { Capacitor } from "@capacitor/core";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Store the prompt globally so it persists across component remounts
let globalDeferredPrompt: BeforeInstallPromptEvent | null = null;

// Set up global listener early - only on web platforms
if (typeof window !== 'undefined' && !Capacitor.isNativePlatform()) {
  window.addEventListener("beforeinstallprompt", (e: Event) => {
    e.preventDefault();
    globalDeferredPrompt = e as BeforeInstallPromptEvent;
  });
}

// Minimum time to show "Installing..." state (in ms)
const MIN_INSTALLING_TIME = 6000;
// Maximum time to wait for appinstalled event before auto-transitioning
const MAX_INSTALLING_TIME = 10000;

export function usePWAInstall() {
  // On native platforms, PWA install is not applicable
  const isNative = Capacitor.isNativePlatform();
  
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(isNative ? null : globalDeferredPrompt);
  const [canPrompt, setCanPrompt] = useState(isNative ? false : !!globalDeferredPrompt);
  // Check standalone mode immediately to prevent flash of install UI
  // On native, consider the app as "installed"
  const [isInstalled, setIsInstalled] = useState(() => {
    if (isNative) return true;
    if (typeof window !== 'undefined') {
      return window.matchMedia("(display-mode: standalone)").matches;
    }
    return false;
  });
  const [isInstalling, setIsInstalling] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [isReady, setIsReady] = useState(isNative); // Ready immediately on native
  
  // Track when installation was accepted and when appinstalled event fired
  const installAcceptedAt = useRef<number | null>(null);
  const appInstalledEventFired = useRef(false);

  useEffect(() => {
    // Skip all PWA logic on native platforms
    if (isNative) return;
    
    try {
      // Check if app is already installed (running as standalone)
      if (window.matchMedia("(display-mode: standalone)").matches) {
        setIsInstalled(true);
        setIsReady(true);
        return;
      }

      // Check if iOS
      const isIOSDevice = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
      setIsIOS(isIOSDevice);

      // Check if we already have a deferred prompt from global listener
      if (globalDeferredPrompt) {
        setDeferredPrompt(globalDeferredPrompt);
        setCanPrompt(true);
      }

      const handleBeforeInstallPrompt = (e: Event) => {
        e.preventDefault();
        globalDeferredPrompt = e as BeforeInstallPromptEvent;
        setDeferredPrompt(e as BeforeInstallPromptEvent);
        setCanPrompt(true);
      };

      const handleAppInstalled = () => {
        console.log("[PWA] appinstalled event fired");
        appInstalledEventFired.current = true;
        
        // Check if minimum time has passed since user accepted
        const acceptedAt = installAcceptedAt.current;
        if (acceptedAt) {
          const elapsed = Date.now() - acceptedAt;
          const remaining = MIN_INSTALLING_TIME - elapsed;
          
          if (remaining > 0) {
            // Wait for remaining time before transitioning
            console.log(`[PWA] Waiting ${remaining}ms before completing`);
            setTimeout(() => {
              console.log("[PWA] Minimum install time elapsed, completing");
              setIsInstalling(false);
              setIsInstalled(true);
              setCanPrompt(false);
              setDeferredPrompt(null);
              globalDeferredPrompt = null;
            }, remaining);
          } else {
            // Minimum time already passed
            console.log("[PWA] Minimum time passed, completing immediately");
            setIsInstalling(false);
            setIsInstalled(true);
            setCanPrompt(false);
            setDeferredPrompt(null);
            globalDeferredPrompt = null;
          }
        } else {
          // User hasn't accepted yet (edge case), just set installed
          console.log("[PWA] No accept timestamp, completing immediately");
          setIsInstalling(false);
          setIsInstalled(true);
          setCanPrompt(false);
          setDeferredPrompt(null);
          globalDeferredPrompt = null;
        }
      };

      window.addEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
      window.addEventListener("appinstalled", handleAppInstalled);

      // Mark as ready after a short delay to allow beforeinstallprompt to fire
      const readyTimeout = setTimeout(() => {
        setIsReady(true);
      }, 500);

      return () => {
        window.removeEventListener("beforeinstallprompt", handleBeforeInstallPrompt);
        window.removeEventListener("appinstalled", handleAppInstalled);
        clearTimeout(readyTimeout);
      };
    } catch (error) {
      console.warn("PWA install check failed:", error);
      setIsReady(true);
    }
  }, []);

  const installApp = async () => {
    const promptToUse = deferredPrompt || globalDeferredPrompt;
    if (!promptToUse) {
      // No prompt available - reset state to reflect reality
      setCanPrompt(false);
      return false;
    }

    try {
      console.log("[PWA] Showing install prompt...");
      
      // Reset tracking state
      installAcceptedAt.current = null;
      appInstalledEventFired.current = false;
      
      await promptToUse.prompt();
      const { outcome } = await promptToUse.userChoice;
      console.log("[PWA] User choice:", outcome);
      
      if (outcome === "accepted") {
        // Record the time user accepted and start installing state
        installAcceptedAt.current = Date.now();
        setIsInstalling(true);
        console.log("[PWA] User accepted install, isInstalling = true");
        
        // Set a maximum timeout in case appinstalled event never fires
        setTimeout(() => {
          if (installAcceptedAt.current) {
            console.log("[PWA] Max install time reached, completing anyway");
            setIsInstalling(false);
            setIsInstalled(true);
            setCanPrompt(false);
            setDeferredPrompt(null);
            globalDeferredPrompt = null;
            installAcceptedAt.current = null;
          }
        }, MAX_INSTALLING_TIME);
        
        // If appinstalled already fired (rare), handle it now with minimum delay
        if (appInstalledEventFired.current) {
          console.log("[PWA] appinstalled already fired, waiting minimum time");
          setTimeout(() => {
            console.log("[PWA] Minimum install time elapsed after accept");
            setIsInstalling(false);
            setIsInstalled(true);
            setCanPrompt(false);
            setDeferredPrompt(null);
            globalDeferredPrompt = null;
            installAcceptedAt.current = null;
          }, MIN_INSTALLING_TIME);
        }
      }
      
      // Always clear prompt after use (it's single-use) and update canPrompt
      setDeferredPrompt(null);
      globalDeferredPrompt = null;
      setCanPrompt(false);
      
      return outcome === "accepted";
    } catch (error) {
      console.error("Error installing app:", error);
      // Clear stale state on error
      setDeferredPrompt(null);
      globalDeferredPrompt = null;
      setCanPrompt(false);
      setIsInstalling(false);
      installAcceptedAt.current = null;
      return false;
    }
  };

  return {
    canPrompt,
    isInstalled,
    isInstalling,
    isIOS,
    isReady,
    installApp,
  };
}
