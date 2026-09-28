import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
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
      const { data, error } = await supabase.rpc("profile_team_history", {
        _profile_id: profileId,
      });
      if (error) throw error;
      return (data ?? []) as ProfileTeamHistoryEntry[];
    },
    enabled: !!profileId,
    staleTime: 60_000,
  });
}
