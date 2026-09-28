import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

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

export function useClubSeasons(clubId: string | undefined) {
  return useQuery({
    queryKey: ["club-seasons", clubId],
    queryFn: async (): Promise<Season[]> => {
      if (!clubId) return [];
      const { data, error } = await supabase
        .from("seasons")
        .select("*")
        .eq("club_id", clubId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Season[];
    },
    enabled: !!clubId,
  });
}

export function useCurrentSeason(clubId: string | undefined) {
  return useQuery({
    queryKey: ["current-season", clubId],
    queryFn: async (): Promise<Season | null> => {
      if (!clubId) return null;
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
    enabled: !!clubId,
  });
}
