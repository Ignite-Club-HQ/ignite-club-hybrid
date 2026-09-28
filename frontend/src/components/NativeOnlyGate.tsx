import { useState } from "react";
import { useLocation } from "react-router-dom";
import { Capacitor } from "@capacitor/core";
import { setInviteFlowContext } from "@/components/InviteFlowProgress";
import { Button } from "@/components/ui/button";
import { Smartphone, Download } from "lucide-react";

const DEEP_LINK_DOMAIN = "https://reference.invalid";
const CUSTOM_SCHEME = "igniteclubhq://";
const APP_STORE_URL = "https://reference.invalid";
const PLAY_STORE_URL = "https://reference.invalid";

function isIOS(): boolean {
  return /iPhone|iPad|iPod/i.test(navigator.userAgent);
}

function isAndroid(): boolean {
  return /Android/i.test(navigator.userAgent);
}

function isMobile(): boolean {
  return isIOS() || isAndroid();
}

/**
 * Blocks join routes on non-native platforms.
 * On mobile browsers: shows download prompt with store links.
 * On desktop browsers: shows download prompt.
 * On native app: renders children normally.
 */
export default function NativeOnlyGate({ children }: { children: React.ReactNode }) {
  const location = useLocation();
  const [attemptedOpen, setAttemptedOpen] = useState(false);

  // Always allow through on native
  if (Capacitor.isNativePlatform()) {
    return <>{children}</>;
  }

  const fullPath = location.pathname + location.search;
  const deepLink = `${DEEP_LINK_DOMAIN}${fullPath}`;

  const tryOpenNativeApp = () => {
    setAttemptedOpen(true);
    if (isAndroid()) {
      window.location.href = `intent://ignite.invalid${fullPath}#Intent;scheme=https;package=app.lovable.igniteteamhub;S.browser_fallback_url=${encodeURIComponent(PLAY_STORE_URL)};end`;
    } else if (isIOS()) {
      window.location.href = `${CUSTOM_SCHEME}${fullPath}`;
      setTimeout(() => {
        window.location.href = deepLink;
      }, 800);
    }
  };

  const handleGetApp = (platform: "ios" | "android") => {
    // Persist the invite path so PWAPendingInviteHandler can resume after install
    localStorage.setItem("pwa_pending_invite", fullPath);
    // Also set invite flow context so it survives the install
    setInviteFlowContext({
      active: true,
      inviteToken: fullPath.split("/").pop() || undefined,
      currentStep: "install",
    });
    window.location.href = platform === "ios" ? APP_STORE_URL : PLAY_STORE_URL;
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center bg-background px-6 text-center">
      <div className="mb-8">
        <div className="w-20 h-20 rounded-2xl bg-primary/10 flex items-center justify-center mx-auto mb-4">
          <Smartphone className="h-10 w-10 text-primary" />
        </div>
        <h1 className="text-2xl font-bold text-foreground mb-2">Get the Ignite App</h1>
        <p className="text-muted-foreground">
          To join a team you need the Ignite Club HQ app. Download it for free and use this link to join.
        </p>
      </div>

      <div className="w-full max-w-xs space-y-3">
        {isMobile() && (
          <Button onClick={tryOpenNativeApp} className="w-full" size="lg">
            <Smartphone className="mr-2 h-5 w-5" />
            Open in App
          </Button>
        )}

        <Button
          onClick={() => handleGetApp("ios")}
          variant={isMobile() ? "outline" : "default"}
          className="w-full"
          size="lg"
        >
          <Download className="mr-2 h-5 w-5" />
          Download for iPhone
        </Button>

        <Button
          onClick={() => handleGetApp("android")}
          variant="outline"
          className="w-full"
          size="lg"
        >
          <Download className="mr-2 h-5 w-5" />
          Download for Android
        </Button>

        {attemptedOpen && isMobile() && (
          <p className="text-sm text-muted-foreground pt-2">
            If the app didn't open, download it above and then tap this link again.
          </p>
        )}
      </div>
    </div>
  );
}
