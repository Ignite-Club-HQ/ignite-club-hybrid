import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCachedTeam, getCachedClub, cacheTeam, cacheClub } from "@/lib/clubTeamCache";

/**
 * Minimal Supabase client surface this hook needs. Callers pass their page's
 * existing `supabase` client instance so this module never owns its own
 * `integrations/supabase/client` import (keeps the quality-ratchet's
 * `directSupabaseImports` count unaffected by this extraction).
 */
export interface TeamChatTeamSupabaseClient {
  from: (table: string) => any;
}

interface UseTeamChatTeamDataParams {
  supabaseClient: TeamChatTeamSupabaseClient;
  teamId: string | undefined;
  useIcpLab: boolean;
  getLocalLabChatTeam: (teamId: string) => any;
}

/**
 * Loads the team (+ owning club) chat header metadata, warms the shared
 * team/club metadata cache on success, and synthesizes a cache-backed `team`
 * object while the network query is still loading so the header can paint
 * immediately on repeat opens.
 */
export function useTeamChatTeamData({
  supabaseClient,
  teamId,
  useIcpLab,
  getLocalLabChatTeam,
}: UseTeamChatTeamDataParams) {
  const {
    data: teamData,
    isLoading: loadingTeam,
    fetchStatus: teamFetchStatus,
    isError: teamIsError,
    status: teamStatus,
    refetch: refetchTeam,
    isFetching: teamIsFetching,
  } = useQuery({
    queryKey: ["team", teamId],
    queryFn: async () => {
      if (useIcpLab && teamId) {
        return getLocalLabChatTeam(teamId);
      }

      const { data, error } = await supabaseClient
        .from("teams")
        .select("*, clubs!club_id (name, id, logo_url)")
        .eq("id", teamId!)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!teamId,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });

  // Warm metadata cache so future opens render the header without waiting on this query.
  useEffect(() => {
    if (!teamData) return;
    cacheTeam({
      id: teamData.id,
      name: teamData.name,
      logo_url: teamData.logo_url ?? null,
      club_id: teamData.club_id,
      level_age: (teamData as any).level_age ?? null,
    });
    if (teamData.clubs) {
      cacheClub({
        id: teamData.clubs.id,
        name: teamData.clubs.name,
        logo_url: teamData.clubs.logo_url ?? null,
        sport: (teamData.clubs as any).sport ?? null,
        is_pro: (teamData.clubs as any).is_pro ?? false,
      });
    }
  }, [teamData]);

  // Synthesize a team object from cache when the network query is still loading,
  // so the header paints immediately instead of blocking on a metadata fetch.
  const team = useMemo(() => {
    if (teamData) return teamData as any;
    if (!teamId) return null;
    const cachedTeam = getCachedTeam(teamId);
    if (!cachedTeam) return null;
    const cachedClub = cachedTeam.club_id ? getCachedClub(cachedTeam.club_id) : null;
    return {
      id: cachedTeam.id,
      name: cachedTeam.name,
      logo_url: cachedTeam.logo_url,
      club_id: cachedTeam.club_id,
      clubs: cachedClub
        ? { id: cachedClub.id, name: cachedClub.name, logo_url: cachedClub.logo_url }
        : null,
    } as any;
  }, [teamData, teamId]);

  return {
    team,
    loadingTeam,
    teamFetchStatus,
    teamIsError,
    teamStatus,
    refetchTeam,
    teamIsFetching,
  };
}
