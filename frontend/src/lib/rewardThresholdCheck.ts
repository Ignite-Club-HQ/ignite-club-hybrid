import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveClubRewards } from "@/live/features/points";

/**
 * Checks if a user/child has crossed a reward threshold after receiving points.
 * If so, sends a reward_unlocked notification.
 * Returns the reward name if unlocked, undefined otherwise.
 */
export async function checkRewardThreshold({
  userId,
  childId,
  clubId,
  previousPoints,
  newPoints,
}: {
  userId?: string | null;
  childId?: string | null;
  clubId: string;
  previousPoints: number;
  newPoints: number;
}): Promise<string | undefined> {
  try {
    // Only check if points increased
    if (newPoints <= previousPoints) return undefined;

    // Find highest reward threshold that was just crossed
    const crossedRewards = await withFeatureBackend("points", {
      supabase: async () => {
        const { data } = await supabase
          .from("club_rewards")
          .select("id, name, points_required")
          .eq("club_id", clubId)
          .eq("is_active", true)
          .neq("reward_type", "player_of_match")
          .lte("points_required", newPoints)
          .gt("points_required", previousPoints)
          .order("points_required", { ascending: false })
          .limit(1);
        return (data ?? []) as { id: string; name: string; points_required: number }[];
      },
      icp: async (ctx) => {
        const rewards = await listLiveClubRewards(ctx, clubId, null, true);
        return rewards
          .filter((r) => r.reward_type !== "player_of_match" && r.points_required <= newPoints && r.points_required > previousPoints)
          .sort((a, b) => b.points_required - a.points_required)
          .slice(0, 1)
          .map((r) => ({ id: r.id, name: r.name, points_required: r.points_required }));
      },
    });

    if (!crossedRewards || crossedRewards.length === 0) return undefined;

    const reward = crossedRewards[0];
    const notifyUserId = userId || (childId ? await getParentId(childId) : null);

    if (notifyUserId) {
      // Notifications table has no canister equivalent — always write via Supabase.
      await supabase.from("notifications").insert({
        user_id: notifyUserId,
        type: "reward_unlocked",
        message: `🎁 Reward unlocked! You've earned: ${reward.name}!`,
        related_id: clubId,
        club_id: clubId,
      });
    }

    return reward.name;
  } catch (error) {
    console.error("Error checking reward threshold:", error);
    return undefined;
  }
}

async function getParentId(childId: string): Promise<string | null> {
  const { data } = await supabase
    .from("children")
    .select("parent_id")
    .eq("id", childId)
    .single();
  return data?.parent_id || null;
}
