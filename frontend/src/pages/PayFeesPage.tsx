import { useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowLeft, Check, CreditCard, Loader2, ExternalLink, Baby } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { createMemberCheckout, listenForPaymentStatus } from "@/lib/memberCheckout";
import { Capacitor } from "@capacitor/core";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function PayFeesPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <CreditCard className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Fee payments are unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Payment status and checkout remain an external provider boundary. No payment was initiated.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabasePayFeesPage />;
}

function SupabasePayFeesPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { toast } = useToast();
  const [isProcessing, setIsProcessing] = useState(false);
  const [selectedChildIds, setSelectedChildIds] = useState<Set<string>>(new Set());
  const [selfSelected, setSelfSelected] = useState(true);

  // Fetch club info
  const { data: club } = useQuery({
    queryKey: ["pay-fees-club", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, logo_url")
        .eq("id", clubId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  // Fetch payment settings
  const { data: paymentSettings } = useQuery({
    queryKey: ["pay-fees-settings", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_subscriptions")
        .select("member_payments_enabled, member_subscription_amount")
        .eq("club_id", clubId!)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId,
  });

  const currentYear = new Date().getFullYear().toString();

  // Fetch user's own payment status
  const { data: selfPayment } = useQuery({
    queryKey: ["pay-fees-self", clubId, user?.id, currentYear],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("member_subscription_payments")
        .select("id, payment_status")
        .eq("club_id", clubId!)
        .eq("user_id", user!.id)
        .eq("payment_period", currentYear)
        .eq("payment_type", "subscription")
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId && !!user,
  });

  // Fetch user's children that are on teams in this club
  const { data: children = [] } = useQuery({
    queryKey: ["pay-fees-children", clubId, user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("children")
        .select(`
          id,
          name,
          child_team_assignments!inner (
            team_id,
            teams!inner (
              id,
              name,
              club_id
            )
          )
        `)
        .eq("parent_id", user!.id)
        .eq("child_team_assignments.teams.club_id", clubId!);

      if (error) throw error;
      return data || [];
    },
    enabled: !!clubId && !!user,
  });

  // Fetch children's payment statuses
  const childIds = children.map((c: any) => c.id);
  const { data: childPayments = [] } = useQuery({
    queryKey: ["pay-fees-children-payments", clubId, childIds, currentYear],
    queryFn: async () => {
      if (childIds.length === 0) return [];
      // Children don't have user_ids, so we check by parent + metadata
      // For now, check parent's payments with child metadata
      const { data, error } = await supabase
        .from("member_subscription_payments")
        .select("id, user_id, notes, payment_status")
        .eq("club_id", clubId!)
        .eq("payment_period", currentYear)
        .eq("payment_type", "subscription")
        .eq("user_id", user!.id);
      if (error) throw error;
      return data || [];
    },
    enabled: childIds.length > 0 && !!clubId && !!user,
  });

  const selfHasPaid = selfPayment?.payment_status === 'paid';
  const feeAmount = paymentSettings?.member_subscription_amount || 0;
  const isEnabled = paymentSettings?.member_payments_enabled && feeAmount > 0;

  // Check if user is a member of this club
  const { data: userRoles } = useQuery({
    queryKey: ["pay-fees-roles", clubId, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("club_id", clubId!)
        .eq("user_id", user!.id);
      return data || [];
    },
    enabled: !!clubId && !!user,
  });

  const isMember = (userRoles?.length || 0) > 0;
  const isParentOrPlayer = userRoles?.some(r => ["player", "parent"].includes(r.role));

  const toggleChild = (childId: string) => {
    setSelectedChildIds(prev => {
      const next = new Set(prev);
      if (next.has(childId)) {
        next.delete(childId);
      } else {
        next.add(childId);
      }
      return next;
    });
  };

  const totalPayments = (isParentOrPlayer && selfSelected && !selfHasPaid ? 1 : 0) + selectedChildIds.size;
  const totalAmount = totalPayments * feeAmount;

  const handlePayNow = async () => {
    if (!user || !clubId || totalPayments === 0) return;

    setIsProcessing(true);
    try {
      const amountCents = Math.round(totalAmount * 100);
      if (amountCents < 50) {
        toast({ title: "Minimum payment is $0.50", variant: "destructive" });
        return;
      }

      const isNative = Capacitor.isNativePlatform();

      // Build description
      const parts: string[] = [];
      if (selfSelected && !selfHasPaid) parts.push("Your membership");
      children.forEach((child: any) => {
        if (selectedChildIds.has(child.id)) {
          parts.push(`${child.name}'s membership`);
        }
      });

      const result = await createMemberCheckout({
        club_id: clubId,
        title: `Membership Fees - ${club?.name || "Club"} (${currentYear})`,
        amount_cents: amountCents,
        type: "subscription",
        interval: "year",
        payer_email: user.email || undefined,
        description: parts.join(", "),
        success_url: isNative
          ? "igniteclubhq://payment-success"
          : `${window.location.origin}/pay-fees/${clubId}?payment=success`,
        cancel_url: isNative
          ? "igniteclubhq://payment-cancel"
          : `${window.location.origin}/pay-fees/${clubId}?payment=cancelled`,
        metadata: {
          club_id: clubId,
          payment_period: currentYear,
          payment_type: "subscription",
          payer_user_id: user.id,
          ...(selectedChildIds.size > 0 ? { child_ids: Array.from(selectedChildIds).join(",") } : {}),
          items_count: totalPayments.toString(),
        },
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.url) {
        listenForPaymentStatus(result.payment_id, (status) => {
          if (status === "paid") {
            toast({ title: "Payment successful! 🎉" });
          } else {
            toast({ title: "Payment failed", variant: "destructive" });
          }
        });

        if (isNative) {
          import("@/lib/safeOpenUrl").then(({ safeOpenUrl }) => safeOpenUrl(result.url));
        } else {
          window.location.href = result.url;
        }
      } else {
        throw new Error("No checkout URL returned");
      }
    } catch (error: any) {
      toast({
        title: "Payment Error",
        description: error.message || "Failed to start payment",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  // Handle payment success URL param
  const urlParams = new URLSearchParams(window.location.search);
  const paymentStatus = urlParams.get("payment");

  if (!clubId) return null;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-10 bg-background/95 backdrop-blur-lg border-b border-border safe-area-top">
        <div className="flex items-center gap-3 h-14 px-4 max-w-lg mx-auto">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="font-semibold text-lg">Pay Membership Fees</h1>
        </div>
      </div>

      <div className="max-w-lg mx-auto p-4 space-y-4 pb-32">
        {/* Club Info */}
        {club && (
          <div className="flex items-center gap-3">
            {club.logo_url && (
              <img src={club.logo_url} alt={club.name} className="h-10 w-10 rounded-lg object-cover" />
            )}
            <div>
              <h2 className="font-semibold">{club.name}</h2>
              <p className="text-sm text-muted-foreground">Membership fees for {currentYear}</p>
            </div>
          </div>
        )}

        {paymentStatus === "success" && (
          <Card className="border-emerald-500/30 bg-emerald-500/5">
            <CardContent className="p-4 flex items-center gap-3">
              <Check className="h-6 w-6 text-emerald-500" />
              <div>
                <p className="font-medium text-emerald-600">Payment Successful!</p>
                <p className="text-sm text-muted-foreground">Your payment has been processed. Thank you!</p>
              </div>
            </CardContent>
          </Card>
        )}

        {!isEnabled && (
          <Card>
            <CardContent className="p-6 text-center">
              <CreditCard className="h-10 w-10 mx-auto mb-3 text-muted-foreground/50" />
              <p className="font-medium">Online Payments Not Enabled</p>
              <p className="text-sm text-muted-foreground mt-1">
                This club hasn't enabled online fee payments yet. Contact your club admin.
              </p>
            </CardContent>
          </Card>
        )}

        {isEnabled && (
          <>
            {/* Fee Summary */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-base flex items-center gap-2">
                  <CreditCard className="h-5 w-5 text-primary" />
                  Select Payments
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3">
                {/* Self payment */}
                {isParentOrPlayer && (
                  <div
                    className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                      selfHasPaid
                        ? "border-emerald-500/30 bg-emerald-500/5"
                        : selfSelected
                          ? "border-primary/30 bg-primary/5"
                          : "border-border"
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      {selfHasPaid ? (
                        <div className="h-5 w-5 rounded-full bg-emerald-500/20 flex items-center justify-center">
                          <Check className="h-3.5 w-3.5 text-emerald-600" />
                        </div>
                      ) : (
                        <Checkbox
                          checked={selfSelected}
                          onCheckedChange={() => setSelfSelected(!selfSelected)}
                        />
                      )}
                      <div>
                        <p className="font-medium text-sm">Your Membership</p>
                        {selfHasPaid && (
                          <Badge variant="secondary" className="text-emerald-600 mt-0.5">Paid</Badge>
                        )}
                      </div>
                    </div>
                    <span className="font-semibold text-sm">
                      ${Number(feeAmount).toFixed(2)}
                    </span>
                  </div>
                )}

                {/* Children */}
                {children.length > 0 && (
                  <>
                    <Separator />
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Baby className="h-4 w-4" />
                      <span>Children</span>
                    </div>
                    {children.map((child: any) => {
                      const isSelected = selectedChildIds.has(child.id);
                      // For now, children don't have individual payment tracking
                      // but we still show them for selection
                      return (
                        <div
                          key={child.id}
                          className={`flex items-center justify-between p-3 rounded-lg border transition-colors ${
                            isSelected
                              ? "border-primary/30 bg-primary/5"
                              : "border-border"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            <Checkbox
                              checked={isSelected}
                              onCheckedChange={() => toggleChild(child.id)}
                            />
                            <div>
                              <p className="font-medium text-sm">{child.name}</p>
                              <p className="text-xs text-muted-foreground">
                                {child.child_team_assignments?.[0]?.teams?.name || "Team member"}
                              </p>
                            </div>
                          </div>
                          <span className="font-semibold text-sm">
                            ${Number(feeAmount).toFixed(2)}
                          </span>
                        </div>
                      );
                    })}
                  </>
                )}
              </CardContent>
            </Card>

            {/* Pay Button (sticky bottom) */}
            {totalPayments > 0 && (
              <div className="fixed bottom-0 left-0 right-0 p-4 bg-background/95 backdrop-blur-lg border-t border-border safe-area-bottom">
                <div className="max-w-lg mx-auto">
                  <Button
                    className="w-full h-14 text-base"
                    onClick={handlePayNow}
                    disabled={isProcessing}
                  >
                    {isProcessing ? (
                      <>
                        <Loader2 className="h-5 w-5 animate-spin mr-2" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <CreditCard className="h-5 w-5 mr-2" />
                        Pay ${Number(totalAmount).toFixed(2)}
                        {totalPayments > 1 && ` (${totalPayments} items)`}
                        <ExternalLink className="h-3.5 w-3.5 ml-2" />
                      </>
                    )}
                  </Button>
                </div>
              </div>
            )}

            {totalPayments === 0 && selfHasPaid && children.length === 0 && (
              <Card className="border-emerald-500/30 bg-emerald-500/5">
                <CardContent className="p-6 text-center">
                  <Check className="h-10 w-10 mx-auto mb-3 text-emerald-500" />
                  <p className="font-semibold text-emerald-600">All Paid!</p>
                  <p className="text-sm text-muted-foreground mt-1">
                    Your membership fees are up to date for {currentYear}.
                  </p>
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </div>
  );
}
