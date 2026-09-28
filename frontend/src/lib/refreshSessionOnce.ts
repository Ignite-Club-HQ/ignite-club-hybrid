import { supabase } from "@/integrations/supabase/client";
import type { Session } from "@supabase/supabase-js";

/**
 * Single-flight wrapper around `supabase.auth.refreshSession()`.
 *
 * Why this exists
 * ---------------
 * Three independent code paths can trigger a token refresh at the same time:
 *   1. supabase-js `autoRefreshToken` timer
 *   2. `supabaseAuthRetry.ts` (401/403 -> refresh + retry the request)
 *   3. `reactQueryNativeAdapter` / visibility + resume recovery hooks
 *
 * Refresh tokens are single-use (rotation is enabled). The first refresh wins
 * and rotates the token; any concurrent refresh then presents an
 * already-rotated token, fails, and supabase-js fires `SIGNED_OUT` — the user
 * is dumped to the login screen or every page goes empty, despite the session
 * being perfectly valid.
 *
 * This module funnels every refresh through one in-flight promise. Concurrent
 * callers await the same result. A failure caused by a stale/rotated refresh
 * token is treated as BENIGN: the winning refresh already applied a new
 * session, so we return that session instead of surfacing an auth error.
 * Only a rejection of the CURRENT refresh token is a genuine auth failure.
 */

export interface RefreshOnceResult {
  session: Session | null;
  error: Error | null;
  /** True when this call awaited an already in-flight refresh. */
  shared: boolean;
  /**
   * True when the underlying refresh failed with a rotated/stale-token error
   * but a valid session is still present — callers must NOT sign out.
   */
  benign: boolean;
}

let inFlight: Promise<RefreshOnceResult> | null = null;

/** Error shapes Supabase returns when the presented refresh token was already rotated. */
export function isStaleRefreshTokenError(err: unknown): boolean {
  if (!err) return false;
  const e = err as { message?: string; code?: string; status?: number };
  const code = (e.code || "").toLowerCase();
  if (code === "refresh_token_already_used" || code === "refresh_token_not_found") return true;
  const msg = (e.message || "").toLowerCase();
  return (
    msg.includes("already used") ||
    msg.includes("refresh token not found") ||
    msg.includes("invalid refresh token") ||
    msg.includes("refresh_token_already_used") ||
    msg.includes("refresh token revoked")
  );
}

async function performRefresh(): Promise<RefreshOnceResult> {
  try {
    const { data, error } = await supabase.auth.refreshSession();
    if (!error && data?.session) {
      return { session: data.session, error: null, shared: false, benign: false };
    }

    // Refresh failed. If a valid session is nonetheless present, another
    // refresh (in this tab or the supabase-js timer) already rotated the token
    // successfully — this failure is a replay of the old token, not a real
    // auth rejection.
    const { data: current } = await supabase.auth.getSession();
    const session = current?.session ?? null;
    if (session && (isStaleRefreshTokenError(error) || !error)) {
      return { session, error: null, shared: false, benign: true };
    }
    return {
      session,
      error: (error as Error) ?? new Error("Session refresh failed"),
      shared: false,
      benign: false,
    };
  } catch (err) {
    const { data: current } = await supabase.auth.getSession().catch(() => ({ data: { session: null } } as any));
    const session = current?.session ?? null;
    if (session && isStaleRefreshTokenError(err)) {
      return { session, error: null, shared: false, benign: true };
    }
    return { session, error: err as Error, shared: false, benign: false };
  }
}

/**
 * Refresh the Supabase session at most once concurrently.
 *
 * @param timeoutMs Optional bound. On timeout the caller gets the current
 *   session (possibly stale) with `error: null` so downstream requests can
 *   401 naturally and be retried, instead of hanging forever on a half-dead
 *   socket after Android Doze / iOS suspension.
 */
export async function refreshSessionOnce(timeoutMs?: number): Promise<RefreshOnceResult> {
  const shared = inFlight !== null;
  if (!inFlight) {
    inFlight = performRefresh().finally(() => {
      inFlight = null;
    });
  }
  const pending = inFlight;

  if (!timeoutMs) {
    const res = await pending;
    return shared ? { ...res, shared: true } : res;
  }

  const raced = await Promise.race([
    pending,
    new Promise<null>((resolve) => setTimeout(() => resolve(null), timeoutMs)),
  ]);

  if (raced) return shared ? { ...raced, shared: true } : raced;

  const { data } = await supabase.auth.getSession().catch(() => ({ data: { session: null } } as any));
  return { session: data?.session ?? null, error: null, shared, benign: true };
}

/** Test helper — clears any in-flight refresh. */
export function __resetRefreshSessionOnce() {
  inFlight = null;
}
