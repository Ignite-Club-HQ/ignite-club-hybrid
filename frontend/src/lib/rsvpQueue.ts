import { supabase } from "@/integrations/supabase/client";

export type QueuedRsvpStatus = "going" | "maybe" | "not_going";

export interface QueuedRsvp {
  id: string;
  eventId: string;
  userId: string;
  childId?: string | null;
  miniLeaguePlayerId?: string | null;
  status: QueuedRsvpStatus;
  notes?: string | null;
  // Existing rsvp row id if we're updating one we already had cached
  existingRsvpId?: string | null;
  queuedAt: string;
  retryCount: number;
}

const QUEUE_KEY = "ignite_rsvp_queue";
const MAX_RETRIES = 3;
const VALID_STATUSES: QueuedRsvpStatus[] = ["going", "maybe", "not_going"];

function isValidQueuedRsvp(entry: unknown): entry is QueuedRsvp {
  if (!entry || typeof entry !== "object") return false;
  const e = entry as Record<string, unknown>;
  if (typeof e.id !== "string" || e.id.length === 0) return false;
  if (typeof e.eventId !== "string" || e.eventId.length === 0) return false;
  if (typeof e.userId !== "string" || e.userId.length === 0) return false;
  if (typeof e.status !== "string" || !VALID_STATUSES.includes(e.status as QueuedRsvpStatus)) return false;
  if (typeof e.retryCount !== "number" || !Number.isFinite(e.retryCount) || e.retryCount < 0) return false;
  if (typeof e.queuedAt !== "string" || e.queuedAt.length === 0) return false;
  return true;
}

export function getQueuedRsvps(): QueuedRsvp[] {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isValidQueuedRsvp);
  } catch {
    return [];
  }
}

function saveQueue(queue: QueuedRsvp[]) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(queue));
  } catch {
    console.error("Failed to save rsvp queue");
  }
}

export function queueRsvp(rsvp: Omit<QueuedRsvp, "id" | "queuedAt" | "retryCount">): QueuedRsvp {
  const queue = getQueuedRsvps();
  // De-dupe: replace any pending rsvp for the same (event, child/player or self)
  const filtered = queue.filter(
    (r) =>
      !(
        r.eventId === rsvp.eventId &&
        r.userId === rsvp.userId &&
        (r.childId || null) === (rsvp.childId || null) &&
        (r.miniLeaguePlayerId || null) === (rsvp.miniLeaguePlayerId || null)
      )
  );
  const queued: QueuedRsvp = {
    ...rsvp,
    id: `qrsvp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    queuedAt: new Date().toISOString(),
    retryCount: 0,
  };
  filtered.push(queued);
  saveQueue(filtered);
  return queued;
}

export function getQueuedRsvpsForEvent(eventId: string): QueuedRsvp[] {
  return getQueuedRsvps().filter((r) => r.eventId === eventId);
}

async function sendQueuedRsvp(r: QueuedRsvp): Promise<boolean> {
  try {
    if (r.existingRsvpId) {
      const { error } = await supabase
        .from("rsvps")
        .update({ status: r.status, notes: r.notes ?? null, source: "user" })
        .eq("id", r.existingRsvpId);
      if (error) {
        // If row no longer exists, fall through to insert
        if ((error as any).code !== "PGRST116") {
          console.error("rsvp update failed", error);
          return false;
        }
      } else {
        return true;
      }
    }

    const { error } = await supabase.from("rsvps").insert({
      event_id: r.eventId,
      user_id: r.userId,
      child_id: r.childId ?? null,
      mini_league_player_id: r.miniLeaguePlayerId ?? null,
      status: r.status,
      notes: r.notes ?? null,
      source: "user",
    });
    if (error) {
      console.error("rsvp insert failed", error);
      return false;
    }
    return true;
  } catch (e) {
    console.error("rsvp send error", e);
    return false;
  }
}

let syncInFlight: Promise<{ synced: number; failed: number }> | null = null;

export async function syncQueuedRsvps(): Promise<{ synced: number; failed: number }> {
  if (syncInFlight) return syncInFlight;

  const run = async (): Promise<{ synced: number; failed: number }> => {
    const snapshot = getQueuedRsvps();
    if (snapshot.length === 0) return { synced: 0, failed: 0 };

    let synced = 0;
    let failed = 0;
    // Track outcome per snapshot entry id
    const results = new Map<string, { success: boolean; retryCount: number }>();

    for (const r of snapshot) {
      const ok = await sendQueuedRsvp(r);
      if (ok) {
        synced++;
        results.set(r.id, { success: true, retryCount: r.retryCount });
      } else {
        const nextRetry = r.retryCount + 1;
        if (nextRetry >= MAX_RETRIES) {
          failed++;
        }
        results.set(r.id, { success: false, retryCount: nextRetry });
      }
    }

    // Re-read the current queue: it may contain entries added or replaced during sync
    const currentQueue = getQueuedRsvps();
    const snapshotIds = new Set(snapshot.map((entry) => entry.id));

    const merged = currentQueue.flatMap((current) => {
      // Entry added or replaced during sync: preserve unchanged
      if (!snapshotIds.has(current.id)) {
        return [current];
      }
      const result = results.get(current.id);
      // Shouldn't happen, but preserve if no result
      if (!result) return [current];
      // Successfully synced: remove
      if (result.success) return [];
      // Exhausted retries: drop
      if (result.retryCount >= MAX_RETRIES) return [];
      // Keep with updated retry count
      return [{ ...current, retryCount: result.retryCount }];
    });

    saveQueue(merged);
    return { synced, failed };
  };

  syncInFlight = run().finally(() => {
    syncInFlight = null;
  });
  return syncInFlight;
}

export function getQueuedRsvpCount(): number {
  return getQueuedRsvps().length;
}
