// Persists a lightweight "which ad tier does this user see at this location"
// hint per (location, user, clubFilter) tuple. Used so that on cold load the
// SponsorOrAdCarousel can render the correct ad component immediately, in
// parallel with the rest of the page, instead of waiting for pro-status /
// settings queries to resolve (which caused free-club ads to visibly render
// noticeably after every other component on the page).
//
// Values:
//   "free-ads"      → free-tier club, show <AppAdCarousel>
//   "pro-sponsors"  → pro club with sponsor banners
//   "pro-none"      → pro club with no sponsors → no ad
//   "none"          → nothing should render
//   null            → unknown (first ever visit)

export type AdTierHint = "free-ads" | "pro-sponsors" | "pro-none" | "none";

const PREFIX = "ignite_ad_tier_";

const key = (
  location: string,
  userId: string | undefined,
  clubId: string | null | undefined,
) => `${PREFIX}${location}_${userId || "anon"}_${clubId || "none"}`;

export function readAdTierHint(
  location: string,
  userId: string | undefined,
  clubId: string | null | undefined,
): AdTierHint | null {
  try {
    const raw = localStorage.getItem(key(location, userId, clubId));
    if (
      raw === "free-ads" ||
      raw === "pro-sponsors" ||
      raw === "pro-none" ||
      raw === "none"
    ) {
      return raw;
    }
    return null;
  } catch {
    return null;
  }
}

export function writeAdTierHint(
  location: string,
  userId: string | undefined,
  clubId: string | null | undefined,
  tier: AdTierHint,
): void {
  try {
    localStorage.setItem(key(location, userId, clubId), tier);
  } catch {
    /* noop */
  }
}

/**
 * Removes every persisted ad-tier hint. Called on entitlement changes
 * (upgrade / promo redemption) so a stale "free-ads" hint can't paint the
 * upgrade ad on the next render after the club has become Pro.
 */
export function clearAdTierHints(): void {
  try {
    const keys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX)) keys.push(k);
    }
    keys.forEach((k) => localStorage.removeItem(k));
  } catch {
    /* noop */
  }
}
