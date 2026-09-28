import { supabase } from "@/integrations/supabase/client";

/**
 * Notification types that land on the per-club points history / rewards views.
 * Reward points are stored per club (`user_club_points` / `child_club_points`),
 * so tapping one of these must move the active club filter to the club that
 * actually awarded the points — otherwise the user lands on the totals of
 * whichever club happened to be selected before the tap.
 */
export const POINTS_NOTIFICATION_TYPES = [
  "points_awarded",
  "early_rsvp_points",
  "attendance_points",
  "duty_points",
  "reward_redeemed",
  "reward_unlocked",
  "reward_proximity",
  "player_of_match",
  "streak_bonus",
  "streak_progress",
  "leaderboard_update",
] as const;

export function isPointsNotificationType(type: string | null | undefined): boolean {
  return !!type && (POINTS_NOTIFICATION_TYPES as readonly string[]).includes(type);
}

/**
 * Resolve the club that owns a points notification.
 *
 * Priority:
 * 1. the explicit `club_id` stamped on the notification row,
 * 2. the club of the related event (older/reminder rows store the event id),
 * 3. the related id itself when it is a club id (early-bird rows store club id).
 *
 * Returns `null` when nothing can be resolved — callers must then leave the
 * active club untouched rather than guessing.
 */
export async function resolvePointsNotificationClubId(notification: {
  type?: string | null;
  club_id?: string | null;
  related_id?: string | null;
}): Promise<string | null> {
  try {
    if (notification.club_id) return notification.club_id;
    const relatedId = notification.related_id;
    if (!relatedId) return null;

    const { data: eventRow } = await supabase
      .from("events")
      .select("club_id")
      .eq("id", relatedId)
      .maybeSingle();
    if ((eventRow as any)?.club_id) return (eventRow as any).club_id as string;

    const { data: clubRow } = await supabase
      .from("clubs")
      .select("id")
      .eq("id", relatedId)
      .maybeSingle();
    if ((clubRow as any)?.id) return (clubRow as any).id as string;

    return null;
  } catch {
    return null;
  }
}
