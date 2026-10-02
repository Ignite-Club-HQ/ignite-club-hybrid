import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { enqueueLiveNotification, listLiveInbox } from "@/live/features/notifications";

/**
 * Sends a gamification notification (leaderboard, streak, reward alerts)
 * through whichever notifications backend is active, with a time-windowed
 * dedup check so users are never spammed.
 *
 * Supabase branch: reads/writes the `notifications` table (dedup on
 * type + optional related_id, exactly as the original inline code did).
 * ICP branch: scans the notification_queue inbox for a recent matching
 * entry (dedup on kind + optional body substring — canister inbox entries
 * carry no related_id from browser enqueues), then enqueues.
 *
 * Fire-and-forget safe: callers wrap with .catch(() => {}).
 */
export async function sendGamificationNotification({
  userId,
  clubId,
  kind,
  message,
  relatedId,
  dedupRelatedId = null,
  dedupHours,
  dedupBodyMatch = null,
}: {
  userId: string;
  clubId: string;
  kind: string;
  message: string;
  /** related_id written on the inserted notification (defaults to clubId). */
  relatedId?: string | null;
  /** related_id used for the dedup lookup; null = dedup on type alone. */
  dedupRelatedId?: string | null;
  /** Dedup window in hours; 0 = no dedup (mirrors undeduped callers). */
  dedupHours: number;
  /** ICP-only dedup aid: require the recent inbox body to contain this. */
  dedupBodyMatch?: string | null;
}): Promise<void> {
  const insertRelatedId = relatedId ?? clubId;
  await withFeatureBackend("notifications", {
    supabase: async () => {
      if (dedupHours > 0) {
        const since = new Date(Date.now() - dedupHours * 3_600_000).toISOString();
        let query = supabase
          .from("notifications")
          .select("id")
          .eq("user_id", userId)
          .eq("type", kind)
          .gte("created_at", since)
          .limit(1);
        if (dedupRelatedId) query = query.eq("related_id", dedupRelatedId);
        const { data: recentNotif } = await query;
        if (recentNotif && recentNotif.length > 0) return;
      }
      await supabase.from("notifications").insert({
        user_id: userId,
        type: kind,
        message,
        related_id: insertRelatedId,
        club_id: clubId,
      });
    },
    icp: async (ctx) => {
      if (dedupHours > 0) {
        const inbox = await listLiveInbox(ctx, userId, clubId, 500);
        const sinceMs = Date.now() - dedupHours * 3_600_000;
        const dupe = inbox.some(
          (n) =>
            n.kind === kind &&
            Number(n.created_at_ms) >= sinceMs &&
            (!dedupBodyMatch || n.body.includes(dedupBodyMatch)),
        );
        if (dupe) return;
      }
      await enqueueLiveNotification(ctx, {
        id: crypto.randomUUID(),
        userId,
        clubId,
        kind,
        body: message,
        idempotencyKey: crypto.randomUUID(),
      });
    },
  });
}
