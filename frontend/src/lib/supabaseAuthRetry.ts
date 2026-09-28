/**
 * Global fetch interceptor for Supabase requests.
 *
 * Two concerns, one wrapper:
 *
 * 1. AUTH RETRY — retries Supabase data/storage requests once after refreshing
 *    the session when they fail with 401 / JWT-expired. On iOS WKWebView and
 *    inside iframed previews, the supabase-js `autoRefreshToken` timer can be
 *    throttled or its localStorage write can be blocked, so the access token
 *    can lapse mid-session. Without this guard the stale token causes RLS-
 *    scoped pages (Schedule, Media, Pro checks) to either silently render
 *    empty or display a generic "couldn't verify" error.
 *
 * 2. READ TIMEOUT — aborts PostgREST GETs that hang past REST_GET_TIMEOUT_MS
 *    so a dead socket on flaky mobile networks fails fast (and React Query
 *    can retry via cache fallback) instead of stalling for ~60s until the
 *    browser's own timeout kicks in. ONLY applied to PostgREST GETs:
 *    - storage uploads, edge functions, mutations, and auth endpoints are
 *      left untouched so we never abort a slow upload or long-running call.
 *
 * Triggered only for requests to the Supabase REST/storage/functions hosts —
 * never wraps unrelated fetches (auth/token endpoint included so we don't
 * recurse).
 */

const REST_GET_TIMEOUT_MS = 25_000;

/**
 * How often we sweep the in-flight registry looking for GETs whose wall-clock
 * deadline has passed. Cheap: the set is normally empty or tiny.
 */
const SWEEP_INTERVAL_MS = 5_000;

import { supabase } from "@/integrations/supabase/client";
import { maybeLogSlowFetch } from "@/lib/clientPerfLog";
import { refreshSessionOnce } from "@/lib/refreshSessionOnce";

/**
 * Registry of in-flight PostgREST GETs.
 *
 * `setTimeout` is not a reliable abort mechanism on Android WebView: timers are
 * frozen while the app is backgrounded, so a GET that was in flight at suspend
 * never times out. It stays pending forever on a dead socket, holds one of the
 * ~6 per-origin connection slots, and any query gated on it never resolves —
 * which is why Schedule/Media came back stuck on skeletons until a force-quit.
 *
 * We therefore also track a wall-clock `deadlineAt` per request and sweep the
 * registry (interval + explicitly on resume), so frozen timers can't hide a
 * dead request.
 */
type InFlightRestGet = { controller: AbortController; deadlineAt: number; url: string };
const inFlightRestGets = new Set<InFlightRestGet>();
let sweepTimer: ReturnType<typeof setInterval> | null = null;

function abortEntry(entry: InFlightRestGet, reason: string) {
  inFlightRestGets.delete(entry);
  try { entry.controller.abort(); } catch { /* ignore */ }
  if (import.meta.env.DEV) {
    console.warn(`[supabaseAuthRetry] aborted stale REST GET (${reason}):`, entry.url);
  }
}

/** Abort any in-flight PostgREST GET whose wall-clock deadline has passed. */
export function abortStaleRestGets(reason = "sweep"): number {
  const now = Date.now();
  let aborted = 0;
  for (const entry of Array.from(inFlightRestGets)) {
    if (entry.deadlineAt <= now) {
      abortEntry(entry, reason);
      aborted++;
    }
  }
  return aborted;
}

/**
 * Abort every in-flight PostgREST GET regardless of deadline.
 *
 * Called on resume after a long background stint: those sockets are almost
 * certainly dead, and releasing them BEFORE the recovery refetch means the
 * refetch isn't queued behind zombies for the connection pool.
 */
export function abortAllInFlightRestGets(reason = "resume"): number {
  const count = inFlightRestGets.size;
  for (const entry of Array.from(inFlightRestGets)) {
    abortEntry(entry, reason);
  }
  return count;
}

/** Test/diagnostic helper. */
export function getInFlightRestGetCount(): number {
  return inFlightRestGets.size;
}

function ensureSweeper() {
  if (sweepTimer !== null) return;
  if (typeof setInterval !== "function") return;
  sweepTimer = setInterval(() => {
    if (inFlightRestGets.size > 0) abortStaleRestGets("sweep");
  }, SWEEP_INTERVAL_MS);
}

let installed = false;

function getSupabaseUrl(): string {
  try {
    const clientUrl = (supabase as unknown as { supabaseUrl?: unknown }).supabaseUrl;
    if (typeof clientUrl === "string" && clientUrl.trim() !== "") {
      return clientUrl.replace(/\/$/, "");
    }
  } catch {
    // The isolated product build uses a fail-closed Supabase proxy.
  }

  return (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
}

export function installSupabaseAuthRetry() {
  if (installed) return;
  if (typeof window === "undefined" || typeof window.fetch !== "function") return;

  const supabaseUrl = getSupabaseUrl();
  if (!supabaseUrl) return;

  const origFetch = window.fetch.bind(window);
  installed = true;

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    let url = "";
    try {
      url = typeof input === "string"
        ? input
        : input instanceof URL ? input.toString() : (input as Request).url;
    } catch {
      return origFetch(input, init);
    }

    const isSupabase = url.startsWith(supabaseUrl);
    // Skip the auth endpoints themselves to avoid recursion when refreshing.
    const isAuthEndpoint = isSupabase && url.includes("/auth/v1/");

    if (!isSupabase || isAuthEndpoint) {
      return origFetch(input, init);
    }

    // --- READ TIMEOUT ---
    // Apply an abort timeout to PostgREST GETs only. We never want to abort
    // storage uploads, edge function calls (some are intentionally long-
    // running), or write/RPC requests where retrying mid-flight could
    // duplicate side effects.
    const method = (init?.method || (input instanceof Request ? input.method : "GET") || "GET").toUpperCase();
    const isRestGet = method === "GET" && url.includes("/rest/v1/");

    let timeoutInit = init;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    let registryEntry: InFlightRestGet | null = null;
    if (isRestGet) {
      const controller = new AbortController();
      // If caller already passed a signal, chain it so their abort still works.
      const callerSignal = init?.signal ?? (input instanceof Request ? input.signal : undefined);
      if (callerSignal) {
        if (callerSignal.aborted) controller.abort();
        else callerSignal.addEventListener("abort", () => controller.abort(), { once: true });
      }
      // Foreground fast path: a plain timer. Backed up by the wall-clock
      // registry sweep below for the case where the timer is frozen.
      timeoutId = setTimeout(() => {
        try { controller.abort(); } catch { /* ignore */ }
      }, REST_GET_TIMEOUT_MS);
      registryEntry = { controller, deadlineAt: Date.now() + REST_GET_TIMEOUT_MS, url };
      inFlightRestGets.add(registryEntry);
      ensureSweeper();
      timeoutInit = { ...(init || {}), signal: controller.signal };
    }

    const cleanupRestGet = () => {
      if (timeoutId !== null) { clearTimeout(timeoutId); timeoutId = null; }
      if (registryEntry) { inFlightRestGets.delete(registryEntry); registryEntry = null; }
    };

    let response: Response;
    const startedAt = isRestGet ? performance.now() : 0;
    try {
      response = await origFetch(input, timeoutInit);
    } catch (err) {
      cleanupRestGet();
      if (isRestGet) {
        const aborted = (err as any)?.name === "AbortError";
        maybeLogSlowFetch({ url, durationMs: performance.now() - startedAt, status: null, aborted });
      }
      // Nudge the native adapter to re-check connectivity and kick errored
      // queries. Android WebView often skips the `networkStatusChange`
      // callback on brief drops, so observed fetch failures are our most
      // reliable signal that the network state may have changed. Safe on
      // web (nudge is undefined) and safe for auth-shaped errors (which
      // don't throw — they return a 401 response).
      try { (window as any).__igniteNudgeNetworkCheck?.("supabase-fetch-throw"); } catch { /* noop */ }
      throw err;
    }
    cleanupRestGet();
    if (isRestGet) {
      maybeLogSlowFetch({ url, durationMs: performance.now() - startedAt, status: response.status, aborted: false });
    }

    // Only retry once on auth-shaped failures.
    if (response.status !== 401 && response.status !== 403) {
      return response;
    }

    // Confirm it's an auth failure (PostgREST returns 403 for plenty of
    // legitimate RLS denials we should NOT retry). Inspect a clone so the
    // caller still gets the original body if we end up returning it.
    let isAuthShaped = response.status === 401;
    if (response.status === 403) {

      try {
        const clone = response.clone();
        const text = await clone.text();
        const lower = text.toLowerCase();
        if (
          lower.includes("jwt") ||
          lower.includes("invalid token") ||
          lower.includes("token is expired") ||
          lower.includes("pgrst301")
        ) {
          isAuthShaped = true;
        }
      } catch {
        // ignore
      }
    }
    if (!isAuthShaped) return response;

    try {
      // Time-box the refresh. On a half-dead socket after Android Doze /
      // iOS suspension this promise can hang forever, and every queryFn
      // that hit a 401 hangs behind it — the page stays "loading" with no
      // error and the app looks frozen. 10s then fall through.
      //
      // Single-flight: concurrent 401s must NOT each fire their own refresh —
      // refresh tokens are single-use, so the losers would replay a rotated
      // token and trigger a spurious SIGNED_OUT.
      const { session, error } = await refreshSessionOnce(10000);
      if (error || !session) return response;
      const data = { session };


      // Rebuild the request with the fresh token. Supabase-js sets the
      // Authorization header on its own internal fetch — for storage/PostgREST
      // those calls go through us. Replace any Authorization header that
      // matches the old access token.
      const newToken = data.session.access_token;
      const newHeaders = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
      const existingAuth = newHeaders.get("authorization");
      if (existingAuth && /^bearer\s+/i.test(existingAuth)) {
        newHeaders.set("authorization", `Bearer ${newToken}`);
      }

      const retryInit: RequestInit = { ...(init || {}), headers: newHeaders };
      return await origFetch(typeof input === "string" || input instanceof URL ? input : input.url, retryInit);
    } catch {
      return response;
    }
  };
}
