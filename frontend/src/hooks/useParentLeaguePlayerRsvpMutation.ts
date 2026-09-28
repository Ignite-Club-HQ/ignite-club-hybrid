import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { eventKeys } from "@/lab/eventQueryKeys";

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
