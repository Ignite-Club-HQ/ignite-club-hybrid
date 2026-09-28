import { useState, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Cookie, X } from "lucide-react";

const COOKIE_CONSENT_KEY = "cookie-consent";

// Native apps (iOS/Android) don't use browser cookies - banner is web-only
const isNativePlatform = !!(window as any).Capacitor?.isNativePlatform?.();

export function CookieConsentBanner() {
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Never show on native platforms - no browser cookies are used
    if (isNativePlatform) return;
    
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      // Small delay to prevent flash on page load
      const timer = setTimeout(() => setIsVisible(true), 500);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
    setIsVisible(false);
  };

  const handleDecline = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "declined");
    setIsVisible(false);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-0 left-0 right-0 z-50 p-4 bg-background border-t border-border shadow-lg animate-slide-up">
      <div className="max-w-4xl mx-auto flex flex-col sm:flex-row items-start sm:items-center gap-4">
        <div className="flex items-start gap-3 flex-1">
          <Cookie className="h-5 w-5 text-primary mt-0.5 shrink-0" />
          <p className="text-sm text-muted-foreground">
            We use cookies to enhance your experience. By continuing to visit this site, you agree to our use of cookies.{" "}
            <a 
              href="https://reference.invalid" 
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary hover:underline font-medium"
            >
              Learn more in our Privacy Policy
            </a>
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Button 
            variant="outline" 
            size="sm" 
            onClick={handleDecline}
            className="text-xs"
          >
            Decline
          </Button>
          <Button 
            size="sm" 
            onClick={handleAccept}
            className="text-xs"
          >
            Accept All
          </Button>
        </div>
        <button 
          onClick={handleDecline}
          className="absolute top-2 right-2 sm:hidden p-1 text-muted-foreground hover:text-foreground"
          aria-label="Close"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}
