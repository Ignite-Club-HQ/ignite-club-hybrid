import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  getLiveChildPoints,
  getLiveChildPointsAllClubs,
  getLiveChildPointsBatch,
  getLiveUserPoints,
  getLiveUserPointsAllClubs,
} from "@/live/features/points";

/**
 * Read a user's reward-points balance scoped to a single club.
 *
 * Reward points are stored per-club in `user_club_points`. This hook returns
 * 0 when no row exists yet (i.e. the user hasn't earned/spent any points in
 * that club).
 */
export function useUserClubPoints(userId: string | null | undefined, clubId: string | null | undefined) {
  return useQuery({
    queryKey: ["user-club-points", userId, clubId],
    queryFn: async () => {
      if (!userId || !clubId) return 0;
      return withFeatureBackend("points", {
        supabase: async () => {
          const { data } = await supabase
            .from("user_club_points")
            .select("points")
            .eq("user_id", userId)
            .eq("club_id", clubId)
            .maybeSingle();
          return data?.points ?? 0;
        },
        icp: (ctx) => getLiveUserPoints(ctx, clubId, userId),
      });
    },
    enabled: !!userId && !!clubId,
    staleTime: 1000 * 30,
    // Keep previous value while a club switch / background refetch is in
    // flight so the UI never flashes "0 Points" before the real balance
    // resolves.
    placeholderData: (prev) => prev,
  });
}

/**
 * Read a child's reward-points balance scoped to a single club.
 */
export function useChildClubPoints(childId: string | null | undefined, clubId: string | null | undefined) {
  return useQuery({
    queryKey: ["child-club-points", childId, clubId],
    queryFn: async () => {
      if (!childId || !clubId) return 0;
      return withFeatureBackend("points", {
        supabase: async () => {
          const { data } = await supabase
            .from("child_club_points")
            .select("points")
            .eq("child_id", childId)
            .eq("club_id", clubId)
            .maybeSingle();
          return data?.points ?? 0;
        },
        icp: (ctx) => getLiveChildPoints(ctx, clubId, childId),
      });
    },
    enabled: !!childId && !!clubId,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  });
}

/**
 * Bulk-read a user's points across every club they belong to.
 * Useful for profile pages that show a per-club breakdown.
 */
export function useAllUserClubPoints(userId: string | null | undefined) {
  return useQuery({
    queryKey: ["user-club-points-all", userId],
    queryFn: async () => {
      if (!userId) return [] as Array<{ club_id: string; points: number }>;
      return withFeatureBackend("points", {
        supabase: async () => {
          const { data } = await supabase
            .from("user_club_points")
            .select("club_id, points")
            .eq("user_id", userId);
          return (data ?? []) as Array<{ club_id: string; points: number }>;
        },
        icp: async (ctx) => {
          const rows = await getLiveUserPointsAllClubs(ctx, userId);
          return rows.map((r) => ({ club_id: r.clubId, points: r.points }));
        },
      });
    },
    enabled: !!userId,
    staleTime: 1000 * 30,
  });
}

/**
 * Read per-club points for many children at once, scoped to a single club.
 * Returns a Map of childId -> points (0 if no row exists).
 */
export function useChildrenClubPoints(
  childIds: string[] | null | undefined,
  clubId: string | null | undefined,
) {
  const ids = (childIds ?? []).filter(Boolean);
  const key = ids.slice().sort().join(",");
  return useQuery({
    queryKey: ["children-club-points", key, clubId],
    queryFn: async () => {
      const map = new Map<string, number>();
      if (!clubId || ids.length === 0) return map;
      return withFeatureBackend("points", {
        supabase: async () => {
          const { data } = await supabase
            .from("child_club_points")
            .select("child_id, points")
            .eq("club_id", clubId)
            .in("child_id", ids);
          (data ?? []).forEach((r: any) => map.set(r.child_id, r.points ?? 0));
          return map;
        },
        icp: async (ctx) => {
          const chunkSize = 500;
          for (let i = 0; i < ids.length; i += chunkSize) {
            const chunk = ids.slice(i, i + chunkSize);
            const rows = await getLiveChildPointsBatch(ctx, clubId, chunk);
            rows.forEach((r) => map.set(r.childId, r.points));
          }
          return map;
        },
      });
    },
    enabled: !!clubId && ids.length > 0,
    staleTime: 1000 * 30,
    placeholderData: (prev) => prev,
  });
}

/**
 * Bulk-read a child's points across every club they belong to.
 */
export function useAllChildClubPoints(childId: string | null | undefined) {
  return useQuery({
    queryKey: ["child-club-points-all", childId],
    queryFn: async () => {
      if (!childId) return [] as Array<{ club_id: string; points: number }>;
      return withFeatureBackend("points", {
        supabase: async () => {
          const { data } = await supabase
            .from("child_club_points")
            .select("club_id, points")
            .eq("child_id", childId);
          return (data ?? []) as Array<{ club_id: string; points: number }>;
        },
        icp: async (ctx) => {
          const rows = await getLiveChildPointsAllClubs(ctx, childId);
          return rows.map((r) => ({ club_id: r.clubId, points: r.points }));
        },
      });
    },
    enabled: !!childId,
    staleTime: 1000 * 30,
  });
}
