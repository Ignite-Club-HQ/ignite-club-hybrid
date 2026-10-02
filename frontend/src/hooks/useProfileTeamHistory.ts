import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveProfileTeamHistory } from "@/live/features/club";
import type { SeasonStatus } from "./useClubSeasons";

export interface ProfileTeamHistoryEntry {
  membership_id: string;
  team_id: string;
  team_name: string;
  team_level_age: string | null;
  club_id: string;
  club_name: string;
  season_id: string;
  season_name: string;
  season_status: SeasonStatus;
  season_start_date: string | null;
  season_end_date: string | null;
  joined_at: string;
}

export function useProfileTeamHistory(profileId: string | undefined) {
  return useQuery({
    queryKey: ["profile-team-history", profileId],
    queryFn: async (): Promise<ProfileTeamHistoryEntry[]> => {
      if (!profileId) return [];
      return withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase.rpc("profile_team_history", {
            _profile_id: profileId,
          });
          if (error) throw error;
          return (data ?? []) as ProfileTeamHistoryEntry[];
        },
        icp: async (ctx) => {
          const rows = await listLiveProfileTeamHistory(ctx, profileId);
          return rows.map((row): ProfileTeamHistoryEntry => ({
            membership_id: row.membership_id,
            team_id: row.team_id,
            team_name: row.team_name,
            team_level_age: row.team_level_age.length ? row.team_level_age[0] : null,
            club_id: row.club_id,
            club_name: row.club_name,
            season_id: row.season_id,
            season_name: row.season_name,
            season_status: row.season_status as SeasonStatus,
            season_start_date: row.season_start_date || null,
            season_end_date: row.season_end_date || null,
            joined_at: new Date(Number(row.joined_at_ms)).toISOString(),
          }));
        },
      });
    },
    enabled: !!profileId,
    staleTime: 60_000,
  });
}
