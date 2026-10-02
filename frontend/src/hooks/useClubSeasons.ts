import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveSeasons, getLiveCurrentSeason, type LiveSeason } from "@/live/features/club";

export type SeasonStatus = "draft" | "active" | "closed" | "archived";

export interface Season {
  id: string;
  club_id: string;
  name: string;
  status: SeasonStatus;
  start_date: string | null;
  end_date: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapLiveSeason(season: LiveSeason & { created_at_ms: bigint; updated_at_ms: bigint }): Season {
  return {
    id: season.id,
    club_id: season.club_id,
    name: season.name,
    status: season.status as SeasonStatus,
    start_date: season.start_date || null,
    end_date: season.end_date || null,
    archived_at: season.status === "archived" ? new Date(Number(season.updated_at_ms)).toISOString() : null,
    created_at: new Date(Number(season.created_at_ms)).toISOString(),
    updated_at: new Date(Number(season.updated_at_ms)).toISOString(),
  };
}

export function useClubSeasons(clubId: string | undefined) {
  return useQuery({
    queryKey: ["club-seasons", clubId],
    queryFn: async (): Promise<Season[]> => {
      if (!clubId) return [];
      return withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("seasons")
            .select("*")
            .eq("club_id", clubId)
            .order("created_at", { ascending: false });
          if (error) throw error;
          return (data ?? []) as Season[];
        },
        icp: async (ctx) => {
          const seasons = await listLiveSeasons(ctx, clubId);
          return seasons
            .map(mapLiveSeason)
            .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
        },
      });
    },
    enabled: !!clubId,
  });
}

export function useCurrentSeason(clubId: string | undefined) {
  return useQuery({
    queryKey: ["current-season", clubId],
    queryFn: async (): Promise<Season | null> => {
      if (!clubId) return null;
      return withFeatureBackend("membership", {
        supabase: async () => {
          const { data, error } = await supabase
            .from("seasons")
            .select("*")
            .eq("club_id", clubId)
            .eq("status", "active")
            .order("created_at", { ascending: false })
            .limit(1)
            .maybeSingle();
          if (error) throw error;
          return (data ?? null) as Season | null;
        },
        icp: async (ctx) => {
          const opt = await getLiveCurrentSeason(ctx, clubId);
          return opt.length === 0 ? null : mapLiveSeason(opt[0]);
        },
      });
    },
    enabled: !!clubId,
  });
}
