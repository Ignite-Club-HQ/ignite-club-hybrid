import { useState, useEffect } from "react";
import { X, Smartphone, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import igniteIcon from "@/assets/ignite-icon.png";
import { APP_STORE_URL, PLAY_STORE_URL } from "@/components/AppStoreDownloadGuide";

const STORAGE_KEY = "ios-install-prompt-dismissed";
const DISMISS_DURATION_DAYS = 7;

function detectPlatform(): "ios" | "android" | "unknown" {
  const ua = navigator.userAgent;
  if (/iPad|iPhone|iPod/.test(ua)) return "ios";
  if (/Android/.test(ua)) return "android";
  return "unknown";
}

export function IOSInstallPrompt() {
  const [showPrompt, setShowPrompt] = useState(false);
  const platform = detectPlatform();

  useEffect(() => {
    try {
      // Skip if running as native Capacitor app
      const isNativeApp = !!(window as any).Capacitor?.isNativePlatform?.();
      if (isNativeApp) return;

      // Check if already in standalone mode
      const isStandalone = window.matchMedia("(display-mode: standalone)").matches;
      if (isStandalone) return;

      // Check if user has dismissed recently
      try {
        const dismissed = localStorage.getItem(STORAGE_KEY);
        if (dismissed) {
          const dismissedAt = parseInt(dismissed, 10);
          const daysSinceDismiss = (Date.now() - dismissedAt) / (1000 * 60 * 60 * 24);
          if (daysSinceDismiss < DISMISS_DURATION_DAYS) return;
        }
      } catch {
        // localStorage not available
      }

      // Show prompt after a short delay
      const timer = setTimeout(() => setShowPrompt(true), 2000);
      return () => clearTimeout(timer);
    } catch (error) {
      console.warn('IOSInstallPrompt check failed:', error);
    }
  }, []);

  const handleDismiss = () => {
    try {
      localStorage.setItem(STORAGE_KEY, Date.now().toString());
    } catch {
      // localStorage not available
    }
    setShowPrompt(false);
  };

  if (!showPrompt) return null;

  return (
    <>
      {/* Backdrop */}
      <div 
        className="fixed inset-0 bg-black/40 z-40 animate-in fade-in duration-300"
        onClick={handleDismiss}
      />
      
      {/* Prompt Card */}
      <div className="fixed bottom-0 left-0 right-0 z-50 animate-in slide-in-from-bottom duration-300">
        <div className="bg-card border-t border-border rounded-t-3xl shadow-2xl p-6 pb-8 mx-auto max-w-lg">
          {/* Close button */}
          <Button
            variant="ghost"
            size="icon"
            className="absolute top-4 right-4 h-8 w-8 rounded-full"
            onClick={handleDismiss}
          >
            <X className="h-4 w-4" />
          </Button>

          {/* Header with app icon */}
          <div className="flex flex-col items-center text-center mb-6">
            <img 
              src={igniteIcon} 
              alt="Ignite Club HQ" 
              className="h-16 w-16 rounded-2xl shadow-lg mb-3"
            />
            <h3 className="text-xl font-bold text-foreground">
              Get the Ignite Club HQ App
            </h3>
            <p className="text-sm text-muted-foreground mt-1">
              Download for the best experience
            </p>
          </div>

          {/* Store buttons */}
          <div className="space-y-3 mb-6">
            {(platform === "ios" || platform === "unknown") && (
              <Button className="w-full h-12 text-base" asChild>
                <a href={APP_STORE_URL} target="_blank" rel="noopener noreferrer">
                  <Smartphone className="h-5 w-5 mr-2" />
                  Download on the App Store
                  <ExternalLink className="h-4 w-4 ml-2" />
                </a>
              </Button>
            )}
            {(platform === "android" || platform === "unknown") && (
              <Button 
                className="w-full h-12 text-base" 
                variant={platform === "android" ? "default" : "outline"}
                asChild
              >
                <a href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer">
                  <Smartphone className="h-5 w-5 mr-2" />
                  Get it on Google Play
                  <ExternalLink className="h-4 w-4 ml-2" />
                </a>
              </Button>
            )}
          </div>

          {/* Benefits */}
          <div className="flex justify-center gap-6 text-xs text-muted-foreground mb-4">
            <div className="flex items-center gap-1.5">
              <span className="text-base">⚡</span>
              <span>Faster loading</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-base">🔔</span>
              <span>Push notifications</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="text-base">📱</span>
              <span>Full screen</span>
            </div>
          </div>

          {/* Dismiss link */}
          <button 
            onClick={handleDismiss}
            className="w-full text-center text-sm text-muted-foreground hover:text-foreground transition-colors"
          >
            Maybe later
          </button>
        </div>
      </div>
    </>
  );
}
