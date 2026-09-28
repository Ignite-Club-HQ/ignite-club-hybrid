import { supabase } from "@/integrations/supabase/client";
import { recordPointsHistory } from "@/lib/pointsHistory";
import { checkRewardThreshold } from "@/lib/rewardThresholdCheck";

/**
 * Gamification helpers that run after engagement points are awarded.
 * All functions are fire-and-forget safe.
 */

type EngagementAction = 'chat_message' | 'photo_upload' | 'photo_comment';

// ── Actionable nudge messages ──────────────────────────────────────
const NUDGE_MAP: Record<EngagementAction, string[]> = {
  chat_message: [
    'Upload a photo for 2 more pts 📸',
    'Comment on a photo for +1 pt 💬',
  ],
  photo_upload: [
    'Chat with your team for +1 pt 💬',
    'Comment on other photos for +1 pt each 💬',
  ],
  photo_comment: [
    'Upload a photo for 2 pts 📸',
    'Send a team message for +1 pt 💬',
  ],
};

function getActionableNudge(action: EngagementAction): string {
  const nudges = NUDGE_MAP[action];
  return nudges[Math.floor(Math.random() * nudges.length)];
}

/**
 * Builds a rich notification message with points earned + actionable nudge
 */
export function buildEngagementNotification(
  action: EngagementAction,
  points: number,
): string {
  const BASE_MAP: Record<EngagementAction, string> = {
    chat_message: `⭐ +${points} reward point for chat engagement!`,
    photo_upload: `📸 +${points} reward points for uploading a photo!`,
    photo_comment: `💬 +${points} reward point for commenting on a photo!`,
  };

  const nudge = getActionableNudge(action);
  return `${BASE_MAP[action]} ${nudge}`;
}

/**
 * Checks if user's leaderboard rank improved and sends a notification.
 */
export async function checkLeaderboardPosition({
  userId,
  clubId,
}: {
  userId: string;
  clubId: string;
}): Promise<void> {
  try {
    const { data: rank } = await supabase.rpc('get_user_leaderboard_rank', {
      _user_id: userId,
      _club_id: clubId,
    });

    if (!rank || rank <= 0) return;

    // Store/compare rank in a simple notification approach:
    // Only notify for top 20 positions (meaningful leaderboard territory)
    if (rank > 20) return;

    // Check if we already notified for this rank recently (within 24h)
    const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: recentNotif } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "leaderboard_update")
      .gte("created_at", oneDayAgo)
      .limit(1);

    if (recentNotif && recentNotif.length > 0) return;

    const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
    const emoji = rank <= 3 ? '🏆' : rank <= 10 ? '🔥' : '📈';

    await supabase.from("notifications").insert({
      user_id: userId,
      type: "leaderboard_update",
      message: `${emoji} You're now #${rank}${suffix} on the leaderboard! Keep going!`,
      related_id: clubId,
      club_id: clubId,
    });
  } catch (error) {
    console.error("Error checking leaderboard position:", error);
  }
}

/**
 * Checks for weekly engagement streaks and awards bonus points.
 * Streak tiers:
 * - 3 days: +2 bonus pts
 * - 5 days: +3 bonus pts  
 * - 7 days: +5 bonus pts (full week)
 */
export async function checkEngagementStreak({
  userId,
  clubId,
}: {
  userId: string;
  clubId: string;
}): Promise<void> {
  try {
    const { data: streak } = await supabase.rpc('get_engagement_streak', {
      _user_id: userId,
      _club_id: clubId,
    });

    if (!streak) return;

    // Determine bonus tier
    let bonusPoints = 0;
    let streakLabel = '';

    if (streak >= 7) {
      bonusPoints = 5;
      streakLabel = '7-day';
    } else if (streak >= 5) {
      bonusPoints = 3;
      streakLabel = '5-day';
    } else if (streak >= 3) {
      bonusPoints = 2;
      streakLabel = '3-day';
    } else {
      // No bonus yet — send motivation if streak is 2
      if (streak === 2) {
        const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
        const { data: recentNotif } = await supabase
          .from("notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("type", "streak_progress")
          .gte("created_at", oneDayAgo)
          .limit(1);

        if (!recentNotif || recentNotif.length === 0) {
          await supabase.from("notifications").insert({
            user_id: userId,
            type: "streak_progress",
            message: "🔥 2-day streak! Come back tomorrow for bonus points!",
            related_id: clubId,
            club_id: clubId,
          });
        }
      }
      return;
    }

    // Try to award streak bonus (atomic dedup)
    const { data: awarded } = await supabase.rpc('try_award_streak_bonus', {
      _user_id: userId,
      _club_id: clubId,
      _streak_length: streak,
      _bonus_points: bonusPoints,
    });

    if (!awarded) return; // Already awarded this week

    // Increment points — scoped to the club
    const { data: newPoints } = await (supabase.rpc as any)('increment_ignite_points', {
      _user_id: userId,
      _amount: bonusPoints,
      _club_id: clubId,
    });

    const balanceAfter = newPoints || 0;

    // Record history
    await recordPointsHistory({
      userId,
      clubId,
      amount: bonusPoints,
      balanceAfter,
      sourceType: 'weekly_chat_streak',
      description: `🔥 ${streakLabel} engagement streak bonus!`,
    });

    // Send notification
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "streak_bonus",
      message: `🔥 ${streakLabel} streak! +${bonusPoints} bonus reward points!`,
      related_id: clubId,
      club_id: clubId,
    });

    // Check reward thresholds
    checkRewardThreshold({
      userId,
      clubId,
      previousPoints: balanceAfter - bonusPoints,
      newPoints: balanceAfter,
    }).catch(() => {});
  } catch (error) {
    console.error("Error checking engagement streak:", error);
  }
}

/**
 * Checks if user is close to unlocking a reward and sends a proximity alert.
 * Triggers when within 20% of a reward threshold.
 */
export async function checkRewardProximity({
  userId,
  clubId,
  currentPoints,
}: {
  userId: string;
  clubId: string;
  currentPoints: number;
}): Promise<void> {
  try {
    // Find the next reward above current points
    const { data: rewards } = await supabase
      .from("club_rewards")
      .select("id, name, points_required")
      .eq("club_id", clubId)
      .eq("is_active", true)
      .neq("reward_type", "player_of_match")
      .gt("points_required", currentPoints)
      .order("points_required", { ascending: true })
      .limit(1);

    if (!rewards || rewards.length === 0) return;

    const nextReward = rewards[0];
    const pointsNeeded = nextReward.points_required - currentPoints;
    const threshold = Math.ceil(nextReward.points_required * 0.2);

    // Only alert if within 20% of the reward
    if (pointsNeeded > threshold) return;

    // Don't spam — check if we already sent a proximity alert for this reward recently
    const twoDaysAgo = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();
    const { data: recentNotif } = await supabase
      .from("notifications")
      .select("id")
      .eq("user_id", userId)
      .eq("type", "reward_proximity")
      .eq("related_id", nextReward.id)
      .gte("created_at", twoDaysAgo)
      .limit(1);

    if (recentNotif && recentNotif.length > 0) return;

    await supabase.from("notifications").insert({
      user_id: userId,
      type: "reward_proximity",
      message: `🎁 Only ${pointsNeeded} points from unlocking "${nextReward.name}"! Keep engaging!`,
      related_id: nextReward.id,
      club_id: clubId,
    });
  } catch (error) {
    console.error("Error checking reward proximity:", error);
  }
}
