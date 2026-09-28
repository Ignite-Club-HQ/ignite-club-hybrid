import type { QueryClient } from "@tanstack/react-query";

/**
 * Club-switch cache purge.
 *
 * `useClubScopeGuard` bounces the user off routes owned by another club, but the
 * React Query cache is a second, quieter leak: every list surface (home, inbox,
 * schedule, vault, teams, media, leaderboard…) keeps the *previous* club's rows
 * cached and paints them instantly after the switch, sometimes for minutes
 * (staleTime) and always for at least one frame.
 *
 * When the user changes the active club filter we therefore drop the cached data
 * for everything that is not explicitly global/user-scoped. Active queries
 * refetch immediately, so the user sees skeletons then the new club's data —
 * never club A's content under club B's chrome.
 */

/**
 * Query-key prefixes that are NOT club-scoped and must survive a switch:
 * identity, theme catalogue, global app settings and device/user preferences.
 * Everything else is treated as potentially club-scoped and purged.
 */
const GLOBAL_KEY_PREFIXES: readonly string[] = [
  "auth",
  "session",
  "user",
  "profile",
  "my-profile",
  "current-user",
  "user-roles",
  "user-clubs",
  "club-themes",
  "available-club-themes",
  "app-settings",
  "app_settings",
  "notification-preferences",
  "legal-terms",
  "terms",
  "feature-flags",
  "subscription",
  "pro-access",
  "children",
  "my-children",
];

function isGlobalKey(key: readonly unknown[]): boolean {
  const head = key[0];
  if (typeof head !== "string") return false;
  return GLOBAL_KEY_PREFIXES.some((p) => head === p || head.startsWith(p + "-") || head.startsWith(p + "_"));
}

export function purgeClubScopedQueryCache(queryClient: QueryClient) {
  const cache = queryClient.getQueryCache();
  for (const query of cache.getAll()) {
    if (isGlobalKey(query.queryKey as readonly unknown[])) continue;
    // Remove cached data outright: inactive queries are dropped, active ones
    // remount into a loading state and refetch for the newly selected club.
    cache.remove(query);
  }
  // Anything that survived removal (in-flight/active) is marked stale so it
  // cannot serve club A's payload once it settles.
  void queryClient.invalidateQueries({ refetchType: "active" });
}
