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
 * Drop ambiguous club-list data, but retain account inventories and explicitly
 * event-ID-scoped Next Up reads. Home filters its authorized inventory locally;
 * a presentation switch must not restart every identity/membership/event read.
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

// Next Up queries carry an exact event ID (and caller where relevant). Their
// consumers mount only for events selected from Home's filtered inventory.
const NEXT_UP_EVENT_KEYS = new Set([
  "child-rsvps-card",
  "children-for-event",
  "event-rsvp-summary",
  "event-rsvps-going",
  "event-rsvps",
]);

export function purgeClubScopedQueryCache(queryClient: QueryClient) {
  const cache = queryClient.getQueryCache();
  for (const query of cache.getAll()) {
    if (isGlobalKey(query.queryKey as readonly unknown[])) continue;
    if (NEXT_UP_EVENT_KEYS.has(String(query.queryKey[0])) && typeof query.queryKey[1] === "string") continue;
    // Remove cached data outright: inactive queries are dropped, active ones
    // remount into a loading state and refetch for the newly selected club.
    cache.remove(query);
  }
  // Do not invalidate surviving account/global/event-ID queries: their keys
  // are independent of the club filter. Event mutations and membership changes
  // retain their own invalidation paths; switching clubs is not a data change.
}
