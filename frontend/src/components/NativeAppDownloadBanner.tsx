import { useState } from "react";
import { X, Smartphone, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/components/AppStoreDownloadGuide";
import igniteIcon from "@/assets/ignite-icon.png";

const DISMISS_KEY = "native-app-banner-dismissed";
const DISMISS_DURATION_DAYS = 3;

function detectPlatform(): "ios" | "android" | "unknown" {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "unknown";
}

/**
 * Inline banner shown on the home page for mobile browser users 
 * who don't have the native app installed. Dismissible for 3 days.
 * Only shown on mobile platforms (iOS/Android), not desktop.
 */
export function NativeAppDownloadBanner() {
  const platform = detectPlatform();

  const [dismissed, setDismissed] = useState(() => {
    // Don't show on desktop
    if (platform === "unknown") return true;
    // Don't show on native app
    try {
      if ((window as any).Capacitor?.isNativePlatform?.()) return true;
    } catch {}
    // Don't show if in standalone/PWA mode
    try {
      if (window.matchMedia("(display-mode: standalone)").matches) return true;
    } catch {}
    // Check dismiss timeout
    try {
      const ts = localStorage.getItem(DISMISS_KEY);
      if (ts) {
        const days = (Date.now() - parseInt(ts, 10)) / (1000 * 60 * 60 * 24);
        if (days < DISMISS_DURATION_DAYS) return true;
      }
    } catch {}
    return false;
  });

  if (dismissed) return null;

  const handleDismiss = () => {
    try { localStorage.setItem(DISMISS_KEY, Date.now().toString()); } catch {}
    setDismissed(true);
  };

  const storeUrl = platform === "ios" ? APP_STORE_URL : PLAY_STORE_URL;
  const storeLabel = platform === "ios" ? "App Store" : "Google Play";

  return (
    <div className="relative flex items-center gap-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
      <Button
        variant="ghost"
        size="icon"
        className="absolute top-1 right-1 h-6 w-6 rounded-full text-muted-foreground"
        onClick={handleDismiss}
      >
        <X className="h-3.5 w-3.5" />
      </Button>

      <img src={igniteIcon} alt="" className="h-10 w-10 rounded-xl shrink-0" />

      <div className="flex-1 min-w-0 pr-6">
        <p className="text-sm font-medium leading-tight">Get the app for push notifications</p>
        <p className="text-xs text-muted-foreground mt-0.5">
          Never miss a team update
        </p>
      </div>

      <Button size="sm" className="shrink-0 gap-1" asChild>
        <a href={storeUrl} target="_blank" rel="noopener noreferrer">
          <Smartphone className="h-3.5 w-3.5" />
          {storeLabel}
          <ExternalLink className="h-3 w-3" />
        </a>
      </Button>
    </div>
  );
}
