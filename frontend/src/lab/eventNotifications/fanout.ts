/**
 * Local port of the sanitized shared module
 * `reference/backend/supabase/functions/process-event-notifications/fanout.ts.md`.
 *
 * Notification-row + push-payload construction for event fan-out. Kept
 * separate so the exact row/payload shapes are characterization-tested and
 * provably unchanged by the delivery-queue rework.
 */

export interface NotificationRow {
  user_id: string;
  type: string;
  message: string;
  related_id: string;
  skip_push: boolean;
}

export interface PushPayload {
  userId: string;
  title: string;
  body: string;
  url: string;
  notificationId?: string;
  tag: string;
  notificationType: string;
}

export const NOTIFICATION_BATCH_SIZE = 500;

export function buildNotificationRows(
  recipientUserIds: string[],
  notificationType: string,
  message: string,
  eventId: string,
): NotificationRow[] {
  return recipientUserIds.map((userId) => ({
    user_id: userId,
    type: notificationType,
    message,
    related_id: eventId,
    skip_push: true,
  }));
}

export function buildPushPayload(input: {
  userId: string;
  body: string;
  url: string;
  notificationId?: string;
  notificationType: string;
  now?: number;
}): PushPayload {
  return {
    userId: input.userId,
    title: 'Ignite',
    body: input.body,
    url: input.url,
    notificationId: input.notificationId,
    tag: `${input.notificationType}-${input.notificationId || (input.now ?? Date.now())}`,
    notificationType: input.notificationType,
  };
}

// Batch insert notifications and return inserted IDs
export async function batchInsertNotifications(
  supabase: any,
  recipientUserIds: string[],
  notificationType: string,
  message: string,
  eventId: string,
): Promise<{ inserted: number; ids: Array<{ userId: string; id: string }> }> {
  let totalInserted = 0;
  const allIds: Array<{ userId: string; id: string }> = [];

  for (let i = 0; i < recipientUserIds.length; i += NOTIFICATION_BATCH_SIZE) {
    const batch = recipientUserIds.slice(i, i + NOTIFICATION_BATCH_SIZE);
    const rows = buildNotificationRows(batch, notificationType, message, eventId);

    const { data: inserted, error } = await supabase
      .from('notifications')
      .upsert(rows, { onConflict: 'id', ignoreDuplicates: true })
      .select('id, user_id');

    if (error) {
      console.error('[EVENT-NOTIFY] Batch insert error:', error);
    } else {
      const results = inserted || [];
      totalInserted += results.length;
      allIds.push(...results.map((r: any) => ({ userId: r.user_id, id: r.id })));
    }
  }

  return { inserted: totalInserted, ids: allIds };
}
