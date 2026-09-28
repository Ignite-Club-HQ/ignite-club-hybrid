import { onlineManager } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Empty-success poisoning guard for the club/theme list queries.
 *
 * After a period without coverage, PostgREST reads can come back 200-with-zero-rows
 * (degraded auth context, RLS evaluating with a stale/absent JWT) instead of failing.
 * React Query treats that as a legitimate success, so `keepPreviousData` does NOT
 * protect the caller: the good cached list is replaced by `[]`, the club switcher
 * collapses to "All Clubs", and the club theme is evicted — permanently, because the
 * cache that would have restored it is gone.
 *
 * Rule: an empty result is only accepted as truth when we can prove the read happened
 * under a healthy, non-expired session while online. Otherwise we throw so React Query
 * keeps the previous data and retries (including on reconnect).
 */

export class TransientEmptyClubListError extends Error {
  constructor(cacheKey: string) {
    super(`Club list came back empty under a degraded session (${cacheKey}) — keeping cached list`);
    this.name = "TransientEmptyClubListError";
  }
}

/** Keys that have produced at least one non-empty result in this app session. */
const hadDataKeys = new Set<string>();

export function resetClubListEmptyGuard() {
  hadDataKeys.clear();
}

export async function guardClubListResult<T>(cacheKey: string, next: T[]): Promise<T[]> {
  if (next.length > 0) {
    hadDataKeys.add(cacheKey);
    return next;
  }

  // Never had data for this user/key — an empty list is plausible (new user).
  if (!hadDataKeys.has(cacheKey)) return next;

  if (!onlineManager.isOnline()) throw new TransientEmptyClubListError(cacheKey);

  try {
    const { data, error } = await supabase.auth.getSession();
    const session = data?.session;
    if (error || !session) throw new TransientEmptyClubListError(cacheKey);
    const expiresAtMs = (session.expires_at ?? 0) * 1000;
    if (expiresAtMs && expiresAtMs <= Date.now()) throw new TransientEmptyClubListError(cacheKey);
  } catch (e) {
    if (e instanceof TransientEmptyClubListError) throw e;
    // Could not verify session health (offline fetch, storage error) — assume transient.
    throw new TransientEmptyClubListError(cacheKey);
  }

  // Verified healthy session and the server really says "no clubs".
  hadDataKeys.delete(cacheKey);
  return next;
}
