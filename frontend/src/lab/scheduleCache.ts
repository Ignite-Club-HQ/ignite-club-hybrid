// Lightweight offline cache for events lists and event details.
// Stores per user/filter combo so each user sees their own scoped data when offline.
//
// All keys are user-id namespaced so a shared device can never serve one user's
// cached events to another, even if `clearUserScopedCaches()` hasn't run yet
// (e.g. brief window before SIGNED_OUT fires).
//
// Adapted unchanged from the bundle/baseline source as a direct dependency of
// `eventCacheRefresh`. Pure localStorage housekeeping — no Supabase/ICP edge.

const EVENTS_LIST_PREFIX = 'ignite_events_list_';
const EVENT_DETAIL_PREFIX = 'ignite_event_detail_';
const EVENT_RSVPS_PREFIX = 'ignite_event_rsvps_';
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;

interface Entry<T> {
  data: T;
  timestamp: number;
}

function safeGet<T>(key: string): T | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const entry: Entry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > EXPIRY_MS) {
      try { localStorage.removeItem(key); } catch { /* noop */ }
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

function safeSet<T>(key: string, data: T): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const entry: Entry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(key, JSON.stringify(entry));
  } catch {
    // quota or unavailable - ignore
  }
}

function userScope(userId: string | undefined | null): string {
  return userId && userId.length > 0 ? userId : 'anon';
}

// ---- Events list ----
// scopeKey already encodes filter/team/club; we additionally namespace by
// userId so cross-user reads on a shared device are impossible.
export function getCachedEventsList(scopeKey: string, userId?: string | null): unknown[] | null {
  return safeGet<unknown[]>(`${EVENTS_LIST_PREFIX}${userScope(userId)}_${scopeKey}`);
}

export function cacheEventsList(scopeKey: string, events: unknown[], userId?: string | null): void {
  // Cap at 100 events to stay light
  safeSet(`${EVENTS_LIST_PREFIX}${userScope(userId)}_${scopeKey}`, events.slice(0, 100));
}

// ---- Event detail ----
export function getCachedEventDetail(eventId: string, userId?: string | null): unknown | null {
  return safeGet<unknown>(`${EVENT_DETAIL_PREFIX}${userScope(userId)}_${eventId}`);
}

export function cacheEventDetail(eventId: string, event: unknown, userId?: string | null): void {
  safeSet(`${EVENT_DETAIL_PREFIX}${userScope(userId)}_${eventId}`, event);
}

// ---- Event RSVPs ----
export function getCachedEventRsvps(eventId: string, userId?: string | null): unknown[] | null {
  return safeGet<unknown[]>(`${EVENT_RSVPS_PREFIX}${userScope(userId)}_${eventId}`);
}

export function cacheEventRsvps(eventId: string, rsvps: unknown[], userId?: string | null): void {
  safeSet(`${EVENT_RSVPS_PREFIX}${userScope(userId)}_${eventId}`, rsvps);
}

/**
 * Remove deleted events from the persisted schedule cache.
 *
 * React Query caches are in-memory, so purging them alone is not enough: the
 * list view falls back to `getCachedEventsList` on offline/error and on the
 * next cold open, which would repaint a row the server has already deleted.
 * Scans every list entry (all users/filter scopes on this device) plus the
 * per-event detail and RSVP entries.
 */
export function purgeEventsFromScheduleCache(deletedIds: string[]): void {
  const ids = new Set(deletedIds.filter(Boolean));
  if (ids.size === 0) return;
  try {
    if (typeof localStorage === 'undefined') return;

    const listKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (key && key.startsWith(EVENTS_LIST_PREFIX)) listKeys.push(key);
    }

    for (const key of listKeys) {
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const entry = JSON.parse(raw) as Entry<unknown[]>;
        if (!Array.isArray(entry?.data)) continue;
        const next = entry.data.filter(
          (row: any) =>
            !(row && typeof row === 'object' && typeof row.id === 'string' && ids.has(row.id)),
        );
        if (next.length !== entry.data.length) {
          // Preserve the original timestamp so purging never extends the TTL.
          localStorage.setItem(key, JSON.stringify({ data: next, timestamp: entry.timestamp }));
        }
      } catch {
        // Corrupt entry - drop it rather than leave a deleted event behind.
        try { localStorage.removeItem(key); } catch { /* noop */ }
      }
    }

    for (const id of ids) {
      for (let i = 0; i < localStorage.length; i += 1) {
        const key = localStorage.key(i);
        if (!key) continue;
        if (
          (key.startsWith(EVENT_DETAIL_PREFIX) || key.startsWith(EVENT_RSVPS_PREFIX)) &&
          key.endsWith(`_${id}`)
        ) {
          try { localStorage.removeItem(key); } catch { /* noop */ }
          i -= 1; // localStorage indices shift after a removal
        }
      }
    }
  } catch {
    // never let cache maintenance break a successful deletion
  }
}

/**
 * Drop every persisted events-list snapshot for one user (all filter/team/club
 * scope keys). Used after a create/edit/cancel/delete so the Schedule page
 * cannot fall back to a list that predates the mutation.
 */
export function clearCachedEventsLists(userId?: string | null): void {
  try {
    if (typeof localStorage === 'undefined') return;
    const prefix = `${EVENTS_LIST_PREFIX}${userScope(userId)}_`;
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i);
      if (k && k.startsWith(prefix)) toRemove.push(k);
    }
    for (const k of toRemove) {
      try { localStorage.removeItem(k); } catch { /* noop */ }
    }
  } catch {
    // never let cache maintenance break a successful mutation
  }
}
