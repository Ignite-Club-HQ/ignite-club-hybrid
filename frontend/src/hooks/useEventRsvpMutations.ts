import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";
import { queueRsvp } from "@/lib/rsvpQueue";
import { awardEarlyRsvpPoints } from "@/lib/earlyRsvpPoints";
import { setLocalEventRsvp } from "@/lab/localEventsService";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { setLiveEventRsvp, setLiveChildRsvp, adminUpsertLiveRsvp, adminUpdateLiveRsvpStatus, setLiveRsvpNote } from "@/live/features/events";
import { recordLiveRsvpCompleted } from "@/live/features/insights";

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


  // Optimistic RSVP: show the tapped answer immediately, roll back on failure.
  const sameAccount = (a?: string | null, b?: string | null) =>
    !!a && !!b && a.replace(/^principal:/, "") === b.replace(/^principal:/, "");
  const applyOptimisticRsvp = async (match: (row: any) => boolean, patch: Record<string, unknown>, fresh: Record<string, unknown>) => {
    const key = eventKeys.rsvps(id);
    const cancellation = queryClient.cancelQueries({ queryKey: key });
    const previous = queryClient.getQueryData(key);
    queryClient.setQueryData(key, (current: unknown) => {
      const rows = Array.isArray(current) ? current : [];
      const index = rows.findIndex(match);
      if (index < 0) return [...rows, fresh];
      return rows.map((row: any, i) => (i === index ? { ...row, ...patch } : row));
    });
    await cancellation;
    return { previous, match, optimisticStatus: patch.status };
  };
  const rollbackRsvp = (context?: { previous?: unknown; match: (row: any) => boolean; optimisticStatus: unknown }) => {
    if (!context) return;
    queryClient.setQueryData(eventKeys.rsvps(id), (current: unknown) => {
      if (!Array.isArray(current)) return current;
      const old = Array.isArray(context.previous) ? context.previous.find(context.match) : undefined;
      return current.flatMap((row: any) => {
        if (!context.match(row) || row.status !== context.optimisticStatus) return [row];
        return old ? [old] : [];
      });
    });
  };
  const rsvpMutation = useMutation({
    onMutate: async (status: RsvpStatus) => {
      if (useIcpLab || !user?.id) return undefined;
      return applyOptimisticRsvp(
        (row) => !row.child_id && sameAccount(row.user_id, user.id),
        { status, source: "user" },
        { id: myRsvp?.id || `pending-rsvp-${id}-${user.id}`, event_id: id, user_id: user.id, child_id: null, status, notes: rsvpNotes || null, source: "user",
          profiles: { display_name: profile?.display_name ?? null, avatar_url: profile?.avatar_url ?? null }, children: null },
      );
    },
    onError: (error, _status, context) => {
      rollbackRsvp(context);
      toast({ title: "Could not save RSVP", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    },
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

      // Hybrid routing: when the events feature resolves to ICP, write the
      // RSVP to the events_domain canister (account id = Supabase user id,
      // matching the provisional read mapping). Points/notification side
      // effects are Supabase-only, so they stay on the Supabase branch.
      const routedToIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          if (!id || !user?.id) throw new Error("Missing event or user ID");
          await setLiveEventRsvp(ctx, id, user.id, status);
          // Best-effort engagement counter: runs in the background so it
          // never delays the RSVP confirmation.
          void recordLiveRsvpCompleted(ctx, event?.club_id ?? id, user.id).catch(() => undefined);
          return true;
        },
      }, writeOnce(event?.club_id ? { clubId: event.club_id } : { eventId: id ?? "" }));
      if (routedToIcp) return;

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
    onMutate: async ({ childId, status, childName }: { childId: string; status: RsvpStatus; childName?: string }) => {
      if (useIcpLab || !user?.id) return undefined;
      return applyOptimisticRsvp(
        (row) => row.child_id === childId,
        { status, source: "user" },
        { id: `pending-child-rsvp-${id}-${childId}`, event_id: id, user_id: user.id, child_id: childId, status, notes: null, source: "user",
          profiles: null, children: { id: childId, name: childName ?? null } },
      );
    },
    onError: (error, _vars, context) => {
      rollbackRsvp(context);
      toast({ title: "Could not save RSVP", description: error instanceof Error ? error.message : "Please try again.", variant: "destructive" });
    },
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

      // Hybrid routing: a parent RSVPing their own child writes to the
      // events_domain canister when events are ICP-routed (keyed by
      // event+account+child so it never overwrites the parent's own RSVP).
      const routedToIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          if (!id || !user?.id) throw new Error("Missing event or user ID");
          await setLiveChildRsvp(ctx, id, user.id, childId, status, existingRsvp?.notes ?? "");
          return true;
        },
      }, writeOnce(event?.club_id ? { clubId: event.club_id } : { eventId: id ?? "" }));
      if (routedToIcp) return;

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

      // Hybrid routing: events_domain's set_rsvp_note is keyed by
      // (event_id, account_id) with no child_id parameter, so only the
      // caller's own RSVP note is wired here.
      const routedToIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          if (!id || !user?.id) throw new Error("Missing event or user ID");
          if (childId) {
            throw new Error("Notes for mini-league players aren't available on this backend yet.");
          }
          await setLiveRsvpNote(ctx, id, user.id, note ?? "");
          return true;
        },
      }, writeOnce({ eventId: id ?? "" }));
      if (routedToIcp) return;

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
    onMutate: ({ playerId, playerName, childId, parentUserId, status }: { playerId: string; playerName: string; childId: string | null; parentUserId: string | null; status: RsvpStatus }) =>
      applyOptimisticRsvp(
        row => childId ? row.child_id === childId : row.mini_league_player_id === playerId,
        { status },
        { id: `pending-player-rsvp-${id}-${playerId}`, event_id: id, user_id: parentUserId || user?.id, child_id: childId, mini_league_player_id: childId ? null : playerId, status, children: childId ? { id: childId, name: playerName } : null, mini_league_players: { id: playerId, name: playerName }, profiles: null },
      ),
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
      const routedToIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          if (!id) throw new Error("Missing event ID");
          // Mini-league player RSVPs have no canister shape (no
          // mini_league_players table in events_domain) — only the
          // child-linked branch is wired here.
          if (!childId) {
            throw new Error("Admin RSVP for mini-league players isn't available on this backend yet.");
          }
          await adminUpsertLiveRsvp(ctx, id, parentUserId || user!.id, status, { childId });
          return true;
        },
      }, writeOnce({ eventId: id ?? "" }));
      if (routedToIcp) return;

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
    onError: (error, _variables, context) => {
      rollbackRsvp(context);
      toast({ 
        title: "Failed to update RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to update existing RSVP status by RSVP ID
  const adminUpdateRsvpMutation = useMutation({
    onMutate: ({ rsvpId, status }: { rsvpId: string; status: RsvpStatus; playerName: string }) =>
      applyOptimisticRsvp(row => row.id === rsvpId, { status }, { id: rsvpId, event_id: id, status }),
    mutationFn: async ({ rsvpId, status, playerName }: { rsvpId: string; status: RsvpStatus; playerName: string }) => {
      // rsvpId on the ICP branch is the synthetic `${eventId}:${accountId}:${childId|"self"}`
      // key built when the rsvps query is served by events_domain (see
      // EventDetailPage's roster mapping) — decode it back into the
      // (event, account, child) key the canister's admin_update_rsvp_status
      // call expects, since it has no row-id lookup.
      const parts = parseIcpRsvpRef(rsvpId, id);
      const routedToIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          if (!parts) throw new Error("Unrecognised RSVP reference for this backend.");
          const [eventId, accountId, childPart] = parts;
          await adminUpdateLiveRsvpStatus(ctx, eventId, accountId, status, childPart === "self" ? null : childPart);
          return true;
        },
      }, writeOnce(event?.club_id ? { clubId: event.club_id } : { eventId: parts?.[0] ?? id ?? "" }));
      if (routedToIcp) return;

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
    onError: (error, _variables, context) => {
      rollbackRsvp(context);
      toast({ 
        title: "Failed to update RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to create RSVP for a member who hasn't responded (for team/club events)
  const rsvpForMemberMutation = useMutation({
    onMutate: ({ memberId, memberName, status }: { memberId: string; memberName: string; status: RsvpStatus }) =>
      applyOptimisticRsvp(row => !row.child_id && sameAccount(row.user_id, memberId), { status },
        { id: `pending-member-rsvp-${id}-${memberId}`, event_id: id, user_id: memberId, child_id: null, status, profiles: { display_name: memberName, avatar_url: null }, children: null }),
    mutationFn: async ({ memberId, memberName, status }: { memberId: string; memberName: string; status: RsvpStatus }) => {
      const routedToIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          if (!id) throw new Error("Missing event ID");
          await adminUpsertLiveRsvp(ctx, id, memberId, status);
          return true;
        },
      }, writeOnce({ eventId: id ?? "" }));
      if (routedToIcp) return;

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
    onError: (error, _variables, context) => {
      rollbackRsvp(context);
      toast({ 
        title: "Failed to set RSVP", 
        description: error.message,
        variant: "destructive" 
      });
    },
  });

  // Admin mutation to create RSVP for a child who hasn't responded (for team events)
  const rsvpForChildMutation = useMutation({
    onMutate: ({ childId, childName, parentUserId, status }: { childId: string; childName: string; parentUserId: string; status: RsvpStatus }) =>
      applyOptimisticRsvp(row => row.child_id === childId, { status },
        { id: `pending-child-rsvp-${id}-${childId}`, event_id: id, user_id: parentUserId, child_id: childId, status, profiles: null, children: { id: childId, name: childName } }),
    mutationFn: async ({ childId, childName, parentUserId, status }: { childId: string; childName: string; parentUserId: string; status: RsvpStatus }) => {
      const routedToIcp = await withFeatureBackend("events", {
        supabase: () => false,
        icp: async (ctx) => {
          if (!id) throw new Error("Missing event ID");
          await adminUpsertLiveRsvp(ctx, id, parentUserId, status, { childId });
          return true;
        },
      }, writeOnce({ eventId: id ?? "" }));
      if (routedToIcp) return;

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
    onError: (error, _variables, context) => {
      rollbackRsvp(context);
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
      if (resolveAuthBackend() === "icp") return;
      if (resolveAuthBackend() === "icp") return;
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

/** Decodes `${eventId}:${accountId}:${childId|"self"}`. Event and child IDs
 * may themselves contain ":" (and accounts may carry a "principal:" prefix),
 * so anchor on the known event ID instead of a fixed segment count. */
export function parseIcpRsvpRef(ref: string, knownEventId?: string | null): [string, string, string] | null {
  let eventId: string; let rest: string;
  if (knownEventId && ref.startsWith(`${knownEventId}:`)) { eventId = knownEventId; rest = ref.slice(knownEventId.length + 1); }
  else { const i = ref.indexOf(":"); if (i <= 0) return null; eventId = ref.slice(0, i); rest = ref.slice(i + 1); }
  rest = rest.replace(/^principal:/, "");
  const j = rest.indexOf(":");
  if (j <= 0) return null;
  const accountId = rest.slice(0, j); const childPart = rest.slice(j + 1) || "self";
  return [eventId, accountId, childPart];
}
