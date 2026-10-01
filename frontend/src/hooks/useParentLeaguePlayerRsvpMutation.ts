import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

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
    mutationFn: async ({ playerId, status }: { playerId: string; status: RsvpStatus }) => {
      // NEEDS-CANISTER: events_domain has no mini-league-player RSVP shape
      // (set_rsvp/admin_upsert_rsvp are keyed by account/child, not
      // mini_league_player_id). Block under ICP routing instead of writing
      // to a Supabase row ICP users' canister state never reflects.
      if (isFeatureRoutedToIcp("events")) {
        throw new Error("RSVPing for a mini-league player isn't available yet on this backend.");
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
    onError: (err: any) => {
      toast({ title: "Failed to update RSVP", description: err.message, variant: "destructive" });
    },
  });

  return { parentLeaguePlayerRsvpMutation };
}
