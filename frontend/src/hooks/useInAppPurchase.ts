import { useState, useCallback, useEffect } from "react";
import { Capacitor } from "@capacitor/core";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Product IDs - must match App Store Connect & Google Play Console
export const IAP_PRODUCT_IDS = {
  // Club upgrades
  pro_starter_monthly: "ignite_pro_starter_monthly",
  pro_starter_annual: "ignite_pro_starter_annual",
  pro_standard_monthly: "ignite_pro_standard_monthly",
  pro_standard_annual: "ignite_pro_standard_annual",
  pro_unlimited_monthly: "ignite_pro_unlimited_monthly",
  pro_football_starter_monthly: "ignite_pf_starter_monthly",
  pro_football_standard_monthly: "ignite_pf_standard_monthly",
  pro_football_unlimited_monthly: "ignite_pf_unlimited_monthly",
  // Team upgrades
  team_pro_monthly: "ignite_team_pro_monthly",
  team_pro_annual: "ignite_team_pro_annual",
  team_pro_football_monthly: "ignite_team_pf_monthly",
  team_pro_football_annual: "ignite_team_pf_annual",
  // Storage
  storage_10gb_monthly: "ignite_storage_10gb_monthly",
  storage_10gb_annual: "ignite_storage_10gb_annual",
  storage_50gb_monthly: "ignite_storage_50gb_monthly",
  storage_50gb_annual: "ignite_storage_50gb_annual",
} as const;

type PurchaseState = "idle" | "loading" | "purchasing" | "verifying" | "success" | "error";

interface UseInAppPurchaseReturn {
  purchaseProduct: (productId: string, entityId: string, entityType: "club" | "team") => Promise<boolean>;
  purchaseState: PurchaseState;
  error: string | null;
  isAvailable: boolean;
}

export function useInAppPurchase(): UseInAppPurchaseReturn {
  const { user } = useAuth();
  const [purchaseState, setPurchaseState] = useState<PurchaseState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [isAvailable, setIsAvailable] = useState(false);

  useEffect(() => {
    const checkAvailability = async () => {
      if (!Capacitor.isNativePlatform()) {
        setIsAvailable(false);
        return;
      }
      try {
        const { NativePurchases } = await import("@capgo/native-purchases");
        const result = await NativePurchases.isBillingSupported();
        setIsAvailable(result?.isBillingSupported ?? false);
      } catch {
        setIsAvailable(false);
      }
    };
    checkAvailability();
  }, []);

  const purchaseProduct = useCallback(
    async (productId: string, entityId: string, entityType: "club" | "team"): Promise<boolean> => {
      if (!user) {
        setError("You must be logged in to make purchases");
        setPurchaseState("error");
        return false;
      }

      setPurchaseState("loading");
      setError(null);

      try {
        // Pre-validate authorization before triggering native payment
        const { data: authCheck, error: authCheckError } = await supabase.functions.invoke(
          "check-iap-authorization",
          {
            body: { productId, entityId, entityType },
          }
        );

        if (authCheckError || authCheck?.error) {
          throw new Error(authCheck?.error || authCheckError?.message || "You don't have permission to make this purchase");
        }

        const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

        // All current IAP SKUs are recurring plans (monthly/annual)
        const isSubscription = productId.includes("_monthly") || productId.includes("_annual");

        // Get product info
        setPurchaseState("purchasing");

        const purchaseOptions: any = {
          productIdentifier: productId,
          productType: isSubscription ? PURCHASE_TYPE.SUBS : PURCHASE_TYPE.INAPP,
        };

        // Android subscriptions require a plan identifier
        if (isSubscription && Capacitor.getPlatform() === "android") {
          purchaseOptions.planIdentifier = productId;
        }

        const purchaseResult = await NativePurchases.purchaseProduct(purchaseOptions);

        if (!purchaseResult?.transactionId) {
          throw new Error("Purchase was cancelled or failed");
        }

        // Verify receipt on server
        setPurchaseState("verifying");
        const platform = Capacitor.getPlatform();
        const { data, error: verifyError } = await supabase.functions.invoke(
          "verify-iap-receipt",
          {
            body: {
              platform,
              transactionId: purchaseResult.transactionId,
              productId,
              entityId,
              entityType,
              receipt: purchaseResult.receipt || purchaseResult.purchaseToken || purchaseResult.transactionId,
            },
          }
        );

        if (verifyError || data?.error) {
          throw new Error(data?.error || verifyError?.message || "Receipt verification failed");
        }

        // NativePurchases auto-acknowledges purchases by default

        setPurchaseState("success");
        return true;
      } catch (err: any) {
        const message = err?.message || "Purchase failed";
        // Don't treat user cancellation as an error
        const lowerMessage = message.toLowerCase();
        if (
          lowerMessage.includes("cancel") ||
          lowerMessage.includes("user_canceled") ||
          lowerMessage.includes("not purchased") ||
          lowerMessage.includes("payment not completed")
        ) {
          setPurchaseState("idle");
          return false;
        }
        // Handle Apple Sandbox "account temporarily unavailable" error gracefully
        if (
          lowerMessage.includes("temporarily unavailable") ||
          lowerMessage.includes("sandbox") ||
          lowerMessage.includes("cannot connect to itunes")
        ) {
          console.warn("[IAP] Sandbox/store connectivity issue:", message);
          setError("Unable to connect to the App Store. Please check your network connection and try again.");
          setPurchaseState("error");
          return false;
        }
        console.error("[IAP] Purchase error:", err);
        setError(message);
        setPurchaseState("error");
        return false;
      }
    },
    [user]
  );

  return { purchaseProduct, purchaseState, error, isAvailable };
}

// Helper to get the correct product ID
export function getClubUpgradeProductId(
  tier: "pro" | "pro_football",
  plan: "starter" | "standard" | "unlimited",
  isAnnual: boolean
): string {
  const key = `${tier === "pro" ? "pro" : "pro_football"}_${plan}_${isAnnual ? "annual" : "monthly"}` as keyof typeof IAP_PRODUCT_IDS;
  return IAP_PRODUCT_IDS[key];
}

export function getTeamUpgradeProductId(
  tier: "pro" | "pro_football",
  isAnnual: boolean
): string {
  const key = `team_${tier === "pro" ? "pro" : "pro_football"}_${isAnnual ? "annual" : "monthly"}` as keyof typeof IAP_PRODUCT_IDS;
  return IAP_PRODUCT_IDS[key];
}

export function getStorageProductId(
  packId: string,
  isAnnual: boolean
): string {
  const key = `storage_${packId}_${isAnnual ? "annual" : "monthly"}` as keyof typeof IAP_PRODUCT_IDS;
  return IAP_PRODUCT_IDS[key];
}
