import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface SeasonTeamSummary {
  team_id: string;
  team_name: string;
  events_count: number;
  avg_attendance_pct: number;
  roster_size: number;
}

export interface SeasonPlayerStat {
  club_player_id: string;
  player_name: string;
  events_total: number;
  events_attended: number;
  attendance_pct: number;
  games_played: number;
}

export function useSeasonTeamSummary(seasonId: string | undefined, enabled = true) {
  return useQuery({
    queryKey: ["season-team-summary", seasonId],
    queryFn: async (): Promise<SeasonTeamSummary[]> => {
      if (!seasonId) return [];
      const { data, error } = await supabase.rpc("season_team_summary", { _season_id: seasonId });
      if (error) throw error;
      return (data ?? []) as SeasonTeamSummary[];
    },
    enabled: !!seasonId && enabled,
    staleTime: 30_000,
  });
}

export function useSeasonPlayerStats(
  seasonId: string | undefined,
  teamId: string | undefined,
  enabled = true,
) {
  return useQuery({
    queryKey: ["season-player-stats", seasonId, teamId],
    queryFn: async (): Promise<SeasonPlayerStat[]> => {
      if (!seasonId || !teamId) return [];
      const { data, error } = await supabase.rpc("season_player_stats", {
        _season_id: seasonId,
        _team_id: teamId,
      });
      if (error) throw error;
      return (data ?? []) as SeasonPlayerStat[];
    },
    enabled: !!seasonId && !!teamId && enabled,
    staleTime: 30_000,
  });
}
