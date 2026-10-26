import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { resolveAuthBackend } from "@/live/authBackendMode";
import { readHomeRewardsWithDeadline } from "@/features/home/homeRewardQuery";

export interface RewardDirectoryClub {
  id: string; name: string; logo_url: string | null;
  points_display_name?: string | null; points_icon_url?: string | null;
  hasPro: boolean;
}
export function useRewardClubDirectory(userId: string | undefined, clubFilter: string | null) {
  return useQuery({
    queryKey: ["user-clubs-for-rewards", userId, resolveAuthBackend(), clubFilter],
    enabled: !!userId, staleTime: 5 * 60 * 1000, retry: false,
    queryFn: () => withFeatureBackend<RewardDirectoryClub[]>("points", {
      icp: async (ctx) => {
        const { liveMyRewardClubIds, liveRewardClubs } = await import("@/lib/icpRewardsReads");
        return liveRewardClubs(ctx, clubFilter ? [clubFilter] : await liveMyRewardClubIds(ctx));
      },
      supabase: () => readHomeRewardsWithDeadline(async () => {
        if (!userId) return [];
        let ids = clubFilter ? [clubFilter] : [];
        if (!clubFilter) {
          const { data, error } = await supabase.from("user_roles").select("club_id, teams(club_id)").eq("user_id", userId);
          if (error) throw error;
          ids = [...new Set((data ?? []).flatMap((role) => [role.club_id, role.teams?.club_id]).filter((id): id is string => !!id))];
        }
        if (!ids.length) return [];
        const [clubs, subscriptions] = await Promise.all([
          supabase.from("clubs").select("id, name, logo_url, points_display_name, points_icon_url").in("id", ids),
          supabase.from("club_subscriptions").select("club_id, is_pro, is_pro_football, admin_pro_override, admin_pro_football_override").in("club_id", ids),
        ]);
        if (clubs.error) throw clubs.error;
        if (subscriptions.error) throw subscriptions.error;
        return (clubs.data ?? []).map((club) => {
          const sub = subscriptions.data?.find((row) => row.club_id === club.id);
          return { ...club, hasPro: !!(sub?.is_pro || sub?.is_pro_football || sub?.admin_pro_override || sub?.admin_pro_football_override) };
        });
      }),
    }, { shared: "person" }),
  });
}