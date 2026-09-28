import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Share } from "@capacitor/share";
import { Capacitor } from "@capacitor/core";
import { getShareUrl } from "@/lib/shareUtils";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";
import { resolveEventRecipients, eventRecipientContext } from "@/features/events/eventRecipientPolicy";
import { resolveReminderRecipients, applyReminderCooldown, normalizeRecipientIds } from "@/features/events/reminderRecipients";

const REMINDER_COOLDOWN_MS = 24 * 60 * 60 * 1000;

export interface UseEventReminderMutationsArgs {
  supabase: any;
  id: string | undefined;
  event: any;
  gateEventShare: () => boolean;
  setRecentlyReminded: (updater: (prev: Map<string, string>) => Map<string, string>) => void;
  setResendDialogOpen: (value: boolean) => void;
}

/**
 * Reminder/invite mutations for the event detail page: bulk "remind
 * non-responders", per-member/per-child reminders, sharing a reminder link,
 * and resending invites to newly-eligible members. Extracted verbatim from
 * `EventDetailPage.tsx` — no control flow or decision logic changed, only
 * file location.
 */
export function useEventReminderMutations(params: UseEventReminderMutationsArgs) {
  const { supabase, id, event, gateEventShare, setRecentlyReminded, setResendDialogOpen } = params;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const remindMutation = useMutation({
    mutationFn: async () => {
      // Get all RSVPs for this event
      const { data: existingRsvps, error: rsvpError } = await supabase
        .from("rsvps")
        .select("user_id")
        .eq("event_id", id!);
      if (rsvpError) throw rsvpError;

      
      const rsvpUserIds = existingRsvps?.map(r => r.user_id) || [];
      
      // Resolve the eligible audience through the shared recipient policy so
      // targeted club-wide events never nag uninvited teams or unrelated
      // club officials.
      const allMemberIds = await resolveEventRecipients(
        supabase,
        eventRecipientContext(event, id!),
      );

      
      // Find members who haven't RSVPed
      const nonRsvpMembers = allMemberIds.filter(memberId => !rsvpUserIds.includes(memberId));
      
      if (nonRsvpMembers.length === 0) {
        throw new Error("Everyone has already RSVPed!");
      }
      
      // Check for reminders sent in the last 24 hours to avoid spamming members
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      const { data: existingNotifications, error: cooldownError } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_reminder")
        .eq("related_id", id!)
        .in("user_id", nonRsvpMembers)
        .gte("created_at", since);
      if (cooldownError) throw cooldownError;

      const existingNotificationUserIds = existingNotifications?.map(n => n.user_id) || [];
      const membersToNotify = nonRsvpMembers.filter(memberId => !existingNotificationUserIds.includes(memberId));

      if (membersToNotify.length === 0) {
        throw new Error("All non-responders were already reminded in the last 24 hours");
      }
      
      // Create notifications - the DB trigger (on_notification_created) handles push dispatch
      const notifications = membersToNotify.map(userId => ({
        user_id: userId,
        type: "event_reminder",
        message: `Reminder: Please RSVP for "${event?.title}"`,
        related_id: id,
      }));
      
      const { error } = await supabase.from("notifications").insert(notifications);
      if (error) throw error;
      
      return membersToNotify.length;
    },
    onSuccess: (count) => {
      toast({ 
        title: "Reminders sent", 
        description: `${count} member${count !== 1 ? 's' : ''} have been reminded to RSVP` 
      });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to send reminders", variant: "destructive" });
    },
  });

  // Individual remind mutation - sends reminder to a single member or all guardians of a child.
  // For mini-league players, userId may be empty when mini_league_players.parent_user_id is NULL;
  // in that case we derive recipients entirely from the linked child (children.parent_id + child_guardians).
  const individualRemindMutation = useMutation({
    mutationFn: async ({ userId, displayName, childId }: { userId?: string; displayName: string; childId?: string }) => {
      let recipientIds: string[] = normalizeRecipientIds([userId]);

      if (childId) {
        // Both reads are authoritative — a failure in either must fail closed.
        // Guardians are club-scoped: only guardians who belong to this event's
        // club are reminded (a parent linked at another club is not notified).
        const [guardiansRes, childRes] = await Promise.all([
          event?.club_id
            ? supabase
                .rpc("club_scoped_child_guardians", { p_child_ids: [childId], p_club_id: event.club_id })
                .then((res) => ({
                  data: (res.data as { guardian_id: string }[] | null) ?? null,
                  error: res.error,
                }))
            : supabase.from("child_guardians").select("guardian_id").eq("child_id", childId),
          supabase.from("children").select("parent_id").eq("id", childId).maybeSingle(),
        ]);


        const resolved = resolveReminderRecipients({
          userId,
          guardians: guardiansRes.data,
          guardiansError: guardiansRes.error,
          child: childRes.data,
          childError: childRes.error,
        });
        if (resolved.status === "error") throw new Error(resolved.message);
        recipientIds = resolved.recipientIds;
      }

      if (recipientIds.length === 0) {
        throw new Error(`${displayName} has no linked parents to remind`);
      }

      // 24h cooldown — skip recipients who were reminded in the last 24 hours
      const since = new Date(Date.now() - REMINDER_COOLDOWN_MS).toISOString();
      const { data: existing, error: cooldownError } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_reminder")
        .eq("related_id", id!)
        .in("user_id", recipientIds)
        .gte("created_at", since);

      const afterCooldown = applyReminderCooldown({
        recipientIds,
        recentlyRemindedRows: existing,
        cooldownError,
      });
      if (afterCooldown.status === "error") throw new Error(afterCooldown.message);
      const toRemind = afterCooldown.recipientIds;

      if (toRemind.length === 0) {
        throw new Error(`${displayName}${recipientIds.length > 1 ? "'s parents have" : " has"} been reminded in the last 24 hours`);
      }

      const { error } = await supabase.from("notifications").insert(
        toRemind.map((uid) => ({
          user_id: uid,
          type: "event_reminder",
          message: `Reminder: Please RSVP for "${event?.title}"`,
          related_id: id,
        }))
      );
      if (error) throw error;

      return { displayName, count: toRemind.length, isChild: !!childId, recipientKey: userId || childId || displayName };
    },
    onSuccess: ({ displayName, count, isChild, recipientKey }) => {
      const now = new Date().toISOString();
      setRecentlyReminded((prev) => {
        const next = new Map(prev);
        next.set(recipientKey, now);
        return next;
      });
      // Refresh the 24h cooldown set so the "Reminded" state survives a page reload
      queryClient.invalidateQueries({ queryKey: eventKeys.recentReminders(id) });
      const description = isChild
        ? `${count} parent${count !== 1 ? "s" : ""} of ${displayName} ${count !== 1 ? "have" : "has"} been reminded to RSVP`
        : `${displayName} has been reminded to RSVP`;
      toast({ title: "Reminder sent", description });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to send reminder", variant: "destructive" });
    },
  });


  // Share event reminder link via native share
  const handleShareReminderLink = async () => {
    if (!gateEventShare()) return;
    const shareUrl = getShareUrl("event", id!);
    const shareText = `Reminder: Please RSVP for "${event?.title}"`;
    try {
      if (Capacitor.isNativePlatform()) {
        await Share.share({
          title: shareText,
          text: shareText,
          url: shareUrl,
          dialogTitle: 'Share Reminder',
        });
      } else if (navigator.share) {
        await navigator.share({
          title: shareText,
          text: shareText,
          url: shareUrl,
        });
      } else {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        toast({ title: "Reminder link copied to clipboard!" });
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') {
        await navigator.clipboard.writeText(`${shareText}\n${shareUrl}`);
        toast({ title: "Reminder link copied to clipboard!" });
      }
    }
  };


  // Resend event invites to members who haven't been notified yet
  const resendInvitesMutation = useMutation({
    mutationFn: async () => {
      if (!event || !id) throw new Error("No event");

      // Shared recipient policy (same audience as bulk reminders)
      const resolved = await resolveEventRecipients(
        supabase,
        eventRecipientContext(event, id),
      );

      // Exclude the creator
      const allMemberIds = resolved.filter(uid => uid !== event.created_by);

      // Find members who already have a notification for this event
      const { data: existingNotifications, error: existingError } = await supabase
        .from("notifications")
        .select("user_id")
        .eq("type", "event_invite")
        .eq("related_id", id)
        .in("user_id", allMemberIds.length > 0 ? allMemberIds : ['no-match']);
      if (existingError) throw existingError;


      const alreadyNotified = new Set(existingNotifications?.map(n => n.user_id) || []);
      const newMembers = allMemberIds.filter(uid => !alreadyNotified.has(uid));

      if (newMembers.length === 0) {
        throw new Error("All members have already been notified about this event!");
      }

      // Insert notifications with skip_push
      const notificationRows = newMembers.map(userId => ({
        user_id: userId,
        type: "event_invite",
        message: `You've been invited to: ${event.title}`,
        related_id: id,
        skip_push: true,
      }));

      const { error: insertError } = await supabase
        .from("notifications")
        .insert(notificationRows);
      if (insertError) throw insertError;

      // Send push notifications
      for (const userId of newMembers) {
        supabase.functions.invoke("send-push-notification", {
          body: {
            userId,
            title: "Ignite",
            body: `You've been invited to: ${event.title}`,
            url: `/events/${id}`,
            tag: `event-invite-${id}`,
            notificationType: "event_invite",
          },
        }).catch(console.error);
      }

      return newMembers.length;
    },
    onSuccess: (count) => {
      setResendDialogOpen(false);
      toast({
        title: "Invites sent",
        description: `${count} new member${count !== 1 ? 's' : ''} have been notified`,
      });
    },
    onError: (error: Error) => {
      toast({ title: error.message || "Failed to resend invites", variant: "destructive" });
    },
  });

  return {
    remindMutation,
    individualRemindMutation,
    handleShareReminderLink,
    resendInvitesMutation,
  };
}
