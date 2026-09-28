import type { QueryClient } from "@tanstack/react-query";
import { clearAdTierHints } from "@/lib/adTierHint";

/**
 * Entitlement query keys that must be refreshed whenever a club/team gains or
 * loses Pro access (promo code redemption, IAP purchase, admin override).
 *
 * Historically the upgrade pages only invalidated `club-subscription` /
 * `team-subscription`, so the HomePage Pro gates (`user-has-pro-access`,
 * `reward-clubs-home`), the ad/sponsor carousel gates
 * (`user-pro-status-per-club`, `user-has-active-sponsors`) and the shared hooks
 * (`club-pro-access`, `user-has-any-club-pro`) kept serving their cached "Free"
 * answer — the "Pro Only" rewards lock and "Upgrade to Pro" ad stayed on screen
 * for minutes after a successful promo upgrade (until each 60s–5min staleTime
 * lapsed).
 *
 * Prefix-matching invalidation is used deliberately: these keys embed userId,
 * club filter and membership arrays, so exact-key invalidation is unreliable.
 * `refetchType: "all"` is required so queries belonging to unmounted screens
 * (the home page while the user is on the upgrade page) refetch immediately
 * instead of lingering as stale-but-cached data.
 */
export const PRO_ACCESS_QUERY_KEY_PREFIXES = [
  "user-has-pro-access",
  "user-has-any-club-pro",
  "club-pro-access",
  "reward-clubs-home",
  "upgradable-clubs",
  "upgradable-teams",
  // Subscription rows themselves (page-level gates).
  "club-subscription",
  "club-subscription-for-team",
  "team-subscription",
  // Ad / sponsor tier gates — these decide whether the "Upgrade to Pro" ad
  // renders on Home, Inbox and Events.
  "user-pro-status-per-club",
  "user-has-active-sponsors",
  "events-sponsor-strip-allowed",
  "app-ad-settings",
  // Vault + settings Pro gates.
  "vault-club-has-pro",
  "vault-team-has-pro",
  "pro-access-info",
] as const;

export function invalidateProAccessQueries(queryClient: QueryClient) {
  // Drop the persisted first-paint ad-tier hint so the next render can't
  // re-show the free-tier upgrade ad from localStorage.
  clearAdTierHints();

  for (const prefix of PRO_ACCESS_QUERY_KEY_PREFIXES) {
    queryClient.invalidateQueries({ queryKey: [prefix], refetchType: "all" });
  }
}
