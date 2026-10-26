import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { writeOnce } from "@/live/clubScope";
import { setLiveMiniLeagueRsvp } from "@/live/features/events";

export type RsvpStatus = "going" | "not_going" | "maybe";

export interface UseParentLeaguePlayerRsvpMutationArgs {
  supabase: any;
  id: string | undefined;
  user: { id?: string } | null | undefined;
  rsvps: any[] | undefined;
}

/**
 * RSVP mutation for a parent responding on behalf of their own mini-league
 * player(s). Extracted verbatim from `EventDetailPage.tsx` — no control flow
 * or decision logic changed, only file location.
 */
export function useParentLeaguePlayerRsvpMutation(params: UseParentLeaguePlayerRsvpMutationArgs) {
  const { supabase, id, user, rsvps } = params;
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const parentLeaguePlayerRsvpMutation = useMutation({
    onMutate: ({ playerId, status }: { playerId: string; status: RsvpStatus }) => {
      void queryClient.cancelQueries({ queryKey: eventKeys.rsvps(id) });
      const previous = queryClient.getQueryData<any[]>(eventKeys.rsvps(id))?.find(row => row.mini_league_player_id === playerId);
      queryClient.setQueryData(eventKeys.rsvps(id), (current: unknown) => {
        const rows = Array.isArray(current) ? current : [];
        return previous ? rows.map(row => row.mini_league_player_id === playerId ? { ...row, status, source: "user" } : row)
          : [...rows, { id: `pending-league-rsvp-${id}-${playerId}`, event_id: id, user_id: user?.id, mini_league_player_id: playerId, child_id: null, status, source: "user" }];
      });
      return { previous, playerId, status };
    },
    mutationFn: async ({ playerId, status }: { playerId: string; status: RsvpStatus }) => {
      // events_domain now exposes set_mini_league_rsvp, keyed by a
      // RsvpSubject variant that covers mini-league-only players.
      if (isFeatureRoutedToIcp("events")) {
        const setOnIcp = await withFeatureBackend("events", {
          supabase: () => false,
          icp: async (ctx) => {
            if (!id) throw new Error("Missing event ID");
            await setLiveMiniLeagueRsvp(
              ctx,
              id,
              { mini_league_player: playerId },
              status,
            );
            return true;
          },
        }, writeOnce({ eventId: id ?? "" }));
        if (setOnIcp) return;
      }

      const existing = rsvps?.find((r) => r.mini_league_player_id === playerId);
      if (existing) {
        const { error } = await supabase
          .from("rsvps")
          .update({ status, source: "user" })
          .eq("id", existing.id);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("rsvps").insert({
          event_id: id!,
          user_id: user!.id,
          mini_league_player_id: playerId,
          status,
          source: "user",
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: eventKeys.rsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.goingRsvps(id) });
      queryClient.invalidateQueries({ queryKey: eventKeys.groups(id) });
    },
    onError: (err: any, _variables, context) => {
      if (context) queryClient.setQueryData(eventKeys.rsvps(id), (current: unknown) => {
        if (!Array.isArray(current)) return current;
        return current.flatMap(row => row.mini_league_player_id === context.playerId && row.status === context.status
          ? context.previous ? [context.previous] : [] : [row]);
      });
      toast({ title: "Failed to update RSVP", description: err.message, variant: "destructive" });
    },
  });

  return { parentLeaguePlayerRsvpMutation };
}
