import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";
import { queueRsvp } from "@/lib/rsvpQueue";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { setLocalEventRsvp } from "@/lab/localEventsService";

export type RsvpStatus = "going" | "not_going" | "maybe";

export interface UseEventRsvpMutationsArgs {
  supabase: any;
  useIcpLab: boolean;
  id: string | undefined;
  localIcpPersona: string;
  event: any;
  user: { id?: string } | null | undefined;
  profile: { display_name?: string | null; avatar_url?: string | null } | null | undefined;
  myRsvp: any;
  childRsvps: any[];
  rsvpNotes: string;
  notificationNudge: { hasPushEnabled: boolean | null | undefined };
  setShowPostRsvpNudge: (value: boolean) => void;
  showPaymentStatus: boolean | null | undefined;
  userHasPaid: boolean;
  isProcessingPayment: boolean;
  handlePayNow: () => void;
}

/**
 * RSVP-lifecycle mutations for the event detail page: self RSVP, child RSVP,
 * RSVP notes, admin RSVP overrides, and payment-status toggling. Extracted
 * verbatim from `EventDetailPage.tsx` — no control flow or decision logic
 * changed, only file location.
 */
export function useEventRsvpMutations(params: UseEventRsvpMutationsArgs) {
  const {
    supabase, useIcpLab, id, localIcpPersona, event, user, profile,
    myRsvp, childRsvps, rsvpNotes, notificationNudge, setShowPostRsvpNudge,
    showPaymentStatus, userHasPaid, isProcessingPayment, handlePayNow,
  } = params;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const rsvpMutation = useMutation({
    mutationFn: async (status: RsvpStatus) => {
      if (useIcpLab) {
        if (!id) throw new Error("Missing event ID");
        const localAccountId = user?.id ?? localIcpPersona;
        await setLocalEventRsvp(localIcpPersona, id, localAccountId, status);
        const localRsvp = {
          id: myRsvp?.id || `local-rsvp-${id}-${localAccountId}`,
          event_id: id,
          user_id: localAccountId,
          child_id: null,
          status,
          notes: rsvpNotes || null,
          source: "user",
          profiles: {
            display_name: profile?.display_name || "Local ICP Member",
            avatar_url: profile?.avatar_url || null,
          },
          children: null,
        };
        queryClient.setQueryData(eventKeys.rsvps(id), (current: unknown) => {
          const rows = Array.isArray(current) ? current : [];
          const existingIndex = rows.findIndex((row: any) => row.user_id === localAccountId && !row.child_id);
          if (existingIndex < 0) return [...rows, localRsvp];
          return rows.map((row: any, index) => index === existingIndex ? { ...row, ...localRsvp } : row);
        });
        return;
      }

      let rsvpId: string | null = null;

      // Offline path: queue the RSVP, return early
      if (!navigator.onLine) {
        queueRsvp({
          eventId: id!,
          userId: user!.id,
          status,
          notes: rsvpNotes || null,
          existingRsvpId: myRsvp?.id || null,
        });
        return;
      }

      if (myRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({
            status,
            source: "user",
          })
          .eq("id", myRsvp.id);
        if (error) throw error;
        rsvpId = myRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase.from("rsvps").insert({
          event_id: id!,
          user_id: user!.id,
          status,
          notes: rsvpNotes || null,
          source: "user",
        }).select("id").single();
        if (error) throw error;
        rsvpId = newRsvp?.id || null;
      }

      // Fire-and-forget: don't block UI for points calculation
      if (status === "going" && rsvpId && event) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs?.name || "Your club",
        }).catch(console.error);
      }

      // RSVP notifications are handled by the on_rsvp_notify_admins database trigger
    },
    onSuccess: (_data, status) => {
      if (useIcpLab) return;

      queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.groups(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.pitchTeamMembers(event?.team_id, event?.id) });
      // Refresh points history & rank after fire-and-forget early-RSVP bonus award.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["points-history"] });
        queryClient.invalidateQueries({ queryKey: ["points-rank"] });
        queryClient.invalidateQueries({ queryKey: ["points-rank-seasoned"] });
      }, 1500);
      

      // Show post-RSVP notification nudge if user hasn't enabled push
      if (notificationNudge.hasPushEnabled === false) {
        setTimeout(() => setShowPostRsvpNudge(true), 800);
      }

      // Auto-trigger payment for paid social events when RSVPing "going"
      if (
        status === "going" &&
        showPaymentStatus &&
        !userHasPaid &&
        !isProcessingPayment
      ) {
        // Small delay so user sees the RSVP confirmation first
        setTimeout(() => {
          handlePayNow();
        }, 600);
      }
    },
  });

  // Child RSVP mutation
  const childRsvpMutation = useMutation({
    mutationFn: async ({ childId, status, childName }: { childId: string; status: RsvpStatus; childName?: string }) => {
      const existingRsvp = childRsvps.find((r) => r.child_id === childId);

      if (useIcpLab) {
        const localRsvp = {
          id: existingRsvp?.id || `local-child-rsvp-${id}-${childId}`,
          event_id: id,
          user_id: user?.id,
          child_id: childId,
          status,
          notes: existingRsvp?.notes || null,
          source: "user",
          profiles: null,
          children: { id: childId, name: childName || "ICP Junior" },
        };
        queryClient.setQueryData(eventKeys.rsvps(id), (current: unknown) => {
          const rows = Array.isArray(current) ? current : [];
          const existingIndex = rows.findIndex((row: any) => row.child_id === childId);
          if (existingIndex < 0) return [...rows, localRsvp];
          return rows.map((row: any, index) => index === existingIndex ? { ...row, ...localRsvp } : row);
        });
        return;
      }

      let rsvpId: string | null = null;
      
      if (existingRsvp) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status, source: "user" })
          .eq("id", existingRsvp.id);
        if (error) throw error;
        rsvpId = existingRsvp.id;
      } else {
        const { data: newRsvp, error } = await supabase.from("rsvps").insert({
          event_id: id!,
          user_id: user!.id,
          child_id: childId,
          status,
          source: "user",
        }).select("id").maybeSingle();
        if (error) throw error;
        // If trigger redirected insert→update on duplicate, look up the canonical row.
        if (newRsvp?.id) {
          rsvpId = newRsvp.id;
        } else {
          const { data: existing } = await supabase
            .from("rsvps")
            .select("id")
            .eq("event_id", id!)
            .eq("child_id", childId)
            .maybeSingle();
          rsvpId = existing?.id ?? null;
        }
      }

      // Fire-and-forget: award early RSVP points for child
      if (status === "going" && rsvpId && event) {
        awardEarlyRsvpPoints({
          userId: user!.id,
          childId,
          eventDate: event.event_date,
          rsvpId,
          clubId: event.club_id,
          clubName: event.clubs?.name || "Your club",
        }).catch(console.error);
      }

      // RSVP notifications are handled by the on_rsvp_notify_admins database trigger
    },
    onSuccess: () => {
      if (useIcpLab) return;

      queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.groups(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.pitchTeamMembers(event?.team_id, event?.id) });
      // Refresh points history & rank after fire-and-forget child early-RSVP bonus award.
      setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["points-history"] });
        queryClient.invalidateQueries({ queryKey: ["points-rank"] });
        queryClient.invalidateQueries({ queryKey: ["points-rank-seasoned"] });
      }, 1500);
    },
  });

  const saveRsvpNoteMutation = useMutation({
    mutationFn: async ({ childId, note }: { childId?: string; note: string | null }) => {
      const target = childId
        ? childRsvps.find((r) => r.child_id === childId)
        : myRsvp;
      if (!target) throw new Error("Please choose a response first.");
      const { error } = await supabase
        .from("rsvps")
        .update({ notes: note })
        .eq("id", target.id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id) });
    },
    onError: (err: any) => {
      toast({
        title: "Couldn't save note",
        description: err?.message ?? "Please try again.",
        variant: "destructive",
      });
    },
  });

  // Admin RSVP mutation for mini-league players (club/league admins can change player RSVPs)
  const adminRsvpMutation = useMutation({
    mutationFn: async ({ 
      playerId, 
      playerName, 
      childId, 
      parentUserId,
      status 
    }: { 
      playerId: string; 
      playerName: string;
      childId: string | null;
      parentUserId: string | null;
      status: RsvpStatus;
    }) => {
      if (childId) {
        const { error } = await supabase.rpc('admin_upsert_rsvp', {
          p_event_id: id!,
          p_user_id: parentUserId || user!.id,
          p_status: status,
          p_acting_user_id: user!.id,
          p_child_id: childId,
        });
        if (error) throw error;
      } else {
        const { error } = await supabase.rpc('admin_upsert_rsvp', {
          p_event_id: id!,
          p_user_id: user!.id,
          p_status: status,
          p_acting_user_id: user!.id,
          p_mini_league_player_id: playerId,
        });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.groups(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.pitchTeamMembers(event?.team_id, event?.id) });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to update RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to update existing RSVP status by RSVP ID
  const adminUpdateRsvpMutation = useMutation({
    mutationFn: async ({ rsvpId, status, playerName }: { rsvpId: string; status: RsvpStatus; playerName: string }) => {
      const { error } = await supabase.rpc('admin_update_rsvp_status', {
        p_rsvp_id: rsvpId,
        p_status: status,
        p_acting_user_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.groups(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.pitchTeamMembers(event?.team_id, event?.id) });
      
    },
    onError: (error) => {
      toast({ 
        title: "Failed to update RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to create RSVP for a member who hasn't responded (for team/club events)
  const rsvpForMemberMutation = useMutation({
    mutationFn: async ({ memberId, memberName, status }: { memberId: string; memberName: string; status: RsvpStatus }) => {
      const { error } = await supabase.rpc('admin_upsert_rsvp', {
        p_event_id: id!,
        p_user_id: memberId,
        p_status: status,
        p_acting_user_id: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.pitchTeamMembers(event?.team_id, event?.id) });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to set RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to create RSVP for a child who hasn't responded (for team events)
  const rsvpForChildMutation = useMutation({
    mutationFn: async ({ childId, childName, parentUserId, status }: { childId: string; childName: string; parentUserId: string; status: RsvpStatus }) => {
      // Check if RSVP already exists for this child
      const { data: existingRsvp } = await supabase
        .from("rsvps")
        .select("id")
        .eq("event_id", id!)
        .eq("child_id", childId)
        .maybeSingle();
      
      if (existingRsvp) {
        // Update existing RSVP
        const { error } = await supabase
          .from("rsvps")
          .update({ status })
          .eq("id", existingRsvp.id);
        if (error) throw error;
      } else {
        // Create new RSVP for child
        const { error } = await supabase
          .from("rsvps")
          .insert({ event_id: id!, user_id: parentUserId, child_id: childId, status });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.pitchTeamMembers(event?.team_id, event?.id) });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to set RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Toggle payment status mutation
  const togglePaymentMutation = useMutation({
    mutationFn: async ({ userId, isPaid }: { userId: string; isPaid: boolean }) => {
      if (useIcpLab) {
        queryClient.setQueryData(eventKeys.payments(id), (current: unknown) => {
          const rows = Array.isArray(current) ? current : [];
          if (isPaid) return rows.filter((row: any) => row.user_id !== userId);
          if (rows.some((row: any) => row.user_id === userId)) return rows;
          return [...rows, { user_id: userId }];
        });
        return;
      }

      if (isPaid) {
        // Remove payment record
        const { error } = await supabase
          .from("event_payments")
          .delete()
          .eq("event_id", id!)
          .eq("user_id", userId);
        if (error) throw error;
      } else {
        // Add payment record
        const { error } = await supabase
          .from("event_payments")
          .insert({
            event_id: id!,
            user_id: userId,
            amount: event?.amount || 0,
            payment_status: "paid",
            paid_at: new Date().toISOString(),
          });
        if (error) throw error;
      }
    },
    onSuccess: (_, variables) => {
      if (useIcpLab) {
        toast({ title: variables.isPaid ? "Payment removed locally" : "Marked as paid locally" });
        return;
      }

      queryClient.invalidateQueries({ queryKey: eventKeys.payments(id) });
      toast({ title: variables.isPaid ? "Payment removed" : "Marked as paid" });
    },
    onError: (error) => {
      toast({ 
        title: "Failed to update payment", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  return {
    rsvpMutation,
    childRsvpMutation,
    saveRsvpNoteMutation,
    adminRsvpMutation,
    adminUpdateRsvpMutation,
    rsvpForMemberMutation,
    rsvpForChildMutation,
    togglePaymentMutation,
  };
}
