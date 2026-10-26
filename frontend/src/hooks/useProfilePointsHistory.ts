import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { readHomeRewardsWithDeadline } from "@/features/home/homeRewardQuery";

export function useProfilePointsHistory(userId: string | undefined, clubFilter: string | null) {
  return useQuery({
    queryKey: ["points-history", userId, resolveAuthBackend(), clubFilter],
    enabled: !!userId, staleTime: 2 * 60 * 1000, retry: false,
    queryFn: () => withFeatureBackend("points", {
      icp: async (ctx) => {
        if (!userId) return [];
        const { liveMyPointsHistory } = await import("@/lib/icpRewardsReads");
        return liveMyPointsHistory(ctx, userId, clubFilter);
      },
      supabase: () => readHomeRewardsWithDeadline(async () => {
        if (!userId) return [];
        let query = supabase.from("points_history").select("id, amount, balance_after, source_type, source_id, description, created_at, club_id, clubs:club_id (name)").eq("user_id", userId).order("created_at", { ascending: false }).limit(100);
        if (clubFilter) query = query.eq("club_id", clubFilter);
        const { data, error } = await query;
        if (error) throw error;
        return data ?? [];
      }),
    }, { shared: "person" }),
  });
}