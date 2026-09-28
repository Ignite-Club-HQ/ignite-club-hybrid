/**
 * Local port of `supabase/functions/send-engagement-reminders/dispatch.ts`
 * (see reference/backend/supabase/functions/send-engagement-reminders/dispatch.ts.md).
 *
 * Reminder dispatch: notification rows and their matching cooldown-log rows
 * are persisted ATOMICALLY through `insert_engagement_reminders_atomic`.
 *
 * Reliability invariants:
 *  1. Per batch, notifications and cooldown logs commit together or not at
 *     all. A crash or error between the two writes can no longer leave
 *     notifications without cooldowns (which would re-notify every recipient
 *     next run), nor cooldowns without notifications (which would silently
 *     suppress them).
 *  2. Failures are never ignored. `totalSent` counts only committed rows,
 *     and any failed batch is surfaced so the caller returns a sanitized 500
 *     rather than reporting complete success.
 */

export const BATCH_SIZE = 500;

/** One reminder: notification row and its matching cooldown log row, paired. */
export interface ReminderEntry {
  notification: { user_id: string; type: string; message: string };
  log: { user_id: string; unread_messages_count: number; unread_photos_count: number };
}

/** Thrown when reminder persistence fails. Message is sanitized. */
export class ReminderPersistenceError extends Error {
  readonly code = 'engagement_reminder_persist_failed';
  constructor() {
    super('engagement_reminder_persist_failed');
    this.name = 'ReminderPersistenceError';
  }
}

export interface DispatchResult {
  /** Notifications actually committed (each with its cooldown row). */
  totalSent: number;
  /** Batches that failed atomically — no notifications and no cooldowns. */
  failedBatches: number;
}

function chunkEntries(entries: ReminderEntry[], size = BATCH_SIZE): ReminderEntry[][] {
  const out: ReminderEntry[][] = [];
  for (let i = 0; i < entries.length; i += size) out.push(entries.slice(i, i + size));
  return out;
}

/**
 * Persist reminders in batches of {@link BATCH_SIZE}. Each batch is attempted
 * exactly once per invocation, so no duplicate notifications or cooldowns are
 * produced. Successful batches are kept even when a later batch fails.
 */
export async function dispatchReminders(
  supabase: any,
  entries: ReminderEntry[],
): Promise<DispatchResult> {
  if (entries.length === 0) return { totalSent: 0, failedBatches: 0 };

  const batches = chunkEntries(entries);
  let totalSent = 0;
  let failedBatches = 0;

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];
    const rows = batch.map((e) => ({
      user_id: e.notification.user_id,
      message: e.notification.message,
      unread_messages_count: e.log.unread_messages_count,
      unread_photos_count: e.log.unread_photos_count,
    }));

    const { data, error } = await supabase.rpc('insert_engagement_reminders_atomic', {
      p_rows: rows,
    });

    if (error) {
      // Aggregate-only diagnostic: batch position, size and PG code. Never
      // message bodies, user identifiers, URLs or credentials.
      failedBatches++;
      console.error(
        `[EngagementReminder] atomic reminder batch FAILED batchIndex=${b} batchSize=${batch.length} code=${(error as any)?.code ?? ''}`,
      );
      continue; // nothing committed for this batch — retried next run
    }

    const committed = typeof data === 'number' ? data : batch.length;
    if (committed !== batch.length) {
      // Defensive: the RPC reports its own inserted row count.
      console.error(
        `[EngagementReminder] atomic batch row-count mismatch batchIndex=${b} expected=${batch.length} committed=${committed}`,
      );
    }
    totalSent += committed;
  }

  return { totalSent, failedBatches };
}
