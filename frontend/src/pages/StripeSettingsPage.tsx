import { useState, useEffect } from "react";
import { ArrowLeft, CreditCard, Loader2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useNavigate, useParams } from "react-router-dom";
import { useToast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Switch } from "@/components/ui/switch";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export default function StripeSettingsPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);

  if (useIcpLab) {
    return (
      <div className="container max-w-lg mx-auto px-4 py-10">
        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="p-6 space-y-4 text-center">
            <CreditCard className="h-10 w-10 mx-auto text-muted-foreground" />
            <h1 className="text-lg font-semibold">Payment settings are unavailable in ICP lab mode</h1>
            <p className="text-sm text-muted-foreground">
              Stripe and member-payment configuration remain external provider boundaries. No settings have been changed.
            </p>
            <Button variant="outline" onClick={() => navigate(-1)}>
              <ArrowLeft className="mr-2 h-4 w-4" /> Go back
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return <SupabaseStripeSettingsPage />;
}

function SupabaseStripeSettingsPage() {
  const { clubId } = useParams<{ clubId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Member payment settings state
  const [memberPaymentsEnabled, setMemberPaymentsEnabled] = useState(false);
  const [memberSubscriptionAmount, setMemberSubscriptionAmount] = useState("");

  // Fetch club details
  const { data: club } = useQuery({
    queryKey: ['club', clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data, error } = await supabase
        .from('clubs')
        .select('id, name')
        .eq('id', clubId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId
  });

  // Fetch club subscription for member payment settings
  const { data: clubSubscription } = useQuery({
    queryKey: ['club-subscription', clubId],
    queryFn: async () => {
      if (!clubId) return null;
      const { data, error } = await supabase
        .from('club_subscriptions')
        .select('*')
        .eq('club_id', clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!clubId
  });

  // Populate member payment settings
  useEffect(() => {
    if (clubSubscription) {
      setMemberPaymentsEnabled(clubSubscription.member_payments_enabled || false);
      setMemberSubscriptionAmount(clubSubscription.member_subscription_amount?.toString() || "");
    }
  }, [clubSubscription]);

  // Save member payment settings mutation
  const saveMemberPaymentSettingsMutation = useMutation({
    mutationFn: async () => {
      if (!clubId) throw new Error("Club ID is required");
      
      const amount = memberSubscriptionAmount ? parseFloat(memberSubscriptionAmount) : null;
      
      if (clubSubscription) {
        const { error } = await supabase
          .from('club_subscriptions')
          .update({
            member_payments_enabled: memberPaymentsEnabled,
            member_subscription_amount: amount,
          })
          .eq('club_id', clubId);
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('club_subscriptions')
          .insert({
            club_id: clubId,
            member_payments_enabled: memberPaymentsEnabled,
            member_subscription_amount: amount,
          });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['club-subscription', clubId] });
      toast({ title: "Member payment settings saved" });
    },
    onError: (error: Error) => {
      toast({ title: "Failed to save settings", description: error.message, variant: "destructive" });
    }
  });

  const handleSaveMemberPaymentSettings = () => {
    if (memberPaymentsEnabled && !memberSubscriptionAmount) {
      toast({ title: "Please enter a subscription amount", variant: "destructive" });
      return;
    }
    if (memberPaymentsEnabled && parseFloat(memberSubscriptionAmount) <= 0) {
      toast({ title: "Subscription amount must be greater than 0", variant: "destructive" });
      return;
    }
    saveMemberPaymentSettingsMutation.mutate();
  };

  if (!clubId) {
    return (
      <div className="py-6">
        <p className="text-muted-foreground">Club not found</p>
      </div>
    );
  }

  return (
    <div className="py-6 space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => navigate(`/clubs/${clubId}`)}>
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <div>
          <h1 className="text-2xl font-bold">Payment Settings</h1>
          {club && <p className="text-sm text-muted-foreground">{club.name}</p>}
        </div>
      </div>

      {/* Member Subscription Payments Settings */}
      <Card>
        <CardHeader>
          <div className="flex items-center gap-2">
            <Users className="h-5 w-5 text-primary" />
            <CardTitle>Member Payment Settings</CardTitle>
          </div>
          <CardDescription>
            Allow club members to pay their subscription and uniform fees online via Stripe. Payments are processed through the Ignite platform.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="member-payments-enabled" className="font-medium">Enable Online Payments</Label>
              <p className="text-sm text-muted-foreground">
                Members can pay their fees via Stripe checkout
              </p>
            </div>
            <Switch
              id="member-payments-enabled"
              checked={memberPaymentsEnabled}
              onCheckedChange={setMemberPaymentsEnabled}
            />
          </div>

          {memberPaymentsEnabled && (
            <div className="space-y-2">
              <Label htmlFor="subscription-amount">Fee Amount ($)</Label>
              <Input
                id="subscription-amount"
                type="number"
                step="0.01"
                min="0"
                placeholder="e.g., 150.00"
                value={memberSubscriptionAmount}
                onChange={(e) => setMemberSubscriptionAmount(e.target.value)}
              />
              <p className="text-xs text-muted-foreground">
                The amount members will pay for subscriptions and uniforms
              </p>
            </div>
          )}

          <Button
            onClick={handleSaveMemberPaymentSettings}
            disabled={saveMemberPaymentSettingsMutation.isPending}
            className="w-full"
          >
            {saveMemberPaymentSettingsMutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
                Saving...
              </>
            ) : (
              "Save Payment Settings"
            )}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}