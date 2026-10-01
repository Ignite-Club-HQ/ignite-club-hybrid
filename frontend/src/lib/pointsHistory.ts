import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";

export type PointsSourceType = 
  | 'early_rsvp'
  | 'duty'
  | 'attendance'
  | 'player_of_match'
  | 'admin_award'
  | 'redemption'
  | 'pom_removed'
  | 'chat_engagement'
  | 'photo_upload'
  | 'photo_comment'
  | 'weekly_chat_streak'
  | 'weekly_photo_streak';

interface RecordPointsHistoryParams {
  userId?: string | null;
  childId?: string | null;
  clubId?: string | null;
  amount: number;
  balanceAfter: number;
  sourceType: PointsSourceType;
  sourceId?: string | null;
  description: string;
  createdBy?: string | null;
}

/**
 * Records a points transaction in the points_history table.
 * Use positive amounts for awards, negative for redemptions/deductions.
 */
export async function recordPointsHistory(params: RecordPointsHistoryParams): Promise<boolean> {
  const { userId, childId, clubId, amount, balanceAfter, sourceType, sourceId, description, createdBy } = params;
  try {
    return await withFeatureBackend("points", {
      supabase: async () => {
        // points_history has a check constraint enforcing EXACTLY ONE of user_id/child_id.
        // When awarding to a child, we must NOT also set user_id (the guardian) on the row.
        const isChildAward = !!childId;
        const { error } = await supabase.from("points_history").insert({
          user_id: isChildAward ? null : (userId || null),
          child_id: childId || null,
          club_id: clubId || null,
          amount,
          balance_after: balanceAfter,
          source_type: sourceType,
          source_id: sourceId || null,
          description,
          created_by: createdBy || null,
        });

        if (error) {
          console.error("Failed to record points history:", error);
          return false;
        }

        return true;
      },
      // The canister's `award_points` / `redeem_reward` / `cancel_redemption`
      // already write the matching PointsHistoryEntry atomically as part of
      // the same call (see live/features/points.ts doc comment). Call sites
      // that are routed through those canister calls must not also insert a
      // Supabase `points_history` row here — doing so would double-record
      // the same transaction. This is intentionally a no-op on the ICP
      // branch rather than a Supabase fallback write.
      icp: async () => true,
    });
  } catch (error) {
    console.error("Error recording points history:", error);
    return false;
  }
}

/**
 * Formats a points amount for display with sign
 */
export function formatPointsAmount(amount: number): string {
  return amount > 0 ? `+${amount}` : `${amount}`;
}
