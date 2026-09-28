import { supabase } from "@/integrations/supabase/client";
import { differenceInDays, parseISO } from "date-fns";
import { recordPointsHistory } from "@/lib/pointsHistory";
import { checkRewardThreshold } from "@/lib/rewardThresholdCheck";

const EARLY_RSVP_DAYS_THRESHOLD = 3;
const EARLY_RSVP_POINTS = 5;

interface AwardEarlyRsvpPointsParams {
  userId: string;
  childId?: string | null;
  eventDate: string;
  rsvpId: string;
  clubId: string;
  clubName: string;
}

/**
 * Awards 3 Reward points to a user if they RSVP "going" at least 3 days before the event.
 * Uses the early_rsvp_points_awarded flag on the RSVP row to prevent re-awards.
 * Returns true if points were awarded, false otherwise.
 */
export async function awardEarlyRsvpPoints({
  userId,
  childId,
  eventDate,
  rsvpId,
  clubId,
  clubName,
}: AwardEarlyRsvpPointsParams): Promise<boolean> {
  try {
    // Check if club has Pro subscription and points system enabled
    const { data: clubSub } = await supabase
      .from("club_subscriptions")
      .select("is_pro, is_pro_football, admin_pro_override, admin_pro_football_override, disable_points_system")
      .eq("club_id", clubId)
      .maybeSingle();

    const hasPro = clubSub?.is_pro || clubSub?.is_pro_football || 
                   clubSub?.admin_pro_override || clubSub?.admin_pro_football_override;

    if (!hasPro || clubSub?.disable_points_system) {
      return false;
    }

    // Check if event is at least 3 days away
    const eventDateParsed = parseISO(eventDate);
    const now = new Date();
    const daysUntilEvent = differenceInDays(eventDateParsed, now);

    if (daysUntilEvent < EARLY_RSVP_DAYS_THRESHOLD) {
      return false;
    }

    // Check if points were already awarded for this RSVP
    const { data: rsvp } = await supabase
      .from("rsvps")
      .select("early_rsvp_points_awarded")
      .eq("id", rsvpId)
      .single();

    if (rsvp?.early_rsvp_points_awarded) {
      return false;
    }

    // Mark RSVP as having awarded points FIRST (optimistic lock)
    // If another request already set this, we'll know from the update count
    const { data: updatedRsvp, error: markError } = await supabase
      .from("rsvps")
      .update({ early_rsvp_points_awarded: true })
      .eq("id", rsvpId)
      .eq("early_rsvp_points_awarded", false)
      .select("id")
      .maybeSingle();

    if (markError || !updatedRsvp) {
      return false; // Another request already marked it
    }

    // Atomic points increment — child or user
    let balanceAfter: number;
    let previousPoints: number;

    if (childId) {
      const { data: newPoints, error: updateError } = await (supabase.rpc as any)('increment_child_ignite_points', {
        _child_id: childId,
        _amount: EARLY_RSVP_POINTS,
        _club_id: clubId,
      });

      if (updateError) {
        console.error("Failed to award early RSVP points to child:", updateError);
        await supabase.from("rsvps").update({ early_rsvp_points_awarded: false }).eq("id", rsvpId);
        return false;
      }

      balanceAfter = newPoints || 0;
      previousPoints = balanceAfter - EARLY_RSVP_POINTS;
    } else {
      const { data: newPoints, error: updateError } = await (supabase.rpc as any)('increment_ignite_points', {
        _user_id: userId,
        _amount: EARLY_RSVP_POINTS,
        _club_id: clubId,
      });

      if (updateError) {
        console.error("Failed to award early RSVP points:", updateError);
        await supabase.from("rsvps").update({ early_rsvp_points_awarded: false }).eq("id", rsvpId);
        return false;
      }

      balanceAfter = newPoints || 0;
      previousPoints = balanceAfter - EARLY_RSVP_POINTS;
    }

    // Record in points history
    await recordPointsHistory({
      userId,
      childId: childId || undefined,
      clubId,
      amount: EARLY_RSVP_POINTS,
      balanceAfter,
      sourceType: 'early_rsvp',
      sourceId: rsvpId,
      description: `Early RSVP bonus (${daysUntilEvent} days before event)`,
    });

    // Get club's custom points name
    const { data: clubData } = await supabase
      .from("clubs")
      .select("points_display_name")
      .eq("id", clubId)
      .single();
    const pointsName = (clubData as any)?.points_display_name || 'reward points';

    // Create notification (always notify the parent user)
    await supabase.from("notifications").insert({
      user_id: userId,
      type: "early_rsvp_points",
      message: `🎯 Early bird bonus! ${childId ? 'Your child' : 'You'} earned +${EARLY_RSVP_POINTS} ${pointsName} for RSVPing ${daysUntilEvent} days before the event. Keep it up!`,
      related_id: clubId,
      club_id: clubId,
    });

    // Check reward threshold
    const rewardName = await checkRewardThreshold({
      userId: childId ? undefined : userId,
      childId: childId || undefined,
      clubId,
      previousPoints,
      newPoints: balanceAfter,
    });

    // Send email notification (fire and forget)
    supabase.functions.invoke("send-points-notification-email", {
      body: {
        recipientUserId: userId,
        pointsAwarded: EARLY_RSVP_POINTS,
        reason: "Early RSVP bonus",
        totalPoints: balanceAfter,
        clubName,
        rewardUnlocked: !!rewardName,
        rewardName,
      },
    }).catch((err) => console.error("Failed to send points email:", err));

    return true;
  } catch (error) {
    console.error("Error in awardEarlyRsvpPoints:", error);
    return false;
  }
}
