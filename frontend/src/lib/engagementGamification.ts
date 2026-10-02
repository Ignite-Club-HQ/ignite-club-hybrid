import { supabase } from "@/integrations/supabase/client";
import { recordPointsHistory } from "@/lib/pointsHistory";
import { checkRewardThreshold } from "@/lib/rewardThresholdCheck";
import { sendGamificationNotification } from "@/lib/gamificationNotify";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  awardLivePoints,
  getLiveLeaderboard,
  listLiveClubRewards,
  listLivePointsHistory,
  subjectForUser,
} from "@/live/features/points";

/**
 * Gamification helpers that run after engagement points are awarded.
 * All functions are fire-and-forget safe.
 *
 * Every read/write is routed: the points branch talks to club_points_domain
 * (or the Supabase RPCs), and every notification goes through
 * sendGamificationNotification, which routes to notification_queue under
 * ICP. Nothing here may touch Supabase for an Internet Identity principal.
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
 *
 * Supabase: `get_user_leaderboard_rank` RPC (all-time ignite_points order).
 * ICP: club_points_domain `get_leaderboard` with the "all" window (any value
 * other than "week"/"month" sums all history, matching the RPC's ordering);
 * the user ranks by their position in the top-20 page, 0 when not ranked.
 */
export async function checkLeaderboardPosition({
  userId,
  clubId,
}: {
  userId: string;
  clubId: string;
}): Promise<void> {
  try {
    const rank = await withFeatureBackend("points", {
      supabase: async () => {
        const { data } = await supabase.rpc('get_user_leaderboard_rank', {
          _user_id: userId,
          _club_id: clubId,
        });
        return (data ?? 0) as number;
      },
      icp: async (ctx) => {
        const entries = await getLiveLeaderboard(ctx, clubId, "User", "all", 20);
        const idx = entries.findIndex((e) => e.subject_id === userId);
        return idx >= 0 ? idx + 1 : 0;
      },
    });

    if (!rank || rank <= 0) return;

    // Only notify for top 20 positions (meaningful leaderboard territory)
    if (rank > 20) return;

    const suffix = rank === 1 ? 'st' : rank === 2 ? 'nd' : rank === 3 ? 'rd' : 'th';
    const emoji = rank <= 3 ? '🏆' : rank <= 10 ? '🔥' : '📈';

    await sendGamificationNotification({
      userId,
      clubId,
      kind: "leaderboard_update",
      message: `${emoji} You're now #${rank}${suffix} on the leaderboard! Keep going!`,
      dedupHours: 24,
    });
  } catch (error) {
    console.error("Error checking leaderboard position:", error);
  }
}

/** Points history source types that count as "engagement" for streaks. */
const ENGAGEMENT_SOURCE_TYPES = new Set(["chat_engagement", "photo_upload", "photo_comment"]);

const dayKey = (ms: number) => new Date(ms).toISOString().slice(0, 10);

/**
 * Checks for weekly engagement streaks and awards bonus points.
 * Streak tiers:
 * - 3 days: +2 bonus pts
 * - 5 days: +3 bonus pts
 * - 7 days: +5 bonus pts (full week)
 *
 * Supabase: `get_engagement_streak` / `try_award_streak_bonus` RPCs (atomic
 * weekly dedup). ICP: no canister equivalent exists, so the streak is
 * reconstructed client-side from the points history (consecutive UTC days
 * with an engagement entry) and the weekly dedup is a best-effort history
 * scan for a weekly_chat_streak entry inside the current ISO week —
 * race-tolerant because this path is fire-and-forget and the award itself
 * is additionally scope-deduped by award_points for same-day repeats.
 * NEEDS-CANISTER: atomic streak computation + weekly dedup.
 */
export async function checkEngagementStreak({
  userId,
  clubId,
}: {
  userId: string;
  clubId: string;
}): Promise<void> {
  try {
    const { streak, canAward } = await withFeatureBackend("points", {
      supabase: async () => {
        const { data: streakData } = await supabase.rpc('get_engagement_streak', {
          _user_id: userId,
          _club_id: clubId,
        });
        const s = (streakData ?? 0) as number;
        if (s < 3) return { streak: s, canAward: false };
        const bonus = s >= 7 ? 5 : s >= 5 ? 3 : 2;
        const { data: awarded } = await supabase.rpc('try_award_streak_bonus', {
          _user_id: userId,
          _club_id: clubId,
          _streak_length: s,
          _bonus_points: bonus,
        });
        return { streak: s, canAward: !!awarded };
      },
      icp: async (ctx) => {
        // The canister computes the streak (consecutive UTC days ending
        // today or yesterday) — same contract as the Supabase RPC.
        const s = await getLiveEngagementStreak(ctx, clubId, userId);
        if (s < 3) return { streak: s, canAward: false };
        // Weekly dedup is scope-based: one award per ISO week via
        // awardLivePointsOnce ("Already awarded" is a no-op), mirroring the
        // try_award_streak_bonus RPC's weekly uniqueness.
        const now = new Date();
        const mondayOffset = (now.getUTCDay() + 6) % 7;
        const weekStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset);
        const page = await listLivePointsHistory(ctx, clubId, subjectForUser(userId), 0, 500);
        const awardedThisWeek = page.items.some(
          (i) => i.source_type === "weekly_chat_streak" && Number(i.created_at_ms) >= weekStartMs,
        );
        return { streak: s, canAward: !awardedThisWeek };
      },
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
        await sendGamificationNotification({
          userId,
          clubId,
          kind: "streak_progress",
          message: "🔥 2-day streak! Come back tomorrow for bonus points!",
          dedupHours: 24,
        });
      }
      return;
    }

    if (!canAward) return; // Already awarded this week

    // Increment points — scoped to the club
    const balanceAfter = await withFeatureBackend("points", {
      supabase: async () => {
        const { data: newPoints } = await (supabase.rpc as any)('increment_ignite_points', {
          _user_id: userId,
          _amount: bonusPoints,
          _club_id: clubId,
        });
        const balance = newPoints || 0;

        // Record history
        await recordPointsHistory({
          userId,
          clubId,
          amount: bonusPoints,
          balanceAfter: balance,
          sourceType: 'weekly_chat_streak',
          description: `🔥 ${streakLabel} engagement streak bonus!`,
        });

        return balance;
      },
      icp: async (ctx) => {
        // `award_points` records the matching history entry atomically —
        // do not also call recordPointsHistory here (it no-ops on this
        // branch anyway, see live/features/points.ts doc comment).
        // Scope the dedup to the ISO week (not the streak length) so the
        // once-per-week rule survives a longer streak next week.
        const now = new Date();
        const mondayOffset = (now.getUTCDay() + 6) % 7;
        const weekStartMs = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - mondayOffset);
        const entry = await awardLivePointsOnce(
          ctx,
          clubId,
          subjectForUser(userId),
          'weekly_chat_streak',
          `week:${weekStartMs}`,
          bonusPoints,
          `🔥 ${streakLabel} engagement streak bonus!`,
        );
        return entry.balance_after;
      },
    });

    // Send notification
    await sendGamificationNotification({
      userId,
      clubId,
      kind: "streak_bonus",
      message: `🔥 ${streakLabel} streak! +${bonusPoints} bonus reward points!`,
      dedupHours: 0,
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
    const rewards = await withFeatureBackend("points", {
      supabase: async () => {
        const { data } = await supabase
          .from("club_rewards")
          .select("id, name, points_required")
          .eq("club_id", clubId)
          .eq("is_active", true)
          .neq("reward_type", "player_of_match")
          .gt("points_required", currentPoints)
          .order("points_required", { ascending: true })
          .limit(1);
        return (data ?? []) as { id: string; name: string; points_required: number }[];
      },
      icp: async (ctx) => {
        const all = await listLiveClubRewards(ctx, clubId, null, true);
        return all
          .filter((r) => r.reward_type !== "player_of_match" && r.points_required > currentPoints)
          .sort((a, b) => a.points_required - b.points_required)
          .slice(0, 1)
          .map((r) => ({ id: r.id, name: r.name, points_required: r.points_required }));
      },
    });

    if (!rewards || rewards.length === 0) return;

    const nextReward = rewards[0];
    const pointsNeeded = nextReward.points_required - currentPoints;
    const threshold = Math.ceil(nextReward.points_required * 0.2);

    // Only alert if within 20% of the reward
    if (pointsNeeded > threshold) return;

    await sendGamificationNotification({
      userId,
      clubId,
      kind: "reward_proximity",
      message: `🎁 Only ${pointsNeeded} points from unlocking "${nextReward.name}"! Keep engaging!`,
      relatedId: nextReward.id,
      dedupRelatedId: nextReward.id,
      dedupHours: 48,
      dedupBodyMatch: nextReward.name,
    });
  } catch (error) {
    console.error("Error checking reward proximity:", error);
  }
}
