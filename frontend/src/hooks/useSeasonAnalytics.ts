import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveSeasonTeamSummary, listLiveSeasonPlayerStats } from "@/live/features/club";

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
      return withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase.rpc("season_team_summary", { _season_id: seasonId });
          if (error) throw error;
          return (data ?? []) as SeasonTeamSummary[];
        },
        icp: async (ctx) => {
          const rows = await listLiveSeasonTeamSummary(ctx, seasonId);
          return rows.map((row) => ({
            team_id: row.team_id,
            team_name: row.team_name,
            events_count: Number(row.events_count),
            avg_attendance_pct: row.avg_attendance_pct,
            roster_size: Number(row.roster_size),
          }));
        },
      });
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
      return withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase.rpc("season_player_stats", {
            _season_id: seasonId,
            _team_id: teamId,
          });
          if (error) throw error;
          return (data ?? []) as SeasonPlayerStat[];
        },
        icp: async (ctx) => {
          const rows = await listLiveSeasonPlayerStats(ctx, seasonId, teamId);
          return rows.map((row) => ({
            club_player_id: row.club_player_id,
            player_name: row.player_name,
            events_total: Number(row.events_total),
            events_attended: Number(row.events_attended),
            attendance_pct: row.attendance_pct,
            games_played: Number(row.games_played),
          }));
        },
      });
    },
    enabled: !!seasonId && !!teamId && enabled,
    staleTime: 30_000,
  });
}
