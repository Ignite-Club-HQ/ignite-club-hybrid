import { RotateCcw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";

// Apple's standard EULA fallback
const APPLE_EULA_URL = "https://reference.invalid";

interface SubscriptionLegalLinksProps {
  showRestorePurchases?: boolean;
}

export function SubscriptionLegalLinks({ showRestorePurchases = true }: SubscriptionLegalLinksProps) {
  const [isRestoring, setIsRestoring] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();
  const handleRestorePurchases = async () => {
    setIsRestoring(true);
    try {
      const { Capacitor } = await import("@capacitor/core");
      if (!Capacitor.isNativePlatform()) {
        toast({
          title: "Not Available",
          description: "Restore Purchases is only available in the native app.",
        });
        return;
      }
      const { NativePurchases } = await import("@capgo/native-purchases");
      await NativePurchases.restorePurchases();
      toast({
        title: "Purchases Restored",
        description: "Your previous purchases have been restored.",
      });
    } catch (err: any) {
      console.error("[RestorePurchases]", err);
      const msg = (err?.message || "").toLowerCase();
      const isCancellation = msg.includes("cancel") || msg.includes("not purchased") || msg.includes("payment not completed") || msg.includes("user cancelled");
      if (!isCancellation) {
        toast({
          title: "Restore Failed",
          description: err?.message || "Could not restore purchases. Please try again.",
          variant: "destructive",
        });
      }
    } finally {
      setIsRestoring(false);
    }
  };

  return (
    <div className="space-y-3 pt-2">
      {showRestorePurchases && (
        <Button
          variant="ghost"
          size="sm"
          className="w-full text-muted-foreground text-xs h-8"
          onClick={handleRestorePurchases}
          disabled={isRestoring}
        >
          {isRestoring ? (
            <Loader2 className="h-3 w-3 animate-spin mr-1.5" />
          ) : (
            <RotateCcw className="h-3 w-3 mr-1.5" />
          )}
          Restore Purchases
        </Button>
      )}

      <div className="flex items-center justify-center gap-4 text-xs text-muted-foreground">
        <button
          onClick={(e) => { e.preventDefault(); navigate("/privacy"); }}
          className="flex items-center gap-1 hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Privacy Policy
        </button>
        <span>·</span>
        <button
          onClick={(e) => { e.preventDefault(); navigate("/terms"); }}
          className="flex items-center gap-1 hover:text-foreground underline underline-offset-2 transition-colors"
        >
          Terms of Use
        </button>
      </div>

      <p className="text-xs text-center text-muted-foreground leading-relaxed px-2">
        Subscriptions auto-renew unless cancelled at least 24 hours before the end of the current period.
        Manage or cancel in your device's subscription settings.
      </p>
    </div>
  );
}
