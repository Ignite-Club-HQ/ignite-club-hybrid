/**
 * Local port of the sanitized shared module
 * `reference/backend/supabase/functions/process-event-notifications/dedupe.ts.md`.
 *
 * Database-enforced idempotency keys for event push fan-out.
 *
 * The key encodes the *logical* notification identity so that a retried
 * trigger, a duplicated request, a restarted Edge Function, an operator
 * retry or two concurrent invocations all collapse onto the same
 * notification row (unique index `uq_notifications_dedupe_key`).
 *
 * Deliberately NOT a global uniqueness rule:
 *  - invites          → one per (event, user)                       [terminal]
 *  - cancellations    → one per (event, user)                       [terminal]
 *  - updates          → one per (event, user, change-version) so a
 *                       *different* legitimate later edit is still
 *                       deliverable, while a retry of the same edit is
 *                       deduplicated.
 *  - future reminders use their own notification types and are unaffected.
 */

export type NotifyAction = 'event_created' | 'event_cancelled' | 'event_updated';

/** Stable, order-independent fingerprint of an update's changed fields. */
export async function changeVersion(changedFields: unknown[]): Promise<string> {
  const canonical = JSON.stringify(
    (changedFields || [])
      .map((f) => {
        const o = (f ?? {}) as Record<string, unknown>;
        return [
          String(o.field ?? ''),
          o.old === undefined || o.old === null ? '' : String(o.old),
          o.new === undefined || o.new === null ? '' : String(o.new),
        ].join('|');
      })
      .sort(),
  );
  const bytes = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

export function buildDedupeKey(input: {
  notificationType: string;
  eventId: string;
  userId: string;
  version?: string | null;
}): string {
  const base = `${input.notificationType}:${input.eventId}:${input.userId}`;
  return input.version ? `${base}:${input.version}` : base;
}
