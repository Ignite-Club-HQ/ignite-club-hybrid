import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Returns true if there was a match (event type='game') for the given team
 * or mini-league whose start_time / event_date falls within the last 48 hours.
 *
 * Used to gate the "Add to gallery" chip in chats so members can only attach
 * chat photos to the media gallery within 48h after a match.
 */
export function useRecentMatchWindow({
  teamId,
  miniLeagueId,
}: {
  teamId?: string | null;
  miniLeagueId?: string | null;
}) {
  const enabled = !!teamId || !!miniLeagueId;

  const { data } = useQuery({
    queryKey: ["recent-match-window", teamId ?? null, miniLeagueId ?? null],
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    queryFn: async () => {
      const nowIso = new Date().toISOString();
      const fortyEightHoursAgoIso = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

      let q = supabase
        .from("events")
        .select("id, start_time, event_date, team_id, mini_league_id, type, is_cancelled")
        .eq("type", "game")
        .eq("is_cancelled", false)
        .gte("start_time", fortyEightHoursAgoIso)
        .lte("start_time", nowIso)
        .limit(1);

      if (teamId && miniLeagueId) {
        q = q.or(`team_id.eq.${teamId},mini_league_id.eq.${miniLeagueId}`);
      } else if (teamId) {
        q = q.eq("team_id", teamId);
      } else if (miniLeagueId) {
        q = q.eq("mini_league_id", miniLeagueId);
      }

      const { data, error } = await q;
      if (error) {
        console.warn("[useRecentMatchWindow] query failed", error);
        return false;
      }
      return (data?.length ?? 0) > 0;
    },
  });

  return { withinMatchWindow: !!data };
}
