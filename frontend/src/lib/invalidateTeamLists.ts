import type { QueryClient } from "@tanstack/react-query";

const CAROUSEL_PREFIX = "ignite_my_teams_carousel_v2_";

/**
 * Query key prefixes that feed "my teams" style lists (home carousel, inbox
 * team rows, bottom nav badges). Anything derived from the caller's team
 * membership belongs here.
 */
const TEAM_LIST_KEY_PREFIXES = [
  "my-teams-premium-v2",
  "team-next-events-premium",
  "team-photos-premium",
  "team-photo-counts-premium-new",
  "team-competitions-premium-v3",
  "team-members-premium",
  "user-roles",
  "my-teams",
  "club-teams",
  "teams",
];

/** Drop the localStorage carousel snapshots for a user (all club filters). */
export function clearMyTeamsCarouselCache(userId?: string | null): void {
  try {
    if (typeof localStorage === "undefined") return;
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith(CAROUSEL_PREFIX)) continue;
      if (userId && !k.startsWith(`${CAROUSEL_PREFIX}${userId}_`)) continue;
      doomed.push(k);
    }
    doomed.forEach(k => localStorage.removeItem(k));
  } catch {
    // storage unavailable — ignore
  }
}

/**
 * Called after a team/class is created, joined, or deleted so the home
 * carousel and every derived list repaint immediately instead of waiting for
 * a stale-time expiry or a cold relaunch.
 *
 * `refetchType: "all"` is required: the carousel is usually unmounted at the
 * moment of creation, and the default ("active") would leave it stale.
 */
export async function invalidateTeamLists(
  queryClient: QueryClient,
  userId?: string | null,
): Promise<void> {
  clearMyTeamsCarouselCache(userId);
  await Promise.all(
    TEAM_LIST_KEY_PREFIXES.map(prefix =>
      queryClient.invalidateQueries({ queryKey: [prefix], refetchType: "all" }),
    ),
  );
}
