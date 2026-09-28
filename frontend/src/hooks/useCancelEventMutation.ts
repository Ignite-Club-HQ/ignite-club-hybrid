import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";
import { refreshEventCaches } from "@/lib/eventCacheRefresh";
import { friendlyMutationError } from "@/lib/friendlyMutationError";

// Thrown when a recurring-series cancellation committed only one of its two
// writes. Records explicitly which mutation committed — never inferred from
// error text.
class SeriesCancellationPartialError extends Error {
  constructor(
    public childrenCommitted: boolean,
    public parentCommitted: boolean,
    public underlying: string,
  ) {
    super(underlying);
    this.name = "SeriesCancellationPartialError";
  }
}

export interface UseCancelEventMutationArgs {
  supabase: any;
  id: string | undefined;
  event: any;
  user: { id?: string } | null | undefined;
  setCancelDialogOpen: (value: boolean) => void;
}

/**
 * Event cancellation mutation for the event detail page: cancels a single
 * event or an entire recurring series, posts a cancellation chat message and
 * refreshes affected caches. Extracted verbatim from `EventDetailPage.tsx`
 * — no control flow or decision logic changed, only file location.
 */
export function useCancelEventMutation(params: UseCancelEventMutationArgs) {
  const { supabase, id, event, user, setCancelDialogOpen } = params;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const cancelEventMutation = useMutation({
    mutationFn: async ({ cancelType, customMessage, sendPushNotification }: { cancelType: 'single' | 'series'; customMessage?: string; sendPushNotification?: boolean }) => {
      console.log("[CancelEvent] Starting cancel mutation", { cancelType, eventId: id, miniLeagueId: event?.mini_league_id });

      const isSeries =
        cancelType === 'series' && (!!event?.parent_event_id || !!event?.is_recurring);

      if (isSeries) {
        // Either arrangement: current event is a child (use its parent id) or
        // the current event IS the recurring parent (use its own id).
        const seriesRootId = event?.parent_event_id || id!;

        const { error: childrenError } = await supabase
          .from("events")
          .update({ is_cancelled: true, chat_cancel_post_handled: true })
          .eq("parent_event_id", seriesRootId);
        const { error: parentError } = await supabase
          .from("events")
          .update({ is_cancelled: true, chat_cancel_post_handled: true })
          .eq("id", seriesRootId);

        const childrenCancellationSucceeded = !childrenError;
        const parentCancellationSucceeded = !parentError;

        if (childrenError) console.error("[CancelEvent] Error cancelling children:", childrenError);
        if (parentError) console.error("[CancelEvent] Error cancelling parent:", parentError);

        // A. Neither write succeeded — complete failure, no chat message.
        if (!childrenCancellationSucceeded && !parentCancellationSucceeded) {
          throw childrenError ?? parentError;
        }

        // C. Exactly one write succeeded — partial state, no chat message.
        if (!childrenCancellationSucceeded || !parentCancellationSucceeded) {
          throw new SeriesCancellationPartialError(
            childrenCancellationSucceeded,
            parentCancellationSucceeded,
            (childrenError ?? parentError)!.message,
          );
        }
        // B. Both succeeded — fall through to normal success behaviour.
      } else {
        // Just cancel this single event
        console.log("[CancelEvent] Cancelling single event:", id);
        const { data, error } = await supabase.from("events").update({ is_cancelled: true, chat_cancel_post_handled: true }).eq("id", id!);
        console.log("[CancelEvent] Update result:", { data, error });
        if (error) {
          console.error("[CancelEvent] Error cancelling event:", error);
          throw error;
        }
      }


      // Get member count for notifications - handle mini-league events differently
      let uniqueMembers: string[] = [];
      
      if (event?.mini_league_id) {
        // Get mini league to find the club_id
        const { data: league } = await supabase
          .from("mini_leagues")
          .select("club_id")
          .eq("id", event.mini_league_id)
          .single();
        
        if (league) {
          // Get all parent user IDs from mini league players
          const { data: playersData } = await supabase
            .from("mini_league_players")
            .select("parent_user_id")
            .eq("mini_league_id", event.mini_league_id)
            .not("parent_user_id", "is", null);
          
          const parentIds = (playersData?.map(p => p.parent_user_id).filter(Boolean) as string[]) || [];
          
          // Get club admins, league admins, and coaches
          const { data: adminRoles } = await supabase
            .from("user_roles")
            .select("user_id")
            .eq("club_id", league.club_id)
            .in("role", ["club_admin", "league_admin", "coach"]);
          
          const adminIds = adminRoles?.map(r => r.user_id) || [];
          
          uniqueMembers = [...new Set([...parentIds, ...adminIds])];
        }
      } else {
        let memberQuery = supabase.from("user_roles").select("user_id");
        if (event?.team_id) {
          memberQuery = memberQuery.eq("team_id", event.team_id);
        } else if (event?.club_id) {
          memberQuery = memberQuery.eq("club_id", event.club_id);
        }
        const { data: members } = await memberQuery;
        uniqueMembers = Array.from(
          new Set<string>(
            (members ?? []).flatMap((member) =>
              typeof member.user_id === "string" ? [member.user_id] : [],
            ),
          ),
        );
      }

      // Always post cancellation message to team, club, or mini-league chat
      if (user && event) {
        const eventPath = `/events/${event.id}`;
        const cancellationMessage = customMessage 
          ? `📢 Event Cancelled: "${event.title}"\n\n${customMessage}\n\nView event: ${eventPath}`
          : `📢 Event Cancelled: "${event.title}"\n\nView event: ${eventPath}`;

        if (event.mini_league_id) {
          // Post to mini-league chat group
          const { data: chatGroup } = await supabase
            .from("chat_groups")
            .select("id")
            .eq("mini_league_id", event.mini_league_id)
            .maybeSingle();
          
          if (chatGroup) {
            const { error: msgError } = await supabase.from("group_messages").insert({
              group_id: chatGroup.id,
              author_id: user.id,
              text: cancellationMessage,
            });
            if (msgError) {
              console.error("Failed to post cancellation to league chat:", msgError);
            }
          }
        } else if (event.team_id) {
          const { error: msgError } = await supabase.from("team_messages").insert({
            team_id: event.team_id,
            author_id: user.id,
            text: cancellationMessage,
          });
          if (msgError) {
            console.error("Failed to post cancellation to team chat:", msgError);
          }
        } else if (event.club_id) {
          const { error: msgError } = await supabase.from("club_messages").insert({
            club_id: event.club_id,
            author_id: user.id,
            text: cancellationMessage,
          });
          if (msgError) {
            console.error("Failed to post cancellation to club chat:", msgError);
          }
        }
      }

      // Notifications are created automatically by the on_event_cancelled DB trigger
      // No need to manually insert them here - that was causing duplicates

      return uniqueMembers.length;
    },
    onSuccess: () => {
      console.log("[CancelEvent] Success - event cancelled");
      setCancelDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: eventKeys.detail(id) });
      refreshEventCaches(queryClient, user?.id);
      toast({ title: "Event cancelled", description: "A message has been posted to the chat" });
    },
    onError: (error) => {
      console.error("[CancelEvent] Mutation error:", error);
      if (error instanceof SeriesCancellationPartialError) {
        // Part of the series IS cancelled — never roll back client-side, and
        // never report either complete success or complete failure.
        setCancelDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: eventKeys.detail(id) });
        queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
        queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id) });
        queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id) });
        queryClient.invalidateQueries({ queryKey: eventKeys.groups(id) });
        const cancelled = error.childrenCommitted
          ? "The repeat occurrences were cancelled"
          : "The main recurring event was cancelled";
        const failed = error.childrenCommitted
          ? "the main recurring event could not be cancelled"
          : "the repeat occurrences could not be cancelled";
        toast({
          title: "Series cancellation incomplete",
          description: `${cancelled}, but ${failed}. No cancellation message was posted. ${error.underlying}`,
          variant: "destructive",
        });
        return;
      }
      toast(friendlyMutationError(error, {
        title: "Failed to cancel event",
        description: (error as any)?.message || "An unexpected error occurred",
      }));
    },

  });

  return { cancelEventMutation };
}
