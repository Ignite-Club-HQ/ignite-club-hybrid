// Lightweight localStorage hydration for the home page "Next Up" carousel.
// Mirrors the myTeamsCarouselCache pattern so cold opens (or returns to home
// after the React Query gcTime has elapsed) render real event cards instantly
// instead of flashing the skeleton while the consolidated memberships+events
// query refetches. Keyed by user id only — active club filter is applied at
// render time from `allEvents`, so a single snapshot covers every filter.

const PREFIX = "ignite_next_up_events_";
const TTL_MS = 24 * 60 * 60 * 1000; // 24h — stale entries are still useful as a placeholder

interface Entry<T> {
  data: T;
  timestamp: number;
}

function key(userId: string): string {
  return `${PREFIX}${userId}`;
}

export function getCachedNextUp<T>(userId: string | undefined): T | null {
  if (!userId) return null;
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(key(userId));
    if (!raw) return null;
    const entry: Entry<T> = JSON.parse(raw);
    if (Date.now() - entry.timestamp > TTL_MS) {
      try { localStorage.removeItem(key(userId)); } catch {}
      return null;
    }
    return entry.data;
  } catch {
    return null;
  }
}

export function setCachedNextUp<T>(userId: string | undefined, data: T): void {
  if (!userId) return;
  try {
    if (typeof localStorage === "undefined") return;
    const entry: Entry<T> = { data, timestamp: Date.now() };
    localStorage.setItem(key(userId), JSON.stringify(entry));
  } catch {
    // quota or unavailable — ignore
  }
}

/**
 * Drop the persisted Next Up snapshot for a user. Called after an event is
 * created / edited / cancelled / deleted so a cold open (which hydrates from
 * this snapshot via `initialData`) can never repaint a stale carousel that is
 * missing the just-created event.
 */
export function clearCachedNextUp(userId: string | undefined): void {
  if (!userId) return;
  try {
    if (typeof localStorage === "undefined") return;
    localStorage.removeItem(key(userId));
  } catch {
    // unavailable — ignore
  }
}
