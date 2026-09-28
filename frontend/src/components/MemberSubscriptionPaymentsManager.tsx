import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, CreditCard, X, Loader2, ExternalLink, Shirt, Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogClose,
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
} from "@/components/ui/alert-dialog";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { createMemberCheckout, listenForPaymentStatus } from "@/lib/memberCheckout";
import { Capacitor } from "@capacitor/core";

type PaymentType = "subscription" | "uniform";

interface PayableEntry {
  id: string; // unique key: either user_id or `child_${child_id}`
  displayName: string;
  avatarUrl: string | null;
  isChild: boolean;
  childId?: string;
  parentUserId?: string; // for children, the parent's user_id
  userId?: string; // for adult players
  label: string; // "Player" or "Child Player"
}

interface Member {
  profile: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
  roles: { id: string; role: string }[];
}

interface MemberSubscriptionPaymentsManagerProps {
  clubId: string;
  teamId?: string;
  members: Record<string, Member>;
  isAdmin?: boolean;
}

export default function MemberSubscriptionPaymentsManager({
  clubId,
  teamId,
  members,
  isAdmin = false,
}: MemberSubscriptionPaymentsManagerProps) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const [activeTab, setActiveTab] = useState<PaymentType>("subscription");
  const [selectedMember, setSelectedMember] = useState<{
    id: string;
    displayName: string;
    isChild: boolean;
    childId?: string;
    parentUserId?: string;
    userId?: string;
  } | null>(null);
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [paymentPeriod, setPaymentPeriod] = useState(new Date().getFullYear().toString());
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [deletePaymentId, setDeletePaymentId] = useState<string | null>(null);
  const [isProcessingPayment, setIsProcessingPayment] = useState(false);

  // Get current year for default period
  const currentYear = new Date().getFullYear();

  // Fetch children assigned to this team
  const { data: teamChildren = [] } = useQuery({
    queryKey: ["team-children-payments", teamId],
    queryFn: async () => {
      if (!teamId) return [];
      const { data, error } = await supabase
        .from("child_team_assignments")
        .select("child_id, children(id, name, parent_id)")
        .eq("team_id", teamId);
      if (error) throw error;
      return data || [];
    },
    enabled: !!teamId,
  });

  // Build payable entries: adult players + child players
  const payableEntries: PayableEntry[] = useMemo(() => {
    const entries: PayableEntry[] = [];

    // Adult players from user_roles
    Object.entries(members).forEach(([userId, member]) => {
      const roles = member.roles?.map(r => r.role) || [];
      if (roles.includes("player")) {
        entries.push({
          id: userId,
          displayName: member.profile?.display_name || "Unknown",
          avatarUrl: member.profile?.avatar_url || null,
          isChild: false,
          userId,
          label: "Player",
        });
      }
    });

    // Child players from team assignments
    teamChildren.forEach((assignment: any) => {
      const child = assignment.children;
      if (!child) return;
      entries.push({
        id: `child_${child.id}`,
        displayName: child.name,
        avatarUrl: null,
        isChild: true,
        childId: child.id,
        parentUserId: child.parent_id,
        label: "Player",
      });
    });

    return entries;
  }, [members, teamChildren]);

  // Collect all relevant user_ids and child_ids for payment lookup
  const parentIds = [...new Set(payableEntries.filter(e => e.isChild && e.parentUserId).map(e => e.parentUserId!))];
  const adultPlayerIds = payableEntries.filter(e => !e.isChild && e.userId).map(e => e.userId!);
  const allUserIds = [...new Set([...adultPlayerIds, ...parentIds])];

  const { data: payments = [], isLoading: isPaymentsLoading } = useQuery({
    queryKey: ["member-subscription-payments", clubId, payableEntries.map(e => e.id).join(","), paymentPeriod, activeTab],
    queryFn: async () => {
      if (allUserIds.length === 0) return [];
      const { data, error } = await supabase
        .from("member_subscription_payments")
        .select("*")
        .eq("club_id", clubId)
        .eq("payment_period", paymentPeriod)
        .eq("payment_type", activeTab)
        .in("user_id", allUserIds);
      if (error) throw error;
      return data || [];
    },
    enabled: allUserIds.length > 0,
  });

  // Fetch club subscription for member payment settings
  const { data: clubPaymentSettings } = useQuery({
    queryKey: ["club-payment-settings", clubId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_subscriptions")
        .select("member_payments_enabled, member_subscription_amount")
        .eq("club_id", clubId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  // Check if current user has paid for current tab type
  const currentUserPayment = payments.find(p => p.user_id === user?.id);
  const canPayOnline = clubPaymentSettings?.member_payments_enabled && 
    clubPaymentSettings?.member_subscription_amount && 
    clubPaymentSettings.member_subscription_amount > 0;

  // Create a map of entry_id -> payment record for quick lookup
  // For children: key is `child_${child_id}`, for adults: key is user_id
  const paymentMap = useMemo(() => {
    const map: Record<string, typeof payments[0]> = {};
    payments.forEach(payment => {
      const p = payment as any;
      if (p.child_id) {
        map[`child_${p.child_id}`] = payment;
      } else {
        map[payment.user_id] = payment;
      }
    });
    return map;
  }, [payments]);

  const markPaidMutation = useMutation({
    mutationFn: async () => {
      if (!selectedMember) return;
      const insertData: any = {
        user_id: selectedMember.isChild ? selectedMember.parentUserId : selectedMember.userId,
        club_id: clubId,
        payment_period: paymentPeriod,
        payment_type: activeTab,
        amount: amount ? parseFloat(amount) : 0,
        notes: notes.trim() || null,
        marked_by: user!.id,
      };
      if (selectedMember.isChild && selectedMember.childId) {
        insertData.child_id = selectedMember.childId;
      }
      const { error } = await supabase.from("member_subscription_payments").insert(insertData);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member-subscription-payments", clubId] });
      setPaymentDialogOpen(false);
      setSelectedMember(null);
      setAmount("");
      setNotes("");
      toast({ title: `${activeTab === "subscription" ? "Subscription" : "Uniform"} payment marked` });
    },
    onError: (error: any) => {
      if (error.code === "23505") {
        toast({ title: "Already marked as paid for this period", variant: "destructive" });
      } else {
        toast({ title: "Failed to mark payment", variant: "destructive" });
      }
    },
  });

  const deletePaymentMutation = useMutation({
    mutationFn: async (paymentId: string) => {
      const { error } = await supabase
        .from("member_subscription_payments")
        .delete()
        .eq("id", paymentId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["member-subscription-payments", clubId] });
      setDeletePaymentId(null);
      toast({ title: "Payment record removed" });
    },
    onError: () => {
      toast({ title: "Failed to remove payment", variant: "destructive" });
    },
  });

  // Bulk send fee payment reminder notifications
  const sendReminderMutation = useMutation({
    mutationFn: async () => {
      // Get unpaid entries - for children, notify the parent
      const unpaidParentIds = [...new Set(
        payableEntries
          .filter(entry => !paymentMap[entry.id])
          .map(entry => entry.isChild ? entry.parentUserId! : entry.userId!)
          .filter(Boolean)
      )];

      if (unpaidParentIds.length === 0) {
        throw new Error("All members have already paid");
      }

      // Get club name
      const { data: clubData } = await supabase
        .from("clubs")
        .select("name")
        .eq("id", clubId)
        .single();

      const clubName = clubData?.name || "Your club";
      const feeLabel = activeTab === "subscription" ? "subscription" : "uniform";

      // Insert notifications for all unpaid members/parents
      const notifications = unpaidParentIds.map(userId => ({
        user_id: userId,
        type: "fee_payment_request",
        message: `${clubName} is requesting payment of ${feeLabel} fees for ${paymentPeriod}`,
        related_id: clubId,
      }));

      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) throw error;

      return unpaidParentIds.length;
    },
    onSuccess: (count) => {
      toast({
        title: "Fee reminders sent!",
        description: `Notification sent to ${count} unpaid member${count !== 1 ? "s" : ""}`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Failed to send reminders",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const handleEntryClick = (entry: PayableEntry) => {
    if (!isAdmin) return;
    
    const existingPayment = paymentMap[entry.id];
    if (existingPayment) {
      setDeletePaymentId(existingPayment.id);
    } else {
      setSelectedMember({
        id: entry.id,
        displayName: entry.displayName,
        isChild: entry.isChild,
        childId: entry.childId,
        parentUserId: entry.parentUserId,
        userId: entry.userId,
      });
      setPaymentDialogOpen(true);
    }
  };

  const handlePayOnline = async () => {
    if (!user || !canPayOnline) return;
    
    setIsProcessingPayment(true);
    try {
      const amountCents = Math.round((clubPaymentSettings?.member_subscription_amount || 0) * 100);
      const isNative = Capacitor.isNativePlatform();
      const title = activeTab === "subscription" 
        ? `Club Subscription - ${paymentPeriod}` 
        : `Uniform Fee - ${paymentPeriod}`;

      const isSubscription = activeTab === "subscription";
      const result = await createMemberCheckout({
        club_id: clubId,
        title,
        amount_cents: amountCents,
        type: isSubscription ? "subscription" : "event",
        // Yearly billing — paymentPeriod is a calendar year string.
        ...(isSubscription ? { interval: "year" as const } : {}),
        payer_email: user.email || undefined,
        description: `${activeTab === "subscription" ? "Subscription" : "Uniform"} payment for ${paymentPeriod}`,
        success_url: isNative 
          ? "igniteclubhq://payment-success" 
          : `${window.location.origin}/teams/${teamId || ""}?payment=success`,
        cancel_url: isNative 
          ? "igniteclubhq://payment-cancel" 
          : `${window.location.origin}/teams/${teamId || ""}?payment=cancelled`,
        metadata: { 
          payment_type: activeTab,
          payment_period: paymentPeriod,
          club_id: clubId,
          ...(teamId ? { team_id: teamId } : {}),
        },
      });

      if (result.error) {
        throw new Error(result.error);
      }

      if (result.url) {
        // Listen for payment completion via Realtime
        listenForPaymentStatus(result.payment_id, (status) => {
          if (status === "paid") {
            queryClient.invalidateQueries({ queryKey: ["member-subscription-payments", clubId] });
            toast({ title: `${paymentTypeLabel} payment successful!` });
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
        title: "Failed to start payment", 
        description: error.message || "Please try again",
        variant: "destructive" 
      });
    } finally {
      setIsProcessingPayment(false);
    }
  };

  const paidCount = payableEntries.filter(entry => paymentMap[entry.id]).length;
  const unpaidCount = payableEntries.length - paidCount;

  const isPayableMember = user && payableEntries.some(entry => !entry.isChild && entry.userId === user.id);
  const hasCurrentUserPaid = !!currentUserPayment;

  const paymentTypeLabel = activeTab === "subscription" ? "Subscription" : "Uniform";
  const PaymentTypeIcon = activeTab === "subscription" ? CreditCard : Shirt;

  if (payableEntries.length === 0) {
    return (
      <div className="text-center py-8 text-muted-foreground">
        <CreditCard className="h-8 w-8 mx-auto mb-2 opacity-50" />
        <p className="text-sm">No players to track payments for</p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Payment Type Tabs */}
      <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PaymentType)}>
        <TabsList className="grid w-full grid-cols-2">
          <TabsTrigger value="subscription" className="flex items-center gap-2">
            <CreditCard className="h-4 w-4" />
            Subscription
          </TabsTrigger>
          <TabsTrigger value="uniform" className="flex items-center gap-2">
            <Shirt className="h-4 w-4" />
            Uniform
          </TabsTrigger>
        </TabsList>

        <TabsContent value={activeTab} className="mt-4 space-y-4">
          {/* Period Selector and Summary */}
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Label htmlFor="payment-period" className="text-sm text-muted-foreground whitespace-nowrap">
                Period:
              </Label>
              <Input
                id="payment-period"
                value={paymentPeriod}
                onChange={(e) => setPaymentPeriod(e.target.value)}
                placeholder={currentYear.toString()}
                className="w-32"
              />
            </div>
            <div className="flex gap-2">
              <Badge variant="outline" className="bg-emerald-500/10 text-emerald-600 border-emerald-500/30">
                {paidCount} Paid
              </Badge>
              <Badge variant="outline" className="bg-amber-500/10 text-amber-600 border-amber-500/30">
                {unpaidCount} Unpaid
              </Badge>
            </div>
          </div>

          {/* Send Fee Reminder Button - Admin only */}
          {isAdmin && unpaidCount > 0 && canPayOnline && (
            <Button
              variant="outline"
              className="w-full"
              onClick={() => sendReminderMutation.mutate()}
              disabled={sendReminderMutation.isPending}
            >
              {sendReminderMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 animate-spin mr-2" />
                  Sending...
                </>
              ) : (
                <>
                  <Bell className="h-4 w-4 mr-2" />
                  Send Fee Reminder to {unpaidCount} Unpaid Member{unpaidCount !== 1 ? "s" : ""}
                </>
              )}
            </Button>
          )}

          {/* Pay Online Button for current user */}
          {isPayableMember && !hasCurrentUserPaid && canPayOnline && (
            <Card className="border-primary/30 bg-primary/5">
              <CardContent className="p-4">
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div>
                    <p className="font-medium">Pay Your Subscription</p>
                    <p className="text-sm text-muted-foreground">
                      ${clubPaymentSettings?.member_subscription_amount} for {paymentPeriod}
                    </p>
                  </div>
                  <Button 
                    onClick={handlePayOnline}
                    disabled={isProcessingPayment}
                  >
                    {isProcessingPayment ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                        Processing...
                      </>
                    ) : (
                      <>
                        <CreditCard className="h-4 w-4 mr-2" />
                        Pay Now
                        <ExternalLink className="h-3 w-3 ml-1" />
                      </>
                    )}
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {isPayableMember && hasCurrentUserPaid && (
            <Card className="border-emerald-500/30 bg-emerald-500/5">
              <CardContent className="p-4 flex items-center gap-3">
                <Check className="h-5 w-5 text-emerald-500" />
                <div>
                  <p className="font-medium text-emerald-600">
                    Your {paymentTypeLabel.toLowerCase()} is paid for {paymentPeriod}
                  </p>
                  {currentUserPayment.notes && (
                    <p className="text-sm text-muted-foreground">{currentUserPayment.notes}</p>
                  )}
                </div>
              </CardContent>
            </Card>
          )}

          {/* Members List */}
          {isPaymentsLoading ? (
            <div className="flex justify-center py-8">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <div className="space-y-2">
              {payableEntries.map((entry) => {
                const payment = paymentMap[entry.id];
                const isPaid = !!payment;
                
                return (
                  <Card 
                    key={entry.id}
                    className={`transition-colors ${
                      isAdmin ? "cursor-pointer hover:bg-muted/50" : ""
                    } ${
                      isPaid ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30"
                    }`}
                    onClick={() => handleEntryClick(entry)}
                  >
                    <CardContent className="p-3 flex items-center gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarImage src={entry.avatarUrl || undefined} />
                        <AvatarFallback className="bg-primary/20 text-primary text-sm">
                          {entry.displayName?.charAt(0)?.toUpperCase() || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1 min-w-0">
                        <p className="font-medium text-sm truncate">
                          {entry.displayName}
                          {!entry.isChild && entry.userId === user?.id && <span className="text-muted-foreground"> (You)</span>}
                        </p>
                        <Badge variant="secondary" className="text-xs mt-0.5">
                          {entry.label}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-2">
                        {isPaid ? (
                          <div className="flex items-center gap-1 text-emerald-500">
                            <Check className="h-5 w-5" />
                            <span className="text-xs font-medium">Paid</span>
                          </div>
                        ) : (
                          <div className="flex items-center gap-1 text-amber-500">
                            <X className="h-5 w-5" />
                            <span className="text-xs font-medium">Unpaid</span>
                          </div>
                        )}
                      </div>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </TabsContent>
      </Tabs>

      {/* Mark as Paid Dialog */}
      <Dialog open={paymentDialogOpen} onOpenChange={setPaymentDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <PaymentTypeIcon className="h-5 w-5" />
              Mark {paymentTypeLabel} as Paid
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <p className="text-sm text-muted-foreground">
              Mark <span className="font-medium text-foreground">{selectedMember?.displayName}</span> as having paid their {paymentTypeLabel.toLowerCase()} fee for <span className="font-medium text-foreground">{paymentPeriod}</span>.
            </p>
            <div className="space-y-2">
              <Label htmlFor="amount">Amount (optional)</Label>
              <Input
                id="amount"
                type="number"
                step="0.01"
                placeholder="e.g., 150.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="notes">Notes (optional)</Label>
              <Textarea
                id="notes"
                placeholder="Any additional notes..."
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <DialogClose asChild>
              <Button variant="outline">Cancel</Button>
            </DialogClose>
            <Button
              onClick={() => markPaidMutation.mutate()}
              disabled={markPaidMutation.isPending}
            >
              {markPaidMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <Check className="h-4 w-4 mr-2" />
              )}
              Mark as Paid
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Remove Payment Confirmation */}
      <AlertDialog open={!!deletePaymentId} onOpenChange={(open) => !open && setDeletePaymentId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Remove Payment Record?</AlertDialogTitle>
            <AlertDialogDescription>
              This will mark this member as unpaid for {paymentTypeLabel.toLowerCase()} this period. You can mark them as paid again later.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deletePaymentId && deletePaymentMutation.mutate(deletePaymentId)}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Remove
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
