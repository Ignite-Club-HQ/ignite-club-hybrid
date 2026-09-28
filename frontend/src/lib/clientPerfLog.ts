/**
 * Client-side performance logging for slow Supabase reads.
 *
 * Writes rows to public.client_perf_log when a PostgREST GET takes longer
 * than SLOW_THRESHOLD_MS (or is aborted by the 15s timeout). Best-effort:
 * uses `sendBeacon` when available so it never blocks render. Failures
 * are swallowed — we never want logging to break the actual UX.
 *
 * Read by app admins via the Supabase dashboard / future internal page to
 * see *which* queries are timing out, on *which* networks, for *which*
 * users — replacing guesswork with evidence.
 */

const SLOW_THRESHOLD_MS = 5_000;

// Local throttle so we don't spam the table from a single bad session
// (one user on dropping wifi could otherwise log hundreds of rows/min).
// Bumped from 2s → 10s so the table reflects distinct incidents, not bursts.
const LOCAL_RATE_LIMIT_MS = 10_000;
let lastLogAt = 0;

let cachedUserId: string | null = null;
export function setClientPerfUserId(userId: string | null) {
  cachedUserId = userId;
}

interface PerfEntry {
  query_name: string;
  duration_ms: number;
  status: number | null;
  aborted: boolean;
  network_type: string | null;
  online: boolean;
  url_path: string | null;
  user_id: string | null;
  ua: string | null;
}

function getNetworkType(): string | null {
  try {
    const c = (navigator as any).connection || (navigator as any).mozConnection || (navigator as any).webkitConnection;
    if (!c) return null;
    return c.effectiveType || c.type || null;
  } catch {
    return null;
  }
}

/**
 * Extract a coarse query name from a PostgREST URL so we can group rows.
 * Strips query params and the /rest/v1/ prefix. Example:
 *   https://reference.invalid → "events"
 */
function deriveQueryName(url: string): { name: string; path: string | null } {
  try {
    const u = new URL(url);
    const path = u.pathname;
    const m = path.match(/\/rest\/v1\/([^/?]+)/);
    return { name: m?.[1] || path, path };
  } catch {
    return { name: url.slice(0, 60), path: null };
  }
}

export function maybeLogSlowFetch(opts: {
  url: string;
  durationMs: number;
  status: number | null;
  aborted: boolean;
}) {
  try {
    if (!opts.aborted && opts.durationMs < SLOW_THRESHOLD_MS) return;
    // Skip lifecycle noise: if the tab is backgrounded/hidden when the
    // request finishes, the "duration" is mostly time the JS event loop
    // was paused by the OS (Android Doze / iOS background). These rows
    // dominate the slow-query log without representing real DB slowness.
    if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
    // Skip known-benign aborts: if the device is offline at completion,
    // the abort is just "user lost signal", not a DB performance issue.
    if (opts.aborted && typeof navigator !== "undefined" && navigator.onLine === false) return;
    const now = Date.now();
    if (now - lastLogAt < LOCAL_RATE_LIMIT_MS) return;
    lastLogAt = now;

    const { name, path } = deriveQueryName(opts.url);
    const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const anonKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "";
    if (!supabaseUrl || !anonKey) return;

    const entry: PerfEntry = {
      query_name: name,
      duration_ms: Math.round(opts.durationMs),
      status: opts.status,
      aborted: opts.aborted,
      network_type: getNetworkType(),
      online: typeof navigator !== "undefined" ? navigator.onLine : true,
      url_path: path,
      user_id: cachedUserId,
      ua: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 200) : null,
    };

    const endpoint = `${supabaseUrl}/rest/v1/client_perf_log`;
    const body = JSON.stringify(entry);

    // Try sendBeacon first (won't block, survives page unload).
    if (typeof navigator !== "undefined" && navigator.sendBeacon) {
      // sendBeacon can't set custom headers; PostgREST requires apikey.
      // Fall through to fetch when we need auth headers.
    }

    // Fire-and-forget fetch with anon key (RLS permits authenticated inserts only).
    fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: `Bearer ${getAccessToken() || anonKey}`,
        Prefer: "return=minimal",
      },
      body,
      keepalive: true,
    }).catch(() => { /* swallow */ });
  } catch {
    /* swallow */
  }
}

function getAccessToken(): string | null {
  try {
    // Supabase persists the session under sb-<ref>-auth-token in localStorage.
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-") && k.endsWith("-auth-token")) {
        const raw = localStorage.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        return parsed?.access_token || parsed?.currentSession?.access_token || null;
      }
    }
  } catch { /* ignore */ }
  return null;
}

export const CLIENT_PERF_SLOW_MS = SLOW_THRESHOLD_MS;
