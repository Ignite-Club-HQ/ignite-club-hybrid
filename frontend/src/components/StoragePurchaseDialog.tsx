import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { isNativePlatform } from "@/lib/nativePush";
import { HardDrive, Loader2, Check, Crown, Package, Ticket, Minus, AlertTriangle, Calendar, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SubscriptionLegalLinks } from "@/components/SubscriptionLegalLinks";
import { invalidateProAccessQueries } from "@/lib/invalidateProAccess";

const STORAGE_PACKS = [
  { id: '10gb', gb: 10, priceMonthly: 4.99, priceAnnual: 49.99, popular: false },
  { id: '50gb', gb: 50, priceMonthly: 14.99, priceAnnual: 149.99, popular: true },
];

interface StoragePurchaseDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  clubId: string;
  clubName: string;
  currentStorageLimit: number; // in bytes
  purchasedStorageGb: number;
  scheduledDowngradeGb?: number | null;
  storageDowngradeAt?: string | null;
}

export function StoragePurchaseDialog({
  open,
  onOpenChange,
  clubId,
  clubName,
  currentStorageLimit,
  purchasedStorageGb,
  scheduledDowngradeGb,
  storageDowngradeAt,
}: StoragePurchaseDialogProps) {
  const [selectedPack, setSelectedPack] = useState<string | null>(null);
  const [isAnnual, setIsAnnual] = useState(false);
  const [promoCode, setPromoCode] = useState("");
  const [showDowngradeConfirm, setShowDowngradeConfirm] = useState(false);
  const [downgradeTarget, setDowngradeTarget] = useState<number>(0);
  const queryClient = useQueryClient();

  // Check if Stripe is configured
  const { data: hasStripeConfig } = useQuery({
    queryKey: ["has-stripe-config", clubId],
    queryFn: async () => {
      // Check club-level config first
      const { data: clubConfig } = await supabase
        .from("club_stripe_configs")
        .select("is_enabled")
        .eq("club_id", clubId)
        .eq("is_enabled", true)
        .maybeSingle();

      if (clubConfig) return true;

      // Fall back to app-level config
      const { data: appConfig } = await supabase
        .from("app_stripe_config")
        .select("is_enabled")
        .eq("is_enabled", true)
        .maybeSingle();

      return !!appConfig;
    },
    enabled: open,
  });

  const purchaseMutation = useMutation({
    mutationFn: async (packType: string) => {
      const { data, error } = await supabase.functions.invoke('create-storage-checkout', {
        body: {
          clubId,
          packType,
          isAnnual,
          successUrl: `${window.location.origin}/vault?success=storage`,
          cancelUrl: `${window.location.origin}/vault?cancelled=true`,
        },
      });

      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      if (data?.url) {
        window.location.href = data.url;
      }
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to start checkout");
    },
  });

  const applyPromoMutation = useMutation({
    mutationFn: async (code: string) => {
      // Validate promo code
      const { data: promoData, error: promoError } = await supabase
        .from("promo_codes")
        .select("id, is_active, expires_at, access_level, club_id, storage_gb")
        .ilike("code", code.trim())
        .maybeSingle();

      if (promoError) throw promoError;
      if (!promoData) throw new Error("Invalid promo code");
      if (!promoData.is_active) throw new Error("This promo code is no longer active");
      if (promoData.expires_at && new Date(promoData.expires_at) < new Date()) {
        throw new Error("This promo code has expired");
      }
      if (promoData.access_level !== "storage" && !promoData.storage_gb) {
        throw new Error("This promo code is not valid for storage");
      }
      if (promoData.club_id && promoData.club_id !== clubId) {
        throw new Error("This promo code is not valid for this club");
      }

      const storageGb = promoData.storage_gb || 0;
      if (storageGb <= 0) throw new Error("This promo code does not grant storage");

      // Apply storage to club subscription
      const { data: subscription, error: subError } = await supabase
        .from("club_subscriptions")
        .select("storage_purchased_gb")
        .eq("club_id", clubId)
        .maybeSingle();

      if (subError) throw subError;

      const currentStorage = subscription?.storage_purchased_gb || 0;
      const newStorage = currentStorage + storageGb;

      const { error: updateError } = await supabase
        .from("club_subscriptions")
        .update({ storage_purchased_gb: newStorage })
        .eq("club_id", clubId);

      if (updateError) throw updateError;

      // Increment uses count
      await supabase
        .from("promo_codes")
        .update({ uses_count: (promoData as any).uses_count + 1 })
        .eq("id", promoData.id);

      return { storageGb, newTotal: newStorage };
    },
    onSuccess: (data) => {
      toast.success(`Added ${data.storageGb}GB storage! Total: ${data.newTotal}GB`);
      setPromoCode("");
      queryClient.invalidateQueries({ queryKey: ["purchased-storage", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      invalidateProAccessQueries(queryClient);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to apply promo code");
    },
  });

  const downgradeMutation = useMutation({
    mutationFn: async (newStorageGb: number) => {
      // Schedule downgrade for end of billing period (approximately 1 month from now)
      const downgradeDate = new Date();
      downgradeDate.setMonth(downgradeDate.getMonth() + 1);
      
      const { error } = await supabase
        .from("club_subscriptions")
        .update({ 
          scheduled_storage_downgrade_gb: newStorageGb,
          storage_downgrade_at: downgradeDate.toISOString()
        })
        .eq("club_id", clubId);

      if (error) throw error;
      return { newStorageGb, downgradeDate };
    },
    onSuccess: ({ newStorageGb, downgradeDate }) => {
      const formattedDate = downgradeDate.toLocaleDateString();
      toast.success(newStorageGb === 0 
        ? `Storage downgrade to base (5GB) scheduled for ${formattedDate}` 
        : `Storage downgrade to ${newStorageGb}GB scheduled for ${formattedDate}`
      );
      setShowDowngradeConfirm(false);
      queryClient.invalidateQueries({ queryKey: ["purchased-storage", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      invalidateProAccessQueries(queryClient);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to schedule storage downgrade");
    },
  });

  const cancelDowngradeMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("club_subscriptions")
        .update({ 
          scheduled_storage_downgrade_gb: null,
          storage_downgrade_at: null
        })
        .eq("club_id", clubId);

      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Scheduled downgrade cancelled");
      queryClient.invalidateQueries({ queryKey: ["purchased-storage", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      invalidateProAccessQueries(queryClient);
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to cancel downgrade");
    },
  });

  const handlePurchase = async () => {
    if (!selectedPack) {
      toast.error("Please select a storage pack");
      return;
    }
    if (isNativePlatform()) {
      // On native, use In-App Purchases
      handleNativeStoragePurchase();
      return;
    }
    purchaseMutation.mutate(selectedPack);
  };

  const handleNativeStoragePurchase = async () => {
    if (!selectedPack) return;
    const { getStorageProductId } = await import("@/hooks/useInAppPurchase");
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;

    const productId = getStorageProductId(selectedPack, isAnnual);

    // Close dialog first so native purchase dialogs/errors aren't hidden behind it
    onOpenChange(false);

    try {
      const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");

      // Verify product exists in store, preferring SUBS and falling back to INAPP
      const productTypesToCheck = [PURCHASE_TYPE.SUBS, PURCHASE_TYPE.INAPP];
      let matchedProduct: any = null;
      let matchedPurchaseType: any = PURCHASE_TYPE.SUBS;

      for (const type of productTypesToCheck) {
        const result = await NativePurchases.getProducts({
          productIdentifiers: [productId],
          productType: type,
        });

        if (result?.products?.length) {
          matchedProduct = result.products[0];
          matchedPurchaseType = type;
          break;
        }
      }

      if (!matchedProduct) {
        toast.error("This storage pack is not available for in-app purchase on this build.");
        console.error("[IAP] Product not found in store:", { productId, platform: Capacitor.getPlatform() });
        return;
      }

      const purchaseOptions: any = {
        productIdentifier: productId,
        productType: matchedPurchaseType,
      };

      // Android subscriptions require a plan identifier
      if (Capacitor.getPlatform() === "android" && matchedPurchaseType === PURCHASE_TYPE.SUBS) {
        purchaseOptions.planIdentifier = productId;
      }

      const purchaseResult = await NativePurchases.purchaseProduct(purchaseOptions);

      if (!purchaseResult?.transactionId) {
        throw new Error("Purchase was cancelled");
      }

      const { data, error } = await supabase.functions.invoke("verify-iap-receipt", {
        body: {
          platform: Capacitor.getPlatform(),
          transactionId: purchaseResult.transactionId,
          productId,
          entityId: clubId,
          entityType: "club",
          receipt: purchaseResult.receipt || purchaseResult.purchaseToken || purchaseResult.transactionId,
        },
      });

      if (error || data?.error) throw new Error(data?.error || "Verification failed");

      queryClient.invalidateQueries({ queryKey: ["purchased-storage", clubId] });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      invalidateProAccessQueries(queryClient);
      toast.success("Storage purchased successfully!");
    } catch (err: any) {
      const msg = err?.message?.toLowerCase() || "";
      if (msg.includes("cancel") || msg.includes("not purchased") || msg.includes("payment not completed")) return;
      console.error("[IAP] Error:", err);
      toast.error(err?.message || "Purchase failed. Please try again.");
    }
  };

  const handleApplyPromo = async () => {
    if (!promoCode.trim()) {
      toast.error("Please enter a promo code");
      return;
    }
    try {
      await applyPromoMutation.mutateAsync(promoCode);
    } catch {
      // Clear the promo code on failure
      setPromoCode("");
    }
  };

  const handleDowngrade = (targetGb: number) => {
    setDowngradeTarget(targetGb);
    // Close the main dialog first to prevent overlay conflicts
    onOpenChange(false);
    // Small delay to let the main dialog close, then show confirmation
    setTimeout(() => {
      setShowDowngradeConfirm(true);
    }, 100);
  };

  const confirmDowngrade = () => {
    downgradeMutation.mutate(downgradeTarget);
  };

  const handleCancelDowngrade = () => {
    setShowDowngradeConfirm(false);
    // Reopen the main dialog
    setTimeout(() => {
      onOpenChange(true);
    }, 100);
  };

  const baseStorageGb = 5; // Base Pro storage
  const totalStorageGb = baseStorageGb + purchasedStorageGb;

  const formatPrice = (monthly: number, annual: number) => {
    if (isAnnual) {
      const savedAmount = monthly * 12 - annual;
      return (
        <div className="text-right">
          <span className="text-lg font-bold">${annual}/yr</span>
          <p className="text-xs text-green-500">Save ${savedAmount}</p>
        </div>
      );
    }
    return <span className="text-lg font-bold">${monthly}/mo</span>;
  };

  // Generate downgrade options
  const downgradeOptions = [];
  if (purchasedStorageGb > 0) {
    downgradeOptions.push({ gb: 0, label: "Reset to Base (5GB)" });
    if (purchasedStorageGb > 10) {
      downgradeOptions.push({ gb: 10, label: "Reduce to +10GB" });
    }
    if (purchasedStorageGb > 25) {
      downgradeOptions.push({ gb: 25, label: "Reduce to +25GB" });
    }
    if (purchasedStorageGb > 50) {
      downgradeOptions.push({ gb: 50, label: "Reduce to +50GB" });
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-[calc(100vw-2rem)] sm:max-w-md max-h-[85vh] overflow-y-auto p-4 sm:p-6 rounded-2xl">
          <DialogHeader className="space-y-1 pb-1">
            <DialogTitle className="flex items-center gap-2 text-base">
              <div className="p-1.5 rounded-lg bg-primary/10">
                <Package className="h-4 w-4 text-primary" />
              </div>
              Manage Storage
            </DialogTitle>
            <DialogDescription className="text-xs">
              Storage capacity for {clubName}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3">
            {/* Current storage summary — compact pill */}
            <div className="bg-muted/60 rounded-xl p-2.5 flex items-center justify-between text-xs">
              <div className="flex items-center gap-3">
                <div className="flex flex-col">
                  <span className="text-muted-foreground">Base</span>
                  <span className="font-semibold">{baseStorageGb}GB</span>
                </div>
                {purchasedStorageGb > 0 && (
                  <>
                    <span className="text-muted-foreground">+</span>
                    <div className="flex flex-col">
                      <span className="text-muted-foreground">Add-ons</span>
                      <span className="font-semibold text-primary">{purchasedStorageGb}GB</span>
                    </div>
                  </>
                )}
              </div>
              <div className="flex flex-col items-end">
                <span className="text-muted-foreground">Total</span>
                <span className="font-bold text-sm">{totalStorageGb}GB</span>
              </div>
            </div>

            {/* Promo Code — hidden on native per App Store 3.1.1 */}
            {!isNativePlatform() && (
              <div className="space-y-1.5">
                <Label className="flex items-center gap-1.5 text-xs">
                  <Ticket className="h-3.5 w-3.5" />
                  Redeem Promo Code
                </Label>
                <div className="flex gap-2">
                  <Input
                    placeholder="Enter code"
                    value={promoCode}
                    onChange={(e) => setPromoCode(e.target.value.toUpperCase())}
                    className="uppercase h-9 text-sm"
                  />
                  <Button
                    size="sm"
                    onClick={handleApplyPromo}
                    disabled={!promoCode.trim() || applyPromoMutation.isPending}
                    className="h-9 px-4"
                  >
                    {applyPromoMutation.isPending ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      "Apply"
                    )}
                  </Button>
                </div>
              </div>
            )}

            <Separator className="my-1" />

            {/* Scheduled Downgrade Banner */}
            {scheduledDowngradeGb != null && storageDowngradeAt && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-3 space-y-2">
                <div className="flex items-center gap-2 text-amber-600">
                  <Calendar className="h-3.5 w-3.5" />
                  <span className="text-xs font-medium">Downgrade Scheduled</span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Storage will reduce to {scheduledDowngradeGb === 0 ? "base 5GB" : `${scheduledDowngradeGb}GB`} on {new Date(storageDowngradeAt).toLocaleDateString()}
                </p>
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs"
                  onClick={() => cancelDowngradeMutation.mutate()}
                  disabled={cancelDowngradeMutation.isPending}
                >
                  {cancelDowngradeMutation.isPending ? (
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                  ) : (
                    <X className="h-3.5 w-3.5 mr-1.5" />
                  )}
                  Cancel Downgrade
                </Button>
              </div>
            )}

            {/* Downgrade Section */}
            {purchasedStorageGb > 0 && scheduledDowngradeGb == null && (
              <>
                <div className="space-y-2">
                  <Label className="flex items-center gap-1.5 text-xs">
                    <Minus className="h-3.5 w-3.5" />
                    Schedule Reduction
                  </Label>
                  <p className="text-[11px] text-muted-foreground leading-relaxed">
                    Takes effect at your next renewal date.
                  </p>
                  <div className="flex flex-wrap gap-1.5">
                    {downgradeOptions.map((option) => (
                      <Button
                        key={option.gb}
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs px-2.5 rounded-lg"
                        onClick={() => handleDowngrade(option.gb)}
                        disabled={downgradeMutation.isPending}
                      >
                        {option.label}
                      </Button>
                    ))}
                  </div>
                </div>
                <Separator className="my-1" />
              </>
            )}

            {/* Billing toggle */}
            <div className="flex items-center justify-between py-1">
              <Label htmlFor="annual-billing" className="text-xs font-medium">Annual billing</Label>
              <div className="flex items-center gap-2">
                <Switch
                  id="annual-billing"
                  checked={isAnnual}
                  onCheckedChange={setIsAnnual}
                />
                {isAnnual && (
                  <Badge variant="secondary" className="text-[10px] px-1.5 py-0.5 bg-green-500/15 text-green-600 border-0">
                    Save 17%
                  </Badge>
                )}
              </div>
            </div>

            {/* Storage packs — mobile-optimised cards */}
            <div className="space-y-2">
              {STORAGE_PACKS.map((pack) => {
                const isSelected = selectedPack === pack.id;
                return (
                  <button
                    key={pack.id}
                    type="button"
                    className={`w-full text-left rounded-xl border-2 p-3 transition-all active:scale-[0.98] ${
                      isSelected
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-border bg-card hover:border-primary/40"
                    }`}
                    onClick={() => setSelectedPack(pack.id)}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`p-2 rounded-lg shrink-0 ${isSelected ? 'bg-primary/15' : 'bg-muted'}`}>
                        <HardDrive className={`h-4 w-4 ${isSelected ? 'text-primary' : 'text-muted-foreground'}`} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="font-semibold text-sm">{pack.gb}GB</span>
                          {pack.popular && (
                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">Popular</Badge>
                          )}
                        </div>
                        <p className="text-[11px] text-muted-foreground">Additional club storage</p>
                      </div>
                      <div className="text-right shrink-0">
                        {isAnnual ? (
                          <div>
                            <span className="text-sm font-bold">${pack.priceAnnual}</span>
                            <span className="text-[10px] text-muted-foreground">/yr</span>
                            <p className="text-[10px] text-green-600 font-medium">
                              Save ${(pack.priceMonthly * 12 - pack.priceAnnual).toFixed(0)}
                            </p>
                          </div>
                        ) : (
                          <div>
                            <span className="text-sm font-bold">${pack.priceMonthly}</span>
                            <span className="text-[10px] text-muted-foreground">/mo</span>
                          </div>
                        )}
                      </div>
                      <div className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-colors ${
                        isSelected ? 'border-primary bg-primary' : 'border-muted-foreground/30'
                      }`}>
                        {isSelected && <Check className="h-3 w-3 text-primary-foreground" />}
                      </div>
                    </div>
                  </button>
                );
              })}
            </div>

            {/* Coming soon — web only */}
            {hasStripeConfig === false && !isNativePlatform() && (
              <div className="bg-muted/50 rounded-xl p-3 text-center space-y-0.5">
                <p className="text-xs font-medium">Storage purchases coming soon!</p>
                <p className="text-[11px] text-muted-foreground">
                  Use a promo code to add storage, or check back later.
                </p>
              </div>
            )}

            {/* Purchase button */}
            <Button
              className="w-full h-11 text-sm font-semibold rounded-xl"
              onClick={handlePurchase}
              disabled={!selectedPack || (!hasStripeConfig && !isNativePlatform()) || purchaseMutation.isPending}
            >
              {purchaseMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Processing...
                </>
              ) : (
                <>
                  <Crown className="h-4 w-4 mr-2" />
                  Purchase Storage
                </>
              )}
            </Button>

            <p className="text-[10px] text-center text-muted-foreground leading-relaxed">
              Billed as a recurring subscription. Cancel anytime.
            </p>

            <SubscriptionLegalLinks />
          </div>
        </DialogContent>
      </Dialog>

      {/* Downgrade Confirmation Dialog */}
      <AlertDialog 
        open={showDowngradeConfirm} 
        onOpenChange={(open) => {
          if (!downgradeMutation.isPending && !open) {
            handleCancelDowngrade();
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <AlertTriangle className="h-5 w-5 text-destructive" />
              Confirm Storage Reduction
            </AlertDialogTitle>
            <AlertDialogDescription>
              {downgradeTarget === 0 
                ? "This will schedule your storage to reset to the base 5GB Pro allocation at the end of your current billing period."
                : `This will schedule your storage reduction to ${downgradeTarget}GB (${baseStorageGb + downgradeTarget}GB total) at the end of your current billing period.`
              }
              <br /><br />
              <strong>The downgrade will take effect at your next renewal date.</strong> Any files exceeding the new limit may become inaccessible after the downgrade.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button
              variant="outline"
              onClick={handleCancelDowngrade}
              disabled={downgradeMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={confirmDowngrade}
              disabled={downgradeMutation.isPending}
            >
              {downgradeMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Schedule Downgrade
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}