import { onlineManager } from "@tanstack/react-query";

/**
 * Distinguishes "the network is down / Supabase unreachable" from "this session is
 * genuinely dead".
 *
 * The resume recovery path in `useAuth` used to treat ANY failed `refreshSession()`
 * as unrecoverable: it cleared the React Query cache and set `user = null`. Offline
 * (or flaky-coverage) resumes therefore produced a local pseudo-sign-out — the club
 * switcher disappeared, the theme reverted to Ignite, and nothing restored it when
 * coverage came back because no further recovery pass ran.
 */
export function isTransientAuthFailure(error: unknown): boolean {
  if (!onlineManager.isOnline()) return true;
  if (!error) return false;

  const err = error as { name?: string; code?: string; status?: number; message?: string };
  if (err.name === "AuthRetryableFetchError") return true;
  if (err.name === "TypeError" && /fetch/i.test(err.message ?? "")) return true;
  if (err.code === "network_error" || err.code === "request_timeout") return true;
  // Supabase surfaces unreachable-network auth errors with status 0 (or 5xx gateways).
  if (err.status === 0 || (typeof err.status === "number" && err.status >= 500)) return true;

  const message = (err.message ?? "").toLowerCase();
  return (
    message.includes("failed to fetch") ||
    message.includes("network request failed") ||
    message.includes("networkerror") ||
    message.includes("load failed") ||
    message.includes("timeout") ||
    message.includes("offline")
  );
}
