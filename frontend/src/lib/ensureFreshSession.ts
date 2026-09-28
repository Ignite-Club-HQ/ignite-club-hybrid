import { supabase } from "@/integrations/supabase/client";
import { refreshSessionOnce } from "@/lib/refreshSessionOnce";

/**
 * Ensures the Supabase session is valid before performing an authenticated
 * mutation. If the access token has expired (or expires within `bufferSeconds`),
 * it refreshes the session.
 *
 * Returns the resolved user id, or throws if no session can be established.
 *
 * This protects against the race condition where a stale/expired token causes
 * RLS to evaluate `auth.uid()` as NULL, which then makes inserts/updates fail
 * with "new row violates row-level security" or 401/403 errors.
 */
export async function ensureFreshSession(bufferSeconds = 30): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession();

  if (!session) {
    throw new Error("Not authenticated");
  }

  const expiresAt = session.expires_at ?? 0;
  const nowSec = Math.floor(Date.now() / 1000);

  if (expiresAt - nowSec <= bufferSeconds) {
    // ALWAYS bound the refresh — including when the document is hidden.
    // A refresh started while backgrounded on Android can hang forever on a
    // half-dead socket, and every query gated on it (has-pro-access on Media,
    // user-memberships on Schedule) then spins until a force-quit. Bounding
    // only while visible was exactly the hole. On timeout we degrade to the
    // existing session id and let downstream requests 401 naturally; the
    // global auth-retry interceptor (supabaseAuthRetry.ts) triggers a fresh
    // refresh cycle on the retry.
    const REFRESH_TIMEOUT_MS = 12_000;

    // Single-flight (see refreshSessionOnce.ts): concurrent refreshes would
    // replay an already-rotated refresh token and trigger a spurious
    // SIGNED_OUT.
    const { session: refreshed, error } = await refreshSessionOnce(REFRESH_TIMEOUT_MS);

    if (!refreshed) {
      if (error) throw error;
      // Timed out — return existing user id. The stale token may still be
      // valid for ~30s of buffer, and if it isn't the caller's request
      // will 401 and be retried after a fresh refresh.
      return session.user.id;
    }
    if (error) throw error;
    return refreshed.user.id;
  }

  return session.user.id;
}

/**
 * Returns true if a Supabase error looks like an auth/RLS failure that may be
 * resolved by refreshing the session.
 */
export function isAuthLikeError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; status?: number; message?: string };
  if (e.status === 401 || e.status === 403) return true;
  if (e.code === "PGRST301" || e.code === "42501") return true;
  const msg = (e.message || "").toLowerCase();
  return (
    msg.includes("jwt") ||
    msg.includes("session") ||
    msg.includes("row-level security") ||
    msg.includes("not authenticated")
  );
}
