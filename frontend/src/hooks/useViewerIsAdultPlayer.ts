import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

/**
 * True when the signed-in adult holds `role = 'player'` in the scope of this
 * event (its team, one of its targeted teams, or — for club-wide events —
 * anywhere in the club).
 *
 * Used to decide whether the adult's own "Your RSVP" block is shown. On mixed
 * teams (adult players + children on the same roster) a `players_only`
 * audience must still prompt the adult player for themselves, while parents
 * continue to RSVP for their children.
 */
export function useViewerIsAdultPlayer(event: {
  team_id?: string | null;
  club_id?: string | null;
  target_team_ids?: string[] | null;
} | null | undefined) {
  const { user } = useAuth();
  const teamId = event?.team_id ?? null;
  const clubId = event?.club_id ?? null;
  const targetTeamIds = Array.isArray(event?.target_team_ids) ? event!.target_team_ids! : [];
  const targetKey = [...targetTeamIds].sort().join(",");

  return useQuery({
    queryKey: ["viewer-is-adult-player", user?.id, teamId, clubId, targetKey],
    enabled: !!user?.id && !!(teamId || clubId || targetTeamIds.length > 0),
    staleTime: 60_000,
    queryFn: async () => {
      let q = supabase
        .from("user_roles")
        .select("id")
        .eq("user_id", user!.id)
        .eq("role", "player");
      if (teamId) {
        q = q.eq("team_id", teamId);
      } else if (targetTeamIds.length > 0) {
        q = q.in("team_id", targetTeamIds);
      } else if (clubId) {
        q = q.eq("club_id", clubId);
      }
      const { data, error } = await q.limit(1);
      if (error) return false;
      return (data?.length ?? 0) > 0;
    },
  });
}
