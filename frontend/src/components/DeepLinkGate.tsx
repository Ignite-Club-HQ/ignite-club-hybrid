import { useEffect, useState } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { Button } from "@/components/ui/button";
import { Smartphone, ExternalLink } from "lucide-react";

const DEEP_LINK_DOMAIN = "https://reference.invalid";
const CUSTOM_SCHEME = "igniteclubhq://";
const APP_STORE_URL = "https://reference.invalid";
const PLAY_STORE_URL = "https://reference.invalid";

function isInAppBrowser(): boolean {
  const ua = navigator.userAgent || "";
  return /FBAN|FBAV|Instagram|Line\/|Twitter|Snapchat|WhatsApp|LinkedInApp|Messenger/i.test(ua);
}

function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

/**
 * Public route gate for deep links (/events/:id, /media/:photoId).
 * If opened in an in-app browser (Messenger, WhatsApp, etc.),
 * shows an interstitial to redirect to the native app.
 * Otherwise passes through to the normal (auth-protected) app.
 */
export default function DeepLinkGate() {
  const location = useLocation();
  const [shouldIntercept] = useState(() => {
    if (Capacitor.isNativePlatform()) return false;
    return isInAppBrowser();
  });
  const [attemptedOpen, setAttemptedOpen] = useState(false);

  const fullPath = location.pathname + location.search;
  const deepLink = `${DEEP_LINK_DOMAIN}${fullPath}`;

  useEffect(() => {
    if (shouldIntercept) {
      tryOpenNativeApp();
    }
  }, [shouldIntercept]);

  const tryOpenNativeApp = () => {
    setAttemptedOpen(true);
    if (isAndroid()) {
      window.location.href = `intent://ignite.invalid${fullPath}#Intent;scheme=https;package=app.lovable.igniteteamhub;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;
    } else {
      // Try custom scheme first (doesn't cause navigation error),
      // then fall back to Universal Link
      window.location.href = `${CUSTOM_SCHEME}${fullPath}`;
      setTimeout(() => {
        // If custom scheme didn't open the app, try Universal Link
        window.location.href = deepLink;
      }, 800);
    }
  };

  const handleOpenInBrowser = () => {
    window.open(deepLink, "_system");
  };

  const handleGetApp = () => {
    window.location.href = isIOS() ? APP_STORE_URL : PLAY_STORE_URL;
  };

  // Not an in-app browser — let the normal app handle it
  if (!shouldIntercept) {
    return null;
  }

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mb-8">
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Smartphone className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Open in Ignite</h1>
        <p className="text-muted-foreground">
          This link works best in the Ignite app. Tap below to open it directly.
        </p>
      </div>

      <div className="w-full max-w-xs space-y-3">
        <Button onClick={tryOpenNativeApp} className="w-full" size="lg">
          <Smartphone className="mr-2 h-5 w-5" />
          Open in App
        </Button>

        <Button onClick={handleOpenInBrowser} variant="outline" className="w-full" size="lg">
          <ExternalLink className="mr-2 h-5 w-5" />
          Open in Browser
        </Button>

        {attemptedOpen && (
          <p className="text-sm text-muted-foreground pt-2">
            Don't have the app?{" "}
            <button onClick={handleGetApp} className="text-primary underline font-medium">
              Download it here
            </button>
          </p>
        )}
      </div>
    </div>
  );
}
