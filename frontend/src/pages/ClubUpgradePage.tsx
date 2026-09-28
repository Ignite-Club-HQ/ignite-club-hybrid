import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isNativePlatform } from "@/lib/nativePush";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { ArrowLeft, Crown, Loader2, Target, ArrowDown, Calendar, AlertCircle, Building2, Users, Heart, ExternalLink, Flame } from "lucide-react";
import { differenceInDays } from "date-fns";
import { isPast, parseISO, format, addMonths, addYears } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  UpgradeAccessDeniedState,
  UpgradeLoadingState,
  UpgradeNotFoundState,
  UpgradeOfferCard,
  UpgradeTrialBanner,
} from "@/components/subscription/UpgradePlanPresentation";
import { useClubTheme } from "@/hooks/useClubTheme";
import { invalidateProAccessQueries } from "@/lib/invalidateProAccess";
import { useDesktopUpgradeGate } from "@/hooks/useDesktopUpgradeGate";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabClubDetail, getLocalLabTeamList } from "@/lab/fixtureDataLayer";


const PRO_FEATURES = [
  "Club Chat (club-wide messaging)",
  "DMs & custom groups",
  "Unlimited photo & media uploads (Free: 10/month)",
  "Unlimited file storage (Free: 10 files / 25 MB)",
  "Unlimited polls (Free: 2/month)",
  "Scheduled messages",
  "Pinned vault files in chat",
  "Subfolder organization",
  "Points & rewards system",
  "Duty point awards",
  "Priority support",
];

const PRO_FOOTBALL_FEATURES = [
  ...PRO_FEATURES,
  "Soccer Pitch Board",
  "Tactical Formations",
  "Player Positioning",
  "Drawing Tools & Arrows",
  "Formation Saving",
  "Game Timer",
  "Automated Substitutions",
];

// Club pricing in AUD
const CLUB_PRICING = {
  pro: {
    starter: { monthly: 89.99, annual: 949.99, teamLimit: 10 },
    standard: { monthly: 149.99, annual: 1449.99, teamLimit: 20 },
    unlimited: { monthly: 199, annual: null, teamLimit: null },
  },
  proFootball: {
    starter: { monthly: 149, annual: null, teamLimit: 10 },
    standard: { monthly: 229.99, annual: null, teamLimit: 20 },
    unlimited: { monthly: 299, annual: null, teamLimit: null },
  },
};

// Check if club sport is soccer/football
const isSoccerClub = (sport: string | null | undefined): boolean => {
  if (!sport) return false;
  const lowerSport = sport.toLowerCase();
  return lowerSport.includes("soccer") || lowerSport.includes("football") || lowerSport.includes("futsal");
};

type PlanTier = "starter" | "standard" | "unlimited";
type UpgradeClub = Pick<
  Database["public"]["Tables"]["clubs"]["Row"],
  "id" | "name" | "sport" | "class_mode_enabled"
>;
type UpgradeTeam = Pick<Database["public"]["Tables"]["teams"]["Row"], "id" | "name" | "logo_url" | "level_age">;

export default function ClubUpgradePage() {
  const { clubId } = useParams<{ clubId: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { activeClubFilter } = useClubTheme();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const providerKey = useIcpLab ? "icp" : "supabase";
  const [promoCode, setPromoCode] = useState("");
  const [promoCodeFootball, setPromoCodeFootball] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [selectedTab, setSelectedTab] = useState("pro");
  const [selectedPlan, setSelectedPlan] = useState<PlanTier>("starter");
  const [selectedPlanFootball, setSelectedPlanFootball] = useState<PlanTier>("starter");
  const [isAnnualPro, setIsAnnualPro] = useState(false);
  const [isAnnualProFootball, setIsAnnualProFootball] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const [teamSelectOpen, setTeamSelectOpen] = useState(false);
  const { showIfDesktop, dialog: desktopUpgradeDialog } = useDesktopUpgradeGate();


  useEffect(() => {
    if (useIcpLab || !activeClubFilter || !clubId || activeClubFilter === clubId) return;
    const query = searchParams.toString();
    navigate(`/clubs/${activeClubFilter}/upgrade${query ? `?${query}` : ""}`, { replace: true });
  }, [useIcpLab, activeClubFilter, clubId, navigate, searchParams]);

  // Handle payment success/cancelled from URL params
  useEffect(() => {
    if (useIcpLab) return;
    const paymentStatus = searchParams.get('payment');
    if (paymentStatus === 'success') {
      toast({
        title: "Payment Successful!",
        description: "Your club subscription is now active.",
      });
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      invalidateProAccessQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
    } else if (paymentStatus === 'cancelled') {
      toast({
        title: "Payment Cancelled",
        description: "Your subscription was not activated.",
        variant: "destructive",
      });
    }
  }, [useIcpLab, searchParams, toast, queryClient, clubId]);

  // Check if user is a club admin
  const { data: isClubAdmin, isLoading: loadingAdminCheck } = useQuery({
    queryKey: ["is-club-admin", user?.id, clubId, providerKey],
    queryFn: async () => {
      if (useIcpLab) return true;
      const { data } = await supabase
        .from("user_roles")
        .select("role, club_id")
        .eq("user_id", user!.id);
      
      if (!data) return false;
      
      // App admin can access all
      if (data.some(r => r.role === "app_admin")) return true;
      
      // Club admin for this club
      if (data.some(r => r.role === "club_admin" && r.club_id === clubId)) return true;
      
      return false;
    },
    enabled: !!user && !!clubId,
  });

  const { data: club, isLoading: clubLoading } = useQuery<UpgradeClub | null>({
    queryKey: ["club", clubId, "upgrade", providerKey],
    queryFn: async () => {
      if (useIcpLab) {
        const fixture = getLocalLabClubDetail(clubId!);
        return fixture ? {
          id: fixture.id,
          name: fixture.name,
          sport: fixture.sport,
          class_mode_enabled: false,
        } : null;
      }
      const { data, error } = await supabase
        .from("clubs")
        .select("*")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  const { data: teamCount = 0 } = useQuery({
    queryKey: ["club-team-count", clubId, providerKey],
    queryFn: async () => {
      if (useIcpLab) return getLocalLabTeamList().filter((team) => team.club_id === clubId).length;
      const { count, error } = await supabase
        .from("teams")
        .select("*", { count: "exact", head: true })
        .eq("club_id", clubId!);
      if (error) throw error;
      return count || 0;
    },
    enabled: !!clubId,
  });

  // Fetch teams for team-specific upgrade option
  const { data: teams = [] } = useQuery<UpgradeTeam[]>({
    queryKey: ["club-teams", clubId, "upgrade", providerKey],
    queryFn: async () => {
      if (useIcpLab) {
        return getLocalLabTeamList()
          .filter((team) => team.club_id === clubId)
          .map((team) => ({ id: team.id, name: team.name, logo_url: null, level_age: null }));
      }
      const { data, error } = await supabase
        .from("teams")
        .select("id, name, logo_url, level_age")
        .eq("club_id", clubId!)
        .order("name");
      if (error) throw error;
      return data || [];
    },
    enabled: !!clubId,
  });

  const { data: subscription } = useQuery({
    queryKey: ["club-subscription", clubId, providerKey],
    queryFn: async () => {
      if (useIcpLab) return null;
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", clubId!)
        .maybeSingle();
      return data;
    },
    enabled: !!clubId,
  });

  const isProActive = subscription?.is_pro;
  const isProFootballActive = subscription?.is_pro_football;
  const showFootballOption = isSoccerClub(club?.sport);

  const expiresAt = subscription?.expires_at ? parseISO(subscription.expires_at) : null;
  const isExpired = expiresAt ? isPast(expiresAt) : false;
  const currentPlan = subscription?.plan as PlanTier | undefined;
  const currentTeamLimit = subscription?.team_limit;
  const isOnTrial = subscription?.is_trial && subscription?.trial_ends_at && !isPast(parseISO(subscription.trial_ends_at));
  const trialEndsAt = subscription?.trial_ends_at ? parseISO(subscription.trial_ends_at) : null;

  // Check if subscription is near expiry (within 30 days) or expired
  const daysUntilExpiry = expiresAt ? differenceInDays(expiresAt, new Date()) : null;
  const isNearExpiry = daysUntilExpiry !== null && daysUntilExpiry <= 30 && daysUntilExpiry > 0;
  const isNative = isNativePlatform();
  const isClassMode = !!club?.class_mode_enabled;
  const showSponsorOption = false;

  // Query active sponsors for this club to determine if sponsor-funded
  const { data: activeSponsors = [] } = useQuery({
    queryKey: ["club-active-sponsors", clubId, providerKey],
    queryFn: async () => {
      if (useIcpLab) return [];
      const { data } = await supabase
        .from("sponsors")
        .select("id, name, logo_url, is_active")
        .eq("club_id", clubId!)
        .eq("is_active", true)
        .order("display_order");
      return data || [];
    },
    enabled: !!clubId,
  });

  const isSponsorFunded = activeSponsors.length > 0 && (isProActive || isProFootballActive);

  // Realtime listener for subscription changes (e.g. sponsor payment on website)
  useEffect(() => {
    if (useIcpLab || !clubId) return;
    const channel = supabase
      .channel(`club-sub-${clubId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "club_subscriptions",
          filter: `club_id=eq.${clubId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
          invalidateProAccessQueries(queryClient);
          queryClient.invalidateQueries({ queryKey: ["club", clubId] });
          queryClient.invalidateQueries({ queryKey: ["club-active-sponsors", clubId] });
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [useIcpLab, clubId, queryClient]);

  const handleGetSponsored = () => {
    const sponsorUrl = "https://reference.invalid";
    import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(sponsorUrl));
  };

  // Determine recommended plan based on team count
  const getRecommendedPlan = (count: number): PlanTier => {
    if (count <= 10) return "starter";
    if (count <= 20) return "standard";
    return "unlimited";
  };

  const recommendedPlan = getRecommendedPlan(teamCount);

  // Check if team count exceeds limit (only relevant if there's an active subscription)
  const isOverLimit = isProActive && currentTeamLimit !== null && teamCount > (currentTeamLimit || 0);

  const applyPromoMutation = useMutation({
    mutationFn: async ({ 
      code, 
      tier, 
      plan, 
      isAnnual 
    }: { 
      code: string; 
      tier: "pro" | "pro_football"; 
      plan: PlanTier;
      isAnnual: boolean;
    }) => {
      // Validate promo code
      const { data: promoData, error: promoError } = await supabase
        .from("promo_codes")
        .select("*")
        .eq("code", code.toUpperCase().trim())
        .eq("is_active", true)
        .maybeSingle();

      if (promoError || !promoData) {
        throw new Error("Invalid or inactive promo code");
      }

      // Check if expired
      if (promoData.expires_at && isPast(parseISO(promoData.expires_at))) {
        throw new Error("This promo code has expired");
      }

      // Validate scope_type matches - must be a club code for club subscription
      if (promoData.scope_type !== 'club') {
        throw new Error("This promo code is for team subscriptions only. Please use a club promo code.");
      }

      // Validate club restriction - if promo code is restricted to a specific club
      if (promoData.club_id && promoData.club_id !== clubId) {
        throw new Error("This promo code is restricted to a different club.");
      }

      // Validate access_level matches selected tier
      if (tier === 'pro_football' && promoData.access_level === 'pro') {
        throw new Error("This promo code is for Pro plan only. Please select the Pro plan or use a Pro Football code.");
      }
      if (tier === 'pro' && promoData.access_level === 'pro_football') {
        throw new Error("This promo code is for Pro Football plan only. Please select the Pro Football plan or use a Pro code.");
      }

      // Calculate team limit based on plan
      const pricing = tier === "pro" ? CLUB_PRICING.pro : CLUB_PRICING.proFootball;
      const teamLimit = pricing[plan].teamLimit;

      // Validate team count doesn't exceed limit
      if (teamLimit !== null && teamCount > teamLimit) {
        throw new Error(`Your club has ${teamCount} teams but the ${plan} plan only supports ${teamLimit}. Please choose a higher plan.`);
      }

      // Use promo code expiry date if set, otherwise default to 1 month/year
      const now = new Date();
      const defaultExpiry = isAnnual ? addYears(now, 1) : addMonths(now, 1);
      const newExpiresAt = promoData.expires_at ? parseISO(promoData.expires_at) : defaultExpiry;

      // Create or update subscription based on tier
      const updateData = tier === "pro" 
        ? { is_pro: true, is_pro_football: false } 
        : { is_pro: true, is_pro_football: true };

      const { error: subError } = await supabase
        .from("club_subscriptions")
        .upsert({
          club_id: clubId!,
          plan: plan,
          team_limit: teamLimit,
          ...updateData,
          promo_code_id: promoData.id,
          activated_at: new Date().toISOString(),
          expires_at: newExpiresAt.toISOString(),
        }, { onConflict: "club_id" });

      if (subError) throw subError;

      // Also update clubs.is_pro for backward compatibility
      await supabase
        .from("clubs")
        .update({ is_pro: true })
        .eq("id", clubId!);

      // Increment promo code usage
      await supabase
        .from("promo_codes")
        .update({ uses_count: promoData.uses_count + 1 })
        .eq("id", promoData.id);

      return { tier, plan };
    },
    onSuccess: ({ tier, plan }) => {
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      invalidateProAccessQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-clubs"] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-teams"] });
      const tierName = tier === "pro" ? "Pro" : "Pro Football";
      const planName = plan.charAt(0).toUpperCase() + plan.slice(1);
      toast({ title: `Club ${tierName} ${planName} Activated!`, description: `All teams now have ${tierName} features.` });
      setPromoCode("");
      setPromoCodeFootball("");
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message, variant: "destructive" });
    },
  });

  const cancelTrialMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('cancel-subscription', {
        body: { subscription_type: 'club', entity_id: clubId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      invalidateProAccessQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
      toast({ title: "Subscription Cancelled", description: "Your subscription has been cancelled. Pro features will remain until the trial ends." });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to cancel subscription.", variant: "destructive" });
    },
  });

  const downgradeMutation = useMutation({
    mutationFn: async (targetTier: "free" | "pro") => {
      if (targetTier === "free") {
        // Check if there's a paid-up subscription still in effect.
        const { data: currentSub } = await supabase
          .from("club_subscriptions")
          .select("expires_at, is_pro, is_pro_football")
          .eq("club_id", clubId!)
          .maybeSingle();

        const expiresAt = currentSub?.expires_at ? new Date(currentSub.expires_at) : null;
        const stillPaidUp = expiresAt && expiresAt.getTime() > Date.now();

        if (stillPaidUp) {
          // Keep Pro active until the paid period ends — just mark as cancelled
          // so it does not auto-renew. is_pro / is_pro_football stay true and
          // gates rely on expires_at to flip the club back to Free at expiry.
          const { error } = await supabase
            .from("club_subscriptions")
            .update({ cancelled_at: new Date().toISOString() })
            .eq("club_id", clubId!);
          if (error) throw error;
          return "free_scheduled" as const;
        }

        // No remaining paid period — remove club subscription immediately.
        await supabase
          .from("club_subscriptions")
          .delete()
          .eq("club_id", clubId!);

        // Also update clubs.is_pro for backward compatibility
        await supabase
          .from("clubs")
          .update({ is_pro: false })
          .eq("id", clubId!);
      } else if (targetTier === "pro") {
        // Downgrade from Pro Football to Pro
        const { error } = await supabase
          .from("club_subscriptions")
          .update({ is_pro_football: false })
          .eq("club_id", clubId!);
        if (error) throw error;
      }
      return targetTier;
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      invalidateProAccessQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-clubs"] });
      queryClient.invalidateQueries({ queryKey: ["upgradable-teams"] });
      const message =
        result === "free_scheduled"
          ? "Subscription cancelled. Pro features remain active until your paid period ends."
          : result === "free"
            ? "Club subscription cancelled. All teams are now on Free plan."
            : "Downgraded to Club Pro plan.";
      toast({ title: "Plan Updated", description: message });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update plan.", variant: "destructive" });
    },
  });

  const handleApplyPromo = async (tier: "pro" | "pro_football") => {
    const code = tier === "pro" ? promoCode : promoCodeFootball;
    const plan = tier === "pro" ? selectedPlan : selectedPlanFootball;
    const annualDisabled = tier === "pro_football" || (tier === "pro" && plan === "unlimited");
    const isAnnual = annualDisabled ? false : (tier === "pro" ? isAnnualPro : isAnnualProFootball);
    if (!code.trim()) return;
    setIsValidating(true);
    try {
      await applyPromoMutation.mutateAsync({ code, tier, plan, isAnnual });
    } catch {
      // Clear the promo code on failure
      if (tier === "pro") {
        setPromoCode("");
      } else {
        setPromoCodeFootball("");
      }
    } finally {
      setIsValidating(false);
    }
  };

  const handleStripeCheckout = async (tier: "pro" | "pro_football", withTrial: boolean = false) => {
    // Block if already subscribed to this tier
    if ((tier === "pro" && isProActive && !isExpired) || (tier === "pro_football" && isProFootballActive && !isExpired)) {
      toast({ title: "Already Subscribed", description: "You already have an active subscription for this plan." });
      return;
    }
    if (isNativePlatform()) {
      // On native, use In-App Purchases
      handleNativeIAP(tier, withTrial);
      return;
    }
    const plan = tier === "pro" ? selectedPlan : selectedPlanFootball;
    const annualDisabledCheckout = tier === "pro_football" || (tier === "pro" && plan === "unlimited");
    const isAnnual = annualDisabledCheckout ? false : (tier === "pro" ? isAnnualPro : isAnnualProFootball);
    setIsCheckingOut(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
        body: {
          subscriptionType: 'club',
          entityId: clubId,
          tier: tier,
          plan: plan,
          isAnnual: isAnnual,
          withTrial: withTrial,
          successUrl: `${window.location.origin}/clubs/${clubId}/upgrade?payment=success`,
          cancelUrl: `${window.location.origin}/clubs/${clubId}/upgrade?payment=cancelled`,
        },
      });

      if (error) throw error;
      if (data?.url) {
        window.location.href = data.url;
      }
    } catch (error) {
      console.error('Checkout error:', error);
      toast({
        title: "Checkout Error",
        description: "Failed to start checkout. Please try again.",
        variant: "destructive",
      });
    } finally {
      setIsCheckingOut(false);
    }
  };

  const handleNativeIAP = async (tier: "pro" | "pro_football", _withTrial: boolean = false) => {
    const { useInAppPurchase, getClubUpgradeProductId } = await import("@/hooks/useInAppPurchase");
    // We can't use hooks dynamically, so we'll handle it inline
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;

    const plan = tier === "pro" ? selectedPlan : selectedPlanFootball;
    const annualDisabledIAP = tier === "pro_football" || (tier === "pro" && plan === "unlimited");
    const isAnnual = annualDisabledIAP ? false : (tier === "pro" ? isAnnualPro : isAnnualProFootball);
    const productId = getClubUpgradeProductId(tier, plan, isAnnual);

    setIsCheckingOut(true);
    try {
      const { NativePurchases, PURCHASE_TYPE } = await import("@capgo/native-purchases");
      const purchaseResult = await NativePurchases.purchaseProduct({
        productIdentifier: productId,
        productType: PURCHASE_TYPE.SUBS,
        ...(Capacitor.getPlatform() === "android" ? { planIdentifier: productId } : {}),
      });

      if (!purchaseResult?.transactionId) {
        throw new Error("Purchase was cancelled");
      }

      // Verify on server
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

      queryClient.invalidateQueries({ queryKey: ["club-subscription", clubId] });
      invalidateProAccessQueries(queryClient);
      queryClient.invalidateQueries({ queryKey: ["club", clubId] });
      toast({ title: "Upgrade Successful!", description: "Your club subscription is now active." });
    } catch (err: any) {
      if (err?.message?.toLowerCase().includes("cancel") || err?.message?.toLowerCase().includes("not purchased")) return;
      console.error("[IAP] Error:", err);
      toast({ title: "Purchase Failed", description: err?.message || "Please try again.", variant: "destructive" });
    } finally {
      setIsCheckingOut(false);
    }
  };

  // Check if Stripe is configured
  const { data: hasStripeConfig } = useQuery({
    queryKey: ["stripe-config-check", clubId, providerKey],
    queryFn: async () => {
      if (useIcpLab) return false;
      // Check club config
      const { data: clubConfig } = await supabase
        .from("club_stripe_configs")
        .select("id, is_enabled")
        .eq("club_id", clubId!)
        .eq("is_enabled", true)
        .maybeSingle();
      
      if (clubConfig) return true;

      // Check app config
      const { data: appConfig } = await supabase
        .from("app_stripe_config")
        .select("id, is_enabled")
        .eq("is_enabled", true)
        .maybeSingle();
      
      return !!appConfig;
    },
    enabled: !!clubId,
  });

  if (useIcpLab) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div>
            <h1 className="text-2xl font-bold">Club Pro Plans</h1>
            <p className="text-sm text-muted-foreground">{club?.name ?? "Synthetic club"}</p>
          </div>
        </div>
        <Card className="border-primary/20 bg-primary/5 max-w-lg">
          <CardContent className="space-y-2 p-6">
            <h2 className="font-semibold">Subscriptions are not enabled in ICP lab mode</h2>
            <p className="text-sm text-muted-foreground">
              Billing, promo codes, trials, in-app purchases, and subscription changes remain unavailable. No payment or club data has been changed.
            </p>
            <p className="text-xs text-muted-foreground">
              Synthetic fixture: {teamCount} {teamCount === 1 ? "team" : "teams"}; no active subscription.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (clubLoading || loadingAdminCheck) {
    return <UpgradeLoadingState />;
  }

  if (!club) {
    return <UpgradeNotFoundState product="club" />;
  }

  if (!isClubAdmin) {
    return (
      <UpgradeAccessDeniedState
        title="Club Pro Plans"
        description="Only club administrators can purchase club subscriptions."
        onBack={() => navigate(-1)}
      />
    );
  }

  const renderExpiryBanner = () => {
    if (!expiresAt || isOnTrial) return null;
    
    if (isExpired) {
      return (
        <Card className="border-destructive/50 bg-destructive/10 mb-4">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-3">
              <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="font-semibold text-destructive">Subscription Expired</p>
                <p className="text-sm text-muted-foreground">
                  Your subscription expired on {format(expiresAt, "dd MMM yyyy")}. 
                  Renew now to continue accessing Pro features.
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      );
    }

    return (
      <Card className={`mb-4 ${isNearExpiry ? "border-amber-500/50 bg-amber-500/10" : "border-primary/30 bg-primary/5"}`}>
        <CardContent className="p-4 space-y-3">
          <div className="flex items-center gap-3">
            <Calendar className={`h-5 w-5 ${isNearExpiry ? "text-amber-500" : "text-primary"} shrink-0`} />
            <div className="flex-1">
              <p className="text-sm">
                <span className="font-medium">{isSponsorFunded ? "Sponsored until:" : "Paid until:"}</span>{" "}
                <span className={`font-semibold ${isNearExpiry ? "text-amber-600" : "text-primary"}`}>
                  {format(expiresAt, "dd MMMM yyyy")}
                </span>
              </p>
              {isNearExpiry && (
                <p className="text-xs text-amber-600 mt-0.5">
                  Expiring in {daysUntilExpiry} days — renew
                </p>
              )}
            </div>
          </div>
          {showSponsorOption && (
            <Button size="sm" variant="outline" onClick={handleGetSponsored} className="w-full">
              <Heart className="h-4 w-4 mr-2 text-pink-500" />
              Get Sponsored
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          )}
        </CardContent>
      </Card>
    );
  };

  const renderTeamCountBanner = () => {
    if (isOverLimit) {
      return (
        <Card className="border-destructive/50 bg-destructive/10 mb-4">
          <CardContent className="p-4 flex items-start gap-3">
            <AlertCircle className="h-5 w-5 text-destructive shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-destructive">Team Limit Exceeded</p>
              <p className="text-sm text-muted-foreground">
                Your club has {teamCount} teams but your current plan only allows {currentTeamLimit}. 
                Please upgrade to continue using Pro features for all teams.
              </p>
            </div>
          </CardContent>
        </Card>
      );
    }
    return null;
  };

  const renderPlanSelector = (
    plan: PlanTier,
    setPlan: (p: PlanTier) => void,
    tier: "pro" | "proFootball"
  ) => {
    const pricing = tier === "pro" ? CLUB_PRICING.pro : CLUB_PRICING.proFootball;

    return (
      <div className="space-y-3 mb-4">
        <Label className="text-sm font-medium">Select Plan</Label>
        <div className="grid gap-2">
          {(["starter", "standard", "unlimited"] as PlanTier[]).map((p) => {
            const planPricing = pricing[p];
            const isRecommended = p === recommendedPlan;
            const isDisabled = planPricing.teamLimit !== null && teamCount > planPricing.teamLimit;

            return (
              <button
                key={p}
                onClick={() => !isDisabled && setPlan(p)}
                disabled={isDisabled}
                className={`w-full p-3 rounded-lg border text-left transition-colors ${
                  plan === p
                    ? "border-primary bg-primary/10"
                    : isDisabled
                    ? "border-muted bg-muted/50 opacity-50 cursor-not-allowed"
                    : "border-border hover:border-primary/50"
                }`}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <span className="font-medium capitalize">{p}</span>
                    {isRecommended && !isDisabled && (
                      <Badge variant="secondary" className="text-xs">Recommended</Badge>
                    )}
                    {isDisabled && (
                      <Badge variant="outline" className="text-xs text-destructive border-destructive">
                        {teamCount} teams exceeds limit
                      </Badge>
                    )}
                  </div>
                  <span className="font-bold">${planPricing.monthly}/mo</span>
                </div>
                <p className="text-sm text-muted-foreground mt-1">
                  {planPricing.teamLimit ? `Up to ${planPricing.teamLimit} teams` : "Unlimited teams"}
                </p>
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  const renderProActiveCard = (tier: "pro" | "pro_football") => {
    const isPro = tier === "pro";
    const Icon = isPro ? Crown : Target;
    const title = isOnTrial 
      ? (isPro ? "Club Pro Trial Active" : "Club Pro Football Trial Active")
      : (isPro ? "Club Pro Active" : "Club Pro Football Active");
    const description = isOnTrial
      ? `Your free trial ${isPro ? "gives all teams full Pro access" : "includes Pro Football features for all teams"}.`
      : (isPro 
        ? "All teams have full access to Pro features."
        : "All teams have access to Pro Football features including Pitch Board.");

    return (
      <Card className={isPro ? "border-yellow-500/50 bg-yellow-500/10" : "border-emerald-500/50 bg-emerald-500/10"}>
        <CardContent className="p-6 text-center space-y-4">
          <Icon className={`h-12 w-12 ${isPro ? "text-yellow-500" : "text-emerald-500"} mx-auto`} />
          <div>
            <h2 className="text-xl font-bold">{title}</h2>
            {isOnTrial && (
              <Badge className="mt-2 bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                Free Trial
              </Badge>
            )}
            <p className="text-muted-foreground mt-2">{description}</p>
          </div>

          {currentPlan && (
            <div className="flex flex-col items-center gap-1">
              <Badge variant="outline" className="text-base px-4 py-1">
                {currentPlan.charAt(0).toUpperCase() + currentPlan.slice(1)} Plan
                {currentTeamLimit ? ` (${teamCount}/${currentTeamLimit} teams)` : " (Unlimited teams)"}
              </Badge>
              {!isOnTrial && (
                <Badge variant="secondary" className="text-xs">
                  {isSponsorFunded ? "Sponsor-funded" : "Self-paid"}
                </Badge>
              )}
            </div>
          )}

          {/* Sponsor attribution logos */}
          {!isOnTrial && isSponsorFunded && activeSponsors.length > 0 && (
            <div className="space-y-2">
              <p className="text-xs text-muted-foreground">Sponsored by</p>
              <div className="flex items-center justify-center gap-3 flex-wrap">
                {activeSponsors.slice(0, 4).map((s) => (
                  <div key={s.id} className="flex items-center gap-1.5">
                    {s.logo_url && (
                      <img src={s.logo_url} alt={s.name} className="h-6 w-6 rounded object-contain" />
                    )}
                    <span className="text-xs font-medium">{s.name}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isOnTrial && trialEndsAt && (
            <div className="p-3 rounded-lg bg-amber-500/10 flex items-center justify-center gap-2">
              <Flame className="h-4 w-4 text-amber-500" />
              <span className="text-sm">
                Trial ends <strong>{format(trialEndsAt, "dd MMMM yyyy")}</strong>
              </span>
            </div>
          )}
          
          {!isOnTrial && expiresAt && (
            <div className={`p-3 rounded-lg ${isExpired ? 'bg-destructive/10' : 'bg-muted/50'} flex flex-col items-center gap-1`}>
              <div className="flex items-center gap-2">
                <Calendar className={`h-4 w-4 ${isExpired ? 'text-destructive' : 'text-muted-foreground'}`} />
                <span className={`text-sm ${isExpired ? 'text-destructive font-semibold' : ''}`}>
                  {isExpired ? 'Payment failed on ' : (isSponsorFunded ? 'Sponsored until ' : 'Auto-renews on ')}
                  <strong>{format(expiresAt, "dd MMMM yyyy")}</strong>
                </span>
              </div>
              {!isExpired && !isSponsorFunded && (
                <p className="text-xs text-muted-foreground">
                  You'll receive a reminder 7 days before renewal
                </p>
              )}
            </div>
          )}

          {isExpired && !isOnTrial && (
            <div className="space-y-2">
              <p className="text-sm text-destructive text-center">
                Your payment failed. Please update your payment method.
              </p>
            </div>
          )}

          {!isOnTrial && showSponsorOption && !isExpired && (
            <Button variant="outline" size="sm" onClick={handleGetSponsored} className="w-full">
              <Heart className="h-4 w-4 mr-2 text-pink-500" />
              Get Sponsored
              <ExternalLink className="h-3 w-3 ml-1" />
            </Button>
          )}

          <div className="flex flex-col gap-2">
            {isOnTrial && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive border-destructive/30 hover:bg-destructive/10">
                    Cancel Subscription
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel Subscription?</AlertDialogTitle>
                    <AlertDialogDescription>
                      Your trial will remain active until the expiry date. After that, Pro features will be removed from all teams and no payment will be taken.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Keep Subscription</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => cancelTrialMutation.mutate()}
                      disabled={cancelTrialMutation.isPending}
                    >
                      {cancelTrialMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Cancel Subscription
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {!isOnTrial && tier === "pro_football" && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-muted-foreground">
                    <ArrowDown className="h-4 w-4 mr-2" />
                    Downgrade to Club Pro
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Downgrade to Club Pro?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove Pitch Board access from all teams but keep all other Pro features.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      onClick={() => downgradeMutation.mutate("pro")}
                      disabled={downgradeMutation.isPending}
                    >
                      {downgradeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Downgrade to Pro
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
            {!isOnTrial && (
              <AlertDialog>
                <AlertDialogTrigger asChild>
                  <Button variant="outline" className="text-destructive border-destructive hover:bg-destructive/10">
                    <ArrowDown className="h-4 w-4 mr-2" />
                    Cancel Club Subscription
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Cancel Club Subscription?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove all Pro features from all teams in your club. Individual teams can still upgrade separately.
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>Cancel</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      onClick={() => downgradeMutation.mutate("free")}
                      disabled={downgradeMutation.isPending}
                    >
                      {downgradeMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                      Confirm Cancellation
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            )}
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderPricingCard = (tier: "pro" | "pro_football") => {
    const isPro = tier === "pro";
    const pricing = isPro ? CLUB_PRICING.pro : CLUB_PRICING.proFootball;
    const features = isPro ? PRO_FEATURES : PRO_FOOTBALL_FEATURES;
    const plan = isPro ? selectedPlan : selectedPlanFootball;
    const setPlan = isPro ? setSelectedPlan : setSelectedPlanFootball;
    const isAnnual = isPro ? isAnnualPro : isAnnualProFootball;
    const setIsAnnual = isPro ? setIsAnnualPro : setIsAnnualProFootball;
    const code = isPro ? promoCode : promoCodeFootball;
    const setCode = isPro ? setPromoCode : setPromoCodeFootball;
    const annualDisabled = !isPro || plan === "unlimited";
    const effectiveIsAnnual = annualDisabled ? false : isAnnual;
    const monthlyPrice = pricing[plan].monthly;
    const annualPrice = pricing[plan].annual;
    const annualSavings = annualPrice ? Math.round(monthlyPrice * 12 - annualPrice) : undefined;

    return (
      <UpgradeOfferCard
        header={
          <>
            <div className="flex items-center justify-center gap-2 mb-2">
              <Building2 className="h-5 w-5 text-muted-foreground" />
              <Badge className={isPro ? "bg-yellow-500 text-yellow-950" : "bg-emerald-500 text-emerald-950"}>
                CLUB {isPro ? "PRO" : "PRO FOOTBALL"}
              </Badge>
            </div>
            <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground mb-4">
              <Users className="h-4 w-4" />
              <span>Your club: {teamCount} teams</span>
            </div>
            {renderPlanSelector(plan, setPlan, isPro ? "pro" : "proFootball")}
          </>
        }
        appearance={{
          cardClassName: isPro ? "border-primary/30" : "border-emerald-500/30",
          checkBackgroundClassName: isPro ? "bg-primary/20" : "bg-emerald-500/20",
          checkTextClassName: isPro ? "text-primary" : "text-emerald-500",
          subscribeClassName: isPro ? undefined : "bg-emerald-600 hover:bg-emerald-700",
        }}
        pricing={{
          price: effectiveIsAnnual ? annualPrice : monthlyPrice,
          period: effectiveIsAnnual ? "year" : "month",
          isAnnual: effectiveIsAnnual,
          onAnnualChange: setIsAnnual,
          annualDisabled,
          annualSavings,
          summary: `All teams get Pro${!isPro ? " Football" : ""} access`,
          checkoutSummary: `${effectiveIsAnnual ? annualPrice : monthlyPrice}/${effectiveIsAnnual ? "year" : "month"}`,
        }}
        features={features}
        checkout={{
          isPending: isCheckingOut,
          onSubscribe: () => {
            if (showIfDesktop()) return;
            if (isNativePlatform()) {
              handleNativeIAP(tier);
              return;
            }
            if (!hasStripeConfig) {
              toast({
                title: "Payment Not Configured",
                description: "Contact your club administrator to set up payment processing.",
                variant: "destructive",
              });
              return;
            }
            handleStripeCheckout(tier, true);
          },
        }}
        promo={{
          id: `promo-club-${tier}`,
          placeholder: isPro ? "CLUBPRO2024" : "CLUBFOOTBALL2024",
          value: code,
          onChange: setCode,
          onApply: () => handleApplyPromo(tier),
          isBusy: isValidating || applyPromoMutation.isPending,
        }}
      />
    );
  };

  return (
    <div className="py-6 space-y-6">
      {desktopUpgradeDialog}
      {/* Header */}
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">Club Pro Plans</h1>
          <p className="text-sm text-muted-foreground">{club.name}</p>
        </div>
        <Building2 className="h-8 w-8 text-primary" />
      </div>


      {/* Team Limit Warning */}
      {renderTeamCountBanner()}

      {/* Trial Banner */}
      {isOnTrial && trialEndsAt && (
        <UpgradeTrialBanner
          trialEndsAt={trialEndsAt}
          cancelDescription="Your trial will remain active until the expiry date. After that, Pro features will be removed from all teams and no payment will be taken."
          onCancel={() => cancelTrialMutation.mutate()}
          isCancelling={cancelTrialMutation.isPending}
        />
      )}

      {/* Expiry Banner for active subscriptions */}
      {(isProActive || isProFootballActive) && !isOnTrial && renderExpiryBanner()}

      {/* Free Trial CTA — shown once per club, only if never trialed / never paid */}
      {!isProActive && !isProFootballActive && !isOnTrial && !subscription?.trial_ends_at && (
        <Card className="border-primary/40 bg-gradient-to-br from-primary/10 via-primary/5 to-background">
          <CardContent className="p-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                <Crown className="h-5 w-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <h3 className="font-semibold text-base">Try Club Pro free for 30 days</h3>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Unlock sponsors, branding, unlimited storage, scheduled messages and more. No charge for 30 days — cancel anytime before the trial ends and you won't be billed.
                </p>
              </div>
            </div>
            <Button
              className="w-full"
              size="lg"
              disabled={isCheckingOut}
              onClick={() => {
                if (showIfDesktop()) return;
                handleStripeCheckout("pro", true);
              }}
            >

              {isCheckingOut ? (
                <><Loader2 className="h-4 w-4 mr-2 animate-spin" /> Starting trial…</>
              ) : (
                <>Start 30-day free trial</>
              )}
            </Button>
            <p className="text-[11px] text-muted-foreground text-center">
              Card required. Auto-converts to a paid subscription after 30 days unless cancelled.
            </p>
          </CardContent>
        </Card>
      )}

      {/* Info Card */}
      <Card className="bg-muted/50">
        <CardContent className="p-4">
          <p className="text-sm text-muted-foreground">
            <strong>Club Pro</strong> gives all teams in your club Pro access with one subscription. 
            Great value for clubs with multiple teams!
          </p>
        </CardContent>
      </Card>

      {/* Team-Specific Plan Option */}
      {teams && teams.length > 0 && (
        <Card className="border-muted">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium">
                  {isProActive || isProFootballActive 
                    ? "Manage individual team subscriptions" 
                    : "Prefer to upgrade a single team?"}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isProActive || isProFootballActive 
                    ? "View or manage team-specific Pro plans" 
                    : "Choose a team-specific Pro plan instead"}
                </p>
              </div>
              <Dialog open={teamSelectOpen} onOpenChange={setTeamSelectOpen}>
                <DialogTrigger asChild>
                  <Button variant="outline" size="sm">
                    <Users className="h-4 w-4 mr-2" />
                    {isProActive || isProFootballActive ? "View Teams" : "Choose Team"}
                  </Button>
                </DialogTrigger>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Select Team</DialogTitle>
                    <DialogDescription>
                      {isProActive || isProFootballActive 
                        ? "Select a team to view its Pro subscription" 
                        : "Choose which team you'd like to upgrade to Pro"}
                    </DialogDescription>
                  </DialogHeader>
                  <div className="space-y-2 max-h-[300px] overflow-y-auto">
                    {teams.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => {
                          setTeamSelectOpen(false);
                          navigate(`/teams/${t.id}/upgrade`);
                        }}
                        className="w-full p-3 rounded-lg border border-border hover:border-primary/50 hover:bg-muted/50 text-left transition-colors flex items-center gap-3"
                      >
                        <Avatar className="h-10 w-10">
                          <AvatarImage src={t.logo_url || undefined} />
                          <AvatarFallback className="bg-primary/20 text-primary">
                            {t.name?.charAt(0)?.toUpperCase() || "T"}
                          </AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <p className="font-medium truncate">{t.name}</p>
                          {t.level_age && (
                            <p className="text-xs text-muted-foreground">{t.level_age}</p>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                </DialogContent>
              </Dialog>
            </div>
          </CardContent>
        </Card>
      )}

      {showFootballOption ? (
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pro" disabled={isProActive && !isProFootballActive && !isExpired}>
              Club Pro {isProActive && !isProFootballActive && !isExpired && "✓"}
            </TabsTrigger>
            <TabsTrigger value="pro_football" disabled={isProFootballActive && !isExpired}>
              Club Pro Football {isProFootballActive && !isExpired && "✓"}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pro" className="mt-4 space-y-4">
            {isProActive && !isProFootballActive && !isExpired ? (
              renderProActiveCard("pro")
            ) : (
              renderPricingCard("pro")
            )}
          </TabsContent>

          <TabsContent value="pro_football" className="mt-4 space-y-4">
            {isProFootballActive && !isExpired ? (
              renderProActiveCard("pro_football")
            ) : (
              renderPricingCard("pro_football")
            )}
          </TabsContent>
        </Tabs>
      ) : (
        // Non-football clubs only see Pro option
        <>
          {isProActive && !isExpired ? (
            renderProActiveCard("pro")
          ) : (
            renderPricingCard("pro")
          )}
        </>
      )}
    </div>
  );
}
