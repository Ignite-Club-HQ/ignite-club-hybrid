import { useEffect, useRef, useCallback } from "react";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

// Generate a unique session ID per browser session
const SESSION_ID = `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

// Map route patterns to labels
function getPageLabel(path: string): string {
  if (path === "/" || path === "") return "Home";
  if (path.startsWith("/events/new")) return "Create Event";
  if (path.startsWith("/events/")) return "Event Detail";
  if (path === "/events") return "Events";
  if (path.startsWith("/teams/") && path.endsWith("/edit")) return "Edit Team";
  if (path.startsWith("/teams/") && path.endsWith("/upgrade")) return "Upgrade";
  if (path.startsWith("/teams/")) return "Team Detail";
  if (path === "/messages") return "Messages";
  if (path.startsWith("/messages/")) return "Chat";
  if (path.startsWith("/clubs/") && path.endsWith("/edit")) return "Edit Club";
  if (path.startsWith("/clubs/")) return "Club Detail";
  if (path === "/profile") return "Profile";
  if (path === "/settings") return "Settings";
  if (path.startsWith("/admin")) return "Admin";
  if (path.startsWith("/media")) return "Media";
  if (path.startsWith("/mini-leagues")) return "Mini Leagues";
  if (path.startsWith("/join")) return "Join";
  return path.split("/").filter(Boolean)[0] || "Unknown";
}

// Extract club_id from path if possible (e.g., /clubs/:id)
function extractClubIdFromPath(path: string): string | null {
  const clubMatch = path.match(/\/clubs\/([a-f0-9-]{36})/);
  return clubMatch?.[1] || null;
}

// Debounce window before we actually log a page view. If the user navigates
// away within this window we skip the insert entirely. Prevents flurries of
// inserts during rapid back/forward or programmatic redirects.
const ROUTE_DEBOUNCE_MS = 600;

// Module-level flag so concurrent hook instances (StrictMode double-mount,
// duplicate provider) don't both insert.
let inflightInsert = false;

// Backoff after RLS / auth failure — once we hit a 401/403/RLS error we
// pause all activity tracking inserts for this window to stop the loop
// that floods the connection pool.
let suppressUntil = 0;
const SUPPRESS_AFTER_AUTH_ERROR_MS = 60_000;

/**
 * Tracks user page views and active time.
 * Inserts a row when the user navigates to a page, then updates duration on leave.
 */
export function useActivityTracking() {
  const { user } = useAuth();
  const location = useLocation();
  const activeLogIdRef = useRef<string | null>(null);
  const startTimeRef = useRef<number>(Date.now());
  const flushIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flushDuration = useCallback(async () => {
    if (!activeLogIdRef.current) return;
    if (Date.now() < suppressUntil) return;
    const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
    if (elapsed < 1) return;

    // Only update if we still have a live session.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session) return;

    try {
      await (supabase as any).rpc("update_user_activity_duration", {
        _activity_log_id: activeLogIdRef.current,
        _duration_seconds: elapsed,
      });
    } catch {
      // Silently fail - activity tracking is non-critical
    }
  }, []);

  const startTracking = useCallback(async (path: string) => {
    if (!user) return;
    if (inflightInsert) return;
    if (Date.now() < suppressUntil) return;

    // Critical: confirm the JWT is still present before inserting. React
    // state can lag the auth state during sign-out / refresh failure;
    // inserting without a session triggers an RLS violation which retries
    // on every route change and exhausts the connection pool.
    const { data: sessionData } = await supabase.auth.getSession();
    if (!sessionData.session || sessionData.session.user.id !== user.id) {
      return;
    }

    inflightInsert = true;

    // Flush previous
    await flushDuration();

    const clubId = extractClubIdFromPath(path);
    startTimeRef.current = Date.now();

    try {
      const { data, error } = await (supabase as any).rpc("track_user_activity_start", {
        _page_path: path,
        _page_label: getPageLabel(path),
        _session_id: SESSION_ID,
        _club_id: clubId,
      });

      if (error) {
        // RLS / auth errors mean the session is no longer valid for
        // writes. Pause inserts for a minute so we don't keep retrying
        // on every route change.
        const code = (error as any)?.code;
        const status = (error as any)?.status;
        const msg = (error as any)?.message ?? "";
        if (
          code === "42501" ||
          code === "PGRST301" ||
          status === 401 ||
          status === 403 ||
          msg.includes("row-level security")
        ) {
          suppressUntil = Date.now() + SUPPRESS_AFTER_AUTH_ERROR_MS;
        }
      } else {
        activeLogIdRef.current = (data as string | null) || null;
      }
    } catch {
      // Silently fail
    } finally {
      inflightInsert = false;
    }
  }, [user, flushDuration]);

  // Track page changes (debounced)
  useEffect(() => {
    if (!user) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(() => {
      startTracking(location.pathname);
    }, ROUTE_DEBOUNCE_MS);

    // Periodically flush duration every 30s for long-lived pages
    flushIntervalRef.current = setInterval(flushDuration, 30_000);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (flushIntervalRef.current) {
        clearInterval(flushIntervalRef.current);
      }
      flushDuration();
    };
  }, [location.pathname, user?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cache the current access token so the unload handler (which can't await)
  // has a fresh JWT to send. Without the user's JWT, the PATCH runs as the
  // anon role and trips the RLS update policy, flooding postgres logs with
  // "new row violates row-level security policy" errors.
  const accessTokenRef = useRef<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    supabase.auth.getSession().then(({ data }) => {
      if (!cancelled) accessTokenRef.current = data.session?.access_token ?? null;
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      accessTokenRef.current = session?.access_token ?? null;
    });
    return () => {
      cancelled = true;
      sub.subscription.unsubscribe();
    };
  }, []);

  // Flush on visibility change (tab switch, app background)
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === "hidden") {
        flushDuration();
      }
    };

    const handleBeforeUnload = () => {
      // Use fetch with keepalive for reliable delivery during page unload
      // (sendBeacon only supports POST, but we need PATCH)
      if (!activeLogIdRef.current) return;
      const token = accessTokenRef.current;
      // No JWT → skip. An anon PATCH would always fail RLS and just spam logs.
      if (!token) return;
      if (Date.now() < suppressUntil) return;

      const elapsed = Math.round((Date.now() - startTimeRef.current) / 1000);
      if (elapsed < 1) return;

      try {
        fetch(
          `${import.meta.env.VITE_SUPABASE_URL}/rest/v1/rpc/update_user_activity_duration`,
          {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'apikey': import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
              'Authorization': `Bearer ${token}`,
              'Prefer': 'return=minimal',
            },
            body: JSON.stringify({
              _activity_log_id: activeLogIdRef.current,
              _duration_seconds: elapsed,
            }),
            keepalive: true,
          }
        ).catch(() => {});
      } catch {
        // Silently fail - activity tracking is non-critical
      }
    };

    document.addEventListener("visibilitychange", handleVisibility);
    window.addEventListener("beforeunload", handleBeforeUnload);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibility);
      window.removeEventListener("beforeunload", handleBeforeUnload);
    };
  }, [flushDuration]);
}
