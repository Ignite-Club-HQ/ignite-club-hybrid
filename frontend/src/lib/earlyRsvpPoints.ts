import { supabase } from "@/integrations/supabase/client";
import { differenceInDays, parseISO } from "date-fns";
import { recordPointsHistory } from "@/lib/pointsHistory";
import { checkRewardThreshold } from "@/lib/rewardThresholdCheck";
import { sendGamificationNotification } from "@/lib/gamificationNotify";
import { icpCallerHasProEntitlement } from "@/lib/icpPointsPro";
import { withFeatureBackend } from "@/live/featureRouter";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { awardLivePoints, subjectFor } from "@/live/features/points";

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
    const pointsOnIcp = isFeatureRoutedToIcp("points");

    if (pointsOnIcp) {
      // ICP branch: no per-club subscription row exists — the caller's own
      // identity_access entitlement is the Pro signal (same simplification
      // as useClubProAccess). An II principal has no Supabase session, so
      // the club_subscriptions read below must never run for them.
      // NEEDS-CANISTER: the club-level disable_points_system kill switch has
      // no club_domain settings field yet.
      if (!(await icpCallerHasProEntitlement())) return false;
    } else {
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
    }

    // Check if event is at least 3 days away
    const eventDateParsed = parseISO(eventDate);
    const now = new Date();
    const daysUntilEvent = differenceInDays(eventDateParsed, now);

    if (daysUntilEvent < EARLY_RSVP_DAYS_THRESHOLD) {
      return false;
    }

    if (!pointsOnIcp) {
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
    }
    // NEEDS-CANISTER (ICP branch): the events canister RSVP record has no
    // early_rsvp_points_awarded flag, so the optimistic lock above cannot
    // run. Cross-day dedup relies on award_points' scope dedup (action_type
    // "early_rsvp" + scope_id rsvpId), which covers same-day repeats; a
    // cancelled-and-rebooked RSVP on a later day could re-award.

    // Atomic points increment — child or user. Routed through the
    // club_points_domain award_points wrapper under ICP so the balance and
    // its history entry land on the canister atomically instead of calling
    // Supabase-only RPCs that never see an ICP user's data.
    let balanceAfter: number;
    let previousPoints: number;

    try {
      balanceAfter = await withFeatureBackend("points", {
        supabase: async () => {
          if (childId) {
            const { data: newPoints, error: updateError } = await (supabase.rpc as any)('increment_child_ignite_points', {
              _child_id: childId,
              _amount: EARLY_RSVP_POINTS,
              _club_id: clubId,
            });
            if (updateError) throw updateError;
            return newPoints || 0;
          }
          const { data: newPoints, error: updateError } = await (supabase.rpc as any)('increment_ignite_points', {
            _user_id: userId,
            _amount: EARLY_RSVP_POINTS,
            _club_id: clubId,
          });
          if (updateError) throw updateError;
          return newPoints || 0;
        },
        icp: async (ctx) => {
          const entry = await awardLivePoints(
            ctx,
            clubId,
            subjectFor({ userId: childId ? null : userId, childId }),
            'early_rsvp',
            rsvpId,
            EARLY_RSVP_POINTS,
            `Early RSVP bonus (${daysUntilEvent} days before event)`,
          );
          return entry.balance_after;
        },
      });
    } catch (updateError) {
      console.error("Failed to award early RSVP points:", updateError);
      if (!pointsOnIcp) {
        await supabase.from("rsvps").update({ early_rsvp_points_awarded: false }).eq("id", rsvpId);
      }
      return false;
    }
    previousPoints = balanceAfter - EARLY_RSVP_POINTS;

    // Record in points history. No-ops on the ICP branch: award_points above
    // already wrote the matching history entry atomically.
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

    // Get club's custom points name.
    // NEEDS-CANISTER (ICP branch): club_domain has no points_display_name
    // setting, so ICP notifications use the default "reward points".
    let pointsName = 'reward points';
    if (!pointsOnIcp) {
      const { data: clubData } = await supabase
        .from("clubs")
        .select("points_display_name")
        .eq("id", clubId)
        .single();
      pointsName = (clubData as any)?.points_display_name || 'reward points';
    }

    // Create notification (always notify the parent user) — routed to the
    // active notifications backend.
    await sendGamificationNotification({
      userId,
      clubId,
      kind: "early_rsvp_points",
      message: `🎯 Early bird bonus! ${childId ? 'Your child' : 'You'} earned +${EARLY_RSVP_POINTS} ${pointsName} for RSVPing ${daysUntilEvent} days before the event. Keep it up!`,
      dedupHours: 0,
    });

    // Check reward threshold — always notify the parent account, so pass
    // userId in both backends (childId-only lookups are Supabase-only).
    const rewardName = await checkRewardThreshold({
      userId,
      childId: childId || undefined,
      clubId,
      previousPoints,
      newPoints: balanceAfter,
    });

    // Send email notification (fire and forget). Points email is not one of
    // the approved Supabase exceptions for ICP sessions, so it stays off
    // when points are routed to the canister.
    if (!pointsOnIcp) {
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
    }

    return true;
  } catch (error) {
    console.error("Error in awardEarlyRsvpPoints:", error);
    return false;
  }
}
