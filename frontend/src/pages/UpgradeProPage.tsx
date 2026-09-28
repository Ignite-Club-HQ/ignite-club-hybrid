import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { isNativePlatform } from "@/lib/nativePush";
import { useParams, useNavigate, Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, Crown, Loader2, Target, ArrowDown, Calendar, Building2, Flame } from "lucide-react";
import { isPast, parseISO, format, addMonths, addYears } from "date-fns";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import {
  UpgradeAccessDeniedState,
  UpgradeLoadingState,
  UpgradeNotFoundState,
  UpgradeOfferCard,
  UpgradeTrialBanner,
} from "@/components/subscription/UpgradePlanPresentation";
import { invalidateProAccessQueries } from "@/lib/invalidateProAccess";
import { useDesktopUpgradeGate } from "@/hooks/useDesktopUpgradeGate";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";


const PRO_FEATURES = [
  "Team & club chat (club-wide messaging)",
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
];

// Pricing in AUD
const PRICING = {
  pro: {
    monthly: 24.99,
    annual: 239.00,
  },
  proFootball: {
    monthly: 39.99,
    annual: 379.99,
  },
};

// Check if club sport is soccer/football
const isSoccerClub = (sport: string | null | undefined): boolean => {
  if (!sport) return false;
  const lowerSport = sport.toLowerCase();
  return lowerSport.includes("soccer") || lowerSport.includes("football") || lowerSport.includes("futsal");
};

export default function UpgradeProPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <Crown className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Pro upgrades are unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Subscriptions, promo codes, trials, purchases, and billing changes remain external provider boundaries.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseUpgradeProPage />;
}

function SupabaseUpgradeProPage() {
  const { teamId } = useParams<{ teamId: string }>();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [promoCode, setPromoCode] = useState("");
  const [promoCodeFootball, setPromoCodeFootball] = useState("");
  const [isValidating, setIsValidating] = useState(false);
  const [selectedTab, setSelectedTab] = useState("pro");
  const [isAnnualPro, setIsAnnualPro] = useState(false);
  const [isAnnualProFootball, setIsAnnualProFootball] = useState(false);
  const [isCheckingOut, setIsCheckingOut] = useState(false);
  const { showIfDesktop, dialog: desktopUpgradeDialog } = useDesktopUpgradeGate();


  // Handle payment success/cancelled from URL params
  useEffect(() => {
    const paymentStatus = searchParams.get('payment');
    if (paymentStatus === 'success') {
      toast({
        title: "Payment Successful!",
        description: "Your subscription is now active.",
      });
      queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
      invalidateProAccessQueries(queryClient);
    } else if (paymentStatus === 'cancelled') {
      toast({
        title: "Payment Cancelled",
        description: "Your subscription was not activated.",
        variant: "destructive",
      });
    }
  }, [searchParams, toast, queryClient, teamId]);

  // Check if user is a team admin or club admin for the team's club
  const { data: adminStatus, isLoading: loadingAdminCheck } = useQuery({
    queryKey: ["is-team-admin", user?.id, teamId],
    queryFn: async () => {
      // First get user roles
      const { data: roles } = await supabase
        .from("user_roles")
        .select("role, team_id, club_id")
        .eq("user_id", user!.id);
      
      if (!roles) return { isTeamAdmin: false, isClubAdmin: false };
      
      // Check if user is club admin for the team's club
      const { data: team } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", teamId!)
        .single();
      
      const isClubAdmin = team && roles.some(r => r.role === "club_admin" && r.club_id === team.club_id);
      const isAppAdmin = roles.some(r => r.role === "app_admin");
      
      // App admin can access all
      if (isAppAdmin) return { isTeamAdmin: true, isClubAdmin: true };
      
      // Team admin for this team
      if (roles.some(r => r.role === "team_admin" && r.team_id === teamId)) {
        return { isTeamAdmin: true, isClubAdmin: !!isClubAdmin };
      }
      
      // Coach for this team can also purchase team plans
      if (roles.some(r => r.role === "coach" && r.team_id === teamId)) {
        return { isTeamAdmin: true, isClubAdmin: !!isClubAdmin };
      }
      
      // Club admin for the team's club can also upgrade team plans
      if (isClubAdmin) {
        return { isTeamAdmin: true, isClubAdmin: true };
      }
      
      return { isTeamAdmin: false, isClubAdmin: false };
    },
    enabled: !!user && !!teamId,
  });

  const isTeamAdmin = adminStatus?.isTeamAdmin ?? false;
  const isClubAdminForTeam = adminStatus?.isClubAdmin ?? false;

  const { data: team, isLoading: teamLoading, fetchStatus: teamFetchStatus } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("teams")
        .select("*, clubs!club_id (id, name, is_pro, sport)")
        .eq("id", teamId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!teamId,
  });

  const { data: subscription } = useQuery({
    queryKey: ["team-subscription", teamId],
    queryFn: async () => {
      const { data } = await supabase
        .from("team_subscriptions")
        .select("*")
        .eq("team_id", teamId!)
        .maybeSingle();
      return data;
    },
    enabled: !!teamId,
  });

  // Check for club-level subscription
  const { data: clubSubscription } = useQuery({
    queryKey: ["club-subscription-for-team", team?.club_id],
    queryFn: async () => {
      const { data } = await supabase
        .from("club_subscriptions")
        .select("*")
        .eq("club_id", team!.club_id)
        .maybeSingle();
      return data;
    },
    enabled: !!team?.club_id,
  });

  // Team has pro access via team subscription OR club subscription
  const hasClubProAccess = (clubSubscription?.is_pro || clubSubscription?.admin_pro_override) && (!clubSubscription?.expires_at || !isPast(parseISO(clubSubscription.expires_at)));
  const hasClubProFootballAccess = (clubSubscription?.is_pro_football || clubSubscription?.admin_pro_football_override) && (!clubSubscription?.expires_at || !isPast(parseISO(clubSubscription.expires_at)));
  
  const isProActive = subscription?.is_pro || subscription?.admin_pro_override || team?.clubs?.is_pro || hasClubProAccess;
  const isProFootballActive = subscription?.is_pro_football || subscription?.admin_pro_football_override || hasClubProFootballAccess;
  const showFootballOption = isSoccerClub(team?.clubs?.sport);
  const expiresAt = subscription?.expires_at ? parseISO(subscription.expires_at) : null;
  const isExpired = expiresAt ? isPast(expiresAt) : false;
  const isOnTrial = subscription?.is_trial && subscription?.trial_ends_at && !isPast(parseISO(subscription.trial_ends_at));
  const trialEndsAt = subscription?.trial_ends_at ? parseISO(subscription.trial_ends_at) : null;
  

  const applyPromoMutation = useMutation({
    mutationFn: async ({ code, tier, isAnnual }: { code: string; tier: "pro" | "pro_football"; isAnnual: boolean }) => {
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

      // Validate scope_type matches - must be a team code for team subscription
      if (promoData.scope_type !== 'team') {
        throw new Error("This promo code is for club subscriptions only. Please use a team promo code.");
      }

      // Validate club restriction - if promo code is restricted to a specific club
      if (promoData.club_id && promoData.club_id !== team?.club_id) {
        throw new Error("This promo code is restricted to a different club.");
      }

      // Validate access_level matches selected tier
      if (tier === 'pro_football' && promoData.access_level === 'pro') {
        throw new Error("This promo code is for Pro plan only. Please select the Pro plan or use a Pro Football code.");
      }
      if (tier === 'pro' && promoData.access_level === 'pro_football') {
        throw new Error("This promo code is for Pro Football plan only. Please select the Pro Football plan or use a Pro code.");
      }

      // Use promo code expiry date if set, otherwise default to 1 month/year
      const now = new Date();
      const defaultExpiry = isAnnual ? addYears(now, 1) : addMonths(now, 1);
      const newExpiresAt = promoData.expires_at ? parseISO(promoData.expires_at) : defaultExpiry;

      // Create or update subscription based on tier
      // Pro Football includes all Pro features, so we set both flags
      const updateData = tier === "pro" 
        ? { is_pro: true } 
        : { is_pro: true, is_pro_football: true };

      const { error: subError } = await supabase
        .from("team_subscriptions")
        .upsert({
          team_id: teamId!,
          ...updateData,
          promo_code_id: promoData.id,
          activated_at: new Date().toISOString(),
          expires_at: newExpiresAt.toISOString(),
        } as never, { onConflict: "team_id" });

      if (subError) throw subError;

      // Increment promo code usage
      await supabase
        .from("promo_codes")
        .update({ uses_count: promoData.uses_count + 1 })
        .eq("id", promoData.id);

      return tier;
    },
    onSuccess: (tier) => {
      queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
      invalidateProAccessQueries(queryClient);
      const tierName = tier === "pro" ? "Pro" : "Pro Football";
      toast({ title: `${tierName} Activated!`, description: `Your team now has ${tierName} features.` });
      setPromoCode("");
      setPromoCodeFootball("");
    },
    onError: (error: Error) => {
      toast({ title: "Invalid Code", description: error.message, variant: "destructive" });
    },
  });

  const cancelTrialMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('cancel-subscription', {
        body: { subscription_type: 'team', entity_id: teamId },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
      invalidateProAccessQueries(queryClient);
      toast({ title: "Subscription Cancelled", description: "Your subscription has been cancelled. Pro features will remain until the trial ends." });
    },
    onError: (error: Error) => {
      toast({ title: "Error", description: error.message || "Failed to cancel subscription.", variant: "destructive" });
    },
  });

  const downgradeMutation = useMutation({
    mutationFn: async (targetTier: "free" | "pro") => {
      if (targetTier === "free") {
        // Downgrade to free - remove all pro features and trial
        const { error } = await supabase
          .from("team_subscriptions")
          .update({ 
            is_pro: false, 
            is_pro_football: false, 
            expires_at: null,
          })
          .eq("team_id", teamId!);
        if (error) throw error;
      } else if (targetTier === "pro") {
        // Downgrade from Pro Football to Pro
        const { error } = await supabase
          .from("team_subscriptions")
          .update({ is_pro_football: false })
          .eq("team_id", teamId!);
        if (error) throw error;
      }
      return targetTier;
    },
    onSuccess: (targetTier) => {
      queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
      invalidateProAccessQueries(queryClient);
      const message = targetTier === "free" 
        ? "Subscription cancelled. Team is now on Free plan."
        : "Downgraded to Pro plan.";
      toast({ title: "Plan Updated", description: message });
    },
    onError: () => {
      toast({ title: "Error", description: "Failed to update plan.", variant: "destructive" });
    },
  });

  const handleApplyPromo = async (tier: "pro" | "pro_football") => {
    const code = tier === "pro" ? promoCode : promoCodeFootball;
    const isAnnual = tier === "pro" ? isAnnualPro : isAnnualProFootball;
    if (!code.trim()) return;
    setIsValidating(true);
    try {
      await applyPromoMutation.mutateAsync({ code, tier, isAnnual });
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
      handleNativeIAP(tier);
      return;
    }
    const isAnnual = tier === "pro" ? isAnnualPro : isAnnualProFootball;
    setIsCheckingOut(true);

    try {
      const { data, error } = await supabase.functions.invoke('create-subscription-checkout', {
        body: {
          subscriptionType: 'team',
          entityId: teamId,
          tier: tier,
          isAnnual: isAnnual,
          withTrial: withTrial,
          successUrl: `${window.location.origin}/teams/${teamId}/upgrade?payment=success`,
          cancelUrl: `${window.location.origin}/teams/${teamId}/upgrade?payment=cancelled`,
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

  const handleNativeIAP = async (tier: "pro" | "pro_football") => {
    const { getTeamUpgradeProductId } = await import("@/hooks/useInAppPurchase");
    const { Capacitor } = await import("@capacitor/core");
    if (!Capacitor.isNativePlatform()) return;

    const isAnnual = tier === "pro" ? isAnnualPro : isAnnualProFootball;
    const productId = getTeamUpgradeProductId(tier, isAnnual);

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

      const { data, error } = await supabase.functions.invoke("verify-iap-receipt", {
        body: {
          platform: Capacitor.getPlatform(),
          transactionId: purchaseResult.transactionId,
          productId,
          entityId: teamId,
          entityType: "team",
          receipt: purchaseResult.receipt || purchaseResult.purchaseToken || purchaseResult.transactionId,
        },
      });

      if (error || data?.error) throw new Error(data?.error || "Verification failed");

      queryClient.invalidateQueries({ queryKey: ["team-subscription", teamId] });
      invalidateProAccessQueries(queryClient);
      toast({ title: "Upgrade Successful!", description: "Your team subscription is now active." });
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
    queryKey: ["stripe-config-check", team?.club_id],
    queryFn: async () => {
      // Check club config
      const { data: clubConfig } = await supabase
        .from("club_stripe_configs")
        .select("id, is_enabled")
        .eq("club_id", team!.club_id)
        .eq("is_enabled", true)
        .maybeSingle();
      
      if (clubConfig) return true;

      // Check app config (only admins can see this, so we check if response is valid)
      const { data: appConfig, error } = await supabase
        .from("app_stripe_config")
        .select("id, is_enabled")
        .eq("is_enabled", true)
        .maybeSingle();
      
      // If no error and data exists, config exists
      return !!appConfig;
    },
    enabled: !!team?.club_id,
  });

  if (teamLoading || loadingAdminCheck || (teamFetchStatus === "paused" && !team)) {
    return <UpgradeLoadingState />;
  }

  if (!team) {
    return <UpgradeNotFoundState product="team" />;
  }

  if (!isTeamAdmin) {
    return (
      <UpgradeAccessDeniedState
        title="Upgrade to Pro"
        description="Only team administrators, coaches, or club administrators can purchase team subscriptions."
        onBack={() => navigate(-1)}
      />
    );
  }

  const renderExpiryBanner = () => {
    if (!expiresAt || isOnTrial) return null;

    return (
      <Card className="border-primary/30 bg-primary/5 mb-4">
        <CardContent className="p-4 flex items-center gap-3">
          <Calendar className="h-5 w-5 text-primary shrink-0" />
          <div>
            <p className="text-sm">
              <span className="font-medium">Paid until:</span>{" "}
              <span className="text-primary font-semibold">{format(expiresAt, "dd MMMM yyyy")}</span>
            </p>
          </div>
        </CardContent>
      </Card>
    );
  };

  const renderProActiveCard = (tier: "pro" | "pro_football") => {
    const isPro = tier === "pro";
    const Icon = isPro ? Crown : Target;
    const colorClass = isPro ? "yellow" : "emerald";
    const title = isOnTrial 
      ? (isPro ? "Pro Trial Active" : "Pro Football Trial Active")
      : (isPro ? "Pro Active" : "Pro Football Active");
    const description = isOnTrial
      ? `Your free trial ${isPro ? "gives this team full Pro access" : "includes the Soccer Pitch Board"}.`
      : (isPro 
        ? "This team has full access to all Pro features."
        : "This team has access to the Soccer Pitch Board.");

    return (
      <Card className={`border-${colorClass}-500/50 bg-${colorClass}-500/10`}>
        <CardContent className="p-6 text-center space-y-4">
          <Icon className={`h-12 w-12 text-${colorClass}-500 mx-auto`} />
          <div>
            <h2 className="text-xl font-bold">{title}</h2>
            {isOnTrial && (
              <Badge className="mt-2 bg-amber-500/20 text-amber-700 dark:text-amber-400 border-amber-500/30">
                Free Trial
              </Badge>
            )}
            <p className="text-muted-foreground mt-2">{description}</p>
          </div>
          
          {isOnTrial && trialEndsAt && (
            <div className="p-3 rounded-lg bg-amber-500/10 flex items-center justify-center gap-2">
              <Flame className="h-4 w-4 text-amber-500" />
              <span className="text-sm">
                Trial ends <strong>{format(trialEndsAt, "dd MMMM yyyy")}</strong>
              </span>
            </div>
          )}

          {!isOnTrial && expiresAt && (
            <div className={`p-3 rounded-lg ${isExpired ? 'bg-destructive/10' : 'bg-muted/50'} flex items-center justify-center gap-2`}>
              <Calendar className={`h-4 w-4 ${isExpired ? 'text-destructive' : 'text-muted-foreground'}`} />
              <span className={`text-sm ${isExpired ? 'text-destructive font-semibold' : ''}`}>
                {isExpired ? 'Expired on ' : 'Paid until '}
                <strong>{format(expiresAt, "dd MMMM yyyy")}</strong>
              </span>
            </div>
          )}

          {isExpired && !isOnTrial && (
            <p className="text-sm text-destructive">
              Your subscription has expired. Features will be disabled until you renew.
            </p>
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
                      Your trial will remain active until the expiry date. After that, Pro features will be removed and no payment will be taken.
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
                    Downgrade to Pro ($25/mo)
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Downgrade to Pro?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove the Soccer Pitch Board feature but keep all other Pro features. You can upgrade back to Pro Football anytime.
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
                    Downgrade to Free
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>Downgrade to Free Plan?</AlertDialogTitle>
                    <AlertDialogDescription>
                      This will remove all Pro features from your team including Points & Rewards, club announcements, media uploads, and vault storage. This action can be reversed by upgrading again.
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
                      Confirm Downgrade
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
    const pricing = isPro ? PRICING.pro : PRICING.proFootball;
    const features = isPro ? PRO_FEATURES : PRO_FOOTBALL_FEATURES;
    const isAnnual = isPro ? isAnnualPro : isAnnualProFootball;
    const setIsAnnual = isPro ? setIsAnnualPro : setIsAnnualProFootball;
    const code = isPro ? promoCode : promoCodeFootball;
    const setCode = isPro ? setPromoCode : setPromoCodeFootball;

    return (
      <UpgradeOfferCard
        header={
          <Badge className={`w-fit mx-auto mb-2 ${isPro ? "bg-yellow-500 text-yellow-950" : "bg-emerald-500 text-emerald-950"}`}>
            {isPro ? "PRO" : "PRO FOOTBALL"}
          </Badge>
        }
        appearance={{
          cardClassName: isPro ? "border-primary/30" : "border-emerald-500/30",
          checkBackgroundClassName: isPro ? "bg-primary/20" : "bg-emerald-500/20",
          checkTextClassName: isPro ? "text-primary" : "text-emerald-500",
          subscribeClassName: isPro ? undefined : "bg-emerald-600 hover:bg-emerald-700",
        }}
        pricing={{
          price: isAnnual ? pricing.annual : pricing.monthly,
          period: isAnnual ? "year" : "month",
          isAnnual,
          onAnnualChange: setIsAnnual,
          annualSavings: isPro ? 60 : 96,
          summary: `per team${!isPro ? " • includes all Pro features" : ""}`,
          checkoutSummary: `${isAnnual ? pricing.annual : pricing.monthly}/${isAnnual ? "year" : "month"}`,
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
          id: `promo-${tier}`,
          placeholder: isPro ? "PROMO2024" : "FOOTBALL2024",
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
          <h1 className="text-2xl font-bold">Upgrade to Pro</h1>
          <p className="text-sm text-muted-foreground">{team.name}</p>
        </div>
        <Crown className="h-8 w-8 text-yellow-500" />
      </div>


      {/* Club Pro Banner */}
      {(hasClubProAccess || hasClubProFootballAccess) && (
        <Card className="border-yellow-500/30 bg-yellow-500/5">
          <CardContent className="p-4 flex items-center gap-3">
            <Building2 className="h-5 w-5 text-yellow-500 shrink-0" />
            <div className="flex-1">
              <p className="font-medium text-sm">
                This team has {hasClubProFootballAccess ? "Pro Football" : "Pro"} access via Club subscription
              </p>
              <p className="text-xs text-muted-foreground">
                Manage your club subscription to change plans
              </p>
            </div>
            <Link to={`/clubs/${team.club_id}/upgrade`}>
              <Button variant="outline" size="sm">
                Club Plans
              </Button>
            </Link>
          </CardContent>
        </Card>
      )}

      {/* Trial Banner */}
      {isOnTrial && !hasClubProAccess && !hasClubProFootballAccess && trialEndsAt && (
        <UpgradeTrialBanner
          trialEndsAt={trialEndsAt}
          cancelDescription="Your trial will remain active until the expiry date. After that, Pro features will be removed and no payment will be taken."
          onCancel={() => cancelTrialMutation.mutate()}
          isCancelling={cancelTrialMutation.isPending}
        />
      )}

      {/* Expiry Banner for active subscriptions */}
      {(isProActive || isProFootballActive) && !hasClubProAccess && !hasClubProFootballAccess && !isOnTrial && renderExpiryBanner()}

      {showFootballOption ? (
        <Tabs value={selectedTab} onValueChange={setSelectedTab} className="w-full">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="pro" disabled={(isProActive && !isExpired) || hasClubProAccess}>
              Pro {(isProActive && !isExpired) && "✓"}
            </TabsTrigger>
            <TabsTrigger value="pro_football" disabled={(isProFootballActive && !isExpired) || hasClubProFootballAccess}>
              Pro Football {(isProFootballActive && !isExpired) && "✓"}
            </TabsTrigger>
          </TabsList>

          <TabsContent value="pro" className="mt-4 space-y-4">
            {hasClubProAccess ? (
              <Card className="border-muted bg-muted/30">
                <CardContent className="p-6 text-center space-y-3">
                  <Crown className="h-12 w-12 text-muted-foreground mx-auto" />
                  <div>
                    <h2 className="text-xl font-bold text-muted-foreground">Pro Included via Club</h2>
                    <p className="text-muted-foreground mt-2">
                      This team already has Pro access through the club subscription.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : isProActive && !isProFootballActive && !isExpired ? (
              renderProActiveCard("pro")
            ) : (
              renderPricingCard("pro")
            )}
          </TabsContent>

          <TabsContent value="pro_football" className="mt-4 space-y-4">
            {hasClubProFootballAccess ? (
              <Card className="border-muted bg-muted/30">
                <CardContent className="p-6 text-center space-y-3">
                  <Target className="h-12 w-12 text-muted-foreground mx-auto" />
                  <div>
                    <h2 className="text-xl font-bold text-muted-foreground">Pro Football Included via Club</h2>
                    <p className="text-muted-foreground mt-2">
                      This team already has Pro Football access through the club subscription.
                    </p>
                  </div>
                </CardContent>
              </Card>
            ) : isProFootballActive && !isExpired ? (
              renderProActiveCard("pro_football")
            ) : (
              renderPricingCard("pro_football")
            )}
          </TabsContent>
        </Tabs>
      ) : (
        // Non-football clubs only see Pro option
        <>
          {hasClubProAccess ? (
            <Card className="border-muted bg-muted/30">
              <CardContent className="p-6 text-center space-y-3">
                <Crown className="h-12 w-12 text-muted-foreground mx-auto" />
                <div>
                  <h2 className="text-xl font-bold text-muted-foreground">Pro Included via Club</h2>
                  <p className="text-muted-foreground mt-2">
                    This team already has Pro access through the club subscription.
                  </p>
                </div>
              </CardContent>
            </Card>
          ) : isProActive && !isExpired ? (
            renderProActiveCard("pro")
          ) : (
            renderPricingCard("pro")
          )}
        </>
      )}

      {/* Club Plans Option - only show to club admins */}
      {!hasClubProAccess && !hasClubProFootballAccess && isClubAdminForTeam && (
        <Card className="border-muted mt-6">
          <CardContent className="p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="flex-1">
                <p className="text-sm font-medium">Prefer a club-wide plan?</p>
                <p className="text-xs text-muted-foreground">Upgrade all teams at once with a club subscription</p>
              </div>
              <Button 
                variant="outline" 
                size="sm"
                onClick={() => navigate(`/clubs/${team.club_id}/upgrade`)}
              >
                <Building2 className="h-4 w-4 mr-2" />
                Club Plans
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Club Plans message for team admins who aren't club admins */}
      {!hasClubProAccess && !hasClubProFootballAccess && !isClubAdminForTeam && (
        <Card className="border-muted mt-6">
          <CardContent className="p-4">
            <div className="flex items-center gap-4">
              <Building2 className="h-5 w-5 text-muted-foreground shrink-0" />
              <div>
                <p className="text-sm font-medium">Prefer a club-wide plan?</p>
                <p className="text-xs text-muted-foreground">Contact your club admin for a club subscription</p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
