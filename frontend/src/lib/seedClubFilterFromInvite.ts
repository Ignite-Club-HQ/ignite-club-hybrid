/**
 * Seeds the user's active club filter (theme) from an invite they just accepted.
 *
 * Rules:
 *  - Only seeds when there is NO existing user preference for this user
 *    (localStorage key absent OR holds the "no club" sentinel that was
 *    auto-written on signup with no prior choice).
 *  - Never overrides an explicit user choice (a real club id stored locally).
 *  - Delegates the actual write to `setActiveClubTheme` from `useClubTheme`,
 *    which updates state, localStorage, and `profiles.active_club_theme_id`
 *    atomically — so cross-device sync works on first load elsewhere.
 *
 * This is considered a USER-DRIVEN action (the user clicked "Accept invite"
 * or signed up via an invite link), so it does not violate the rule that
 * the club filter must never change on its own.
 */
const STORAGE_KEY_PREFIX = "ignite-club-theme-";
const NO_CLUB_THEME_SENTINEL = "__ignite_no_club__";

export interface SeedClubFilterOptions {
  /** When true, ALSO override an existing sentinel. Defaults to true. */
  overrideSentinel?: boolean;
}

export function seedClubFilterFromInvite(
  userId: string | null | undefined,
  clubId: string | null | undefined,
  setActiveClubTheme: (clubId: string | null) => void,
  options: SeedClubFilterOptions = {},
): boolean {
  if (!userId || !clubId) return false;
  if (typeof window === "undefined") return false;

  const { overrideSentinel = true } = options;

  try {
    const key = `${STORAGE_KEY_PREFIX}${userId}`;
    const current = localStorage.getItem(key);

    const isUnset = current === null;
    const isSentinel = current === NO_CLUB_THEME_SENTINEL;

    // If the user already explicitly picked a real club, never override it.
    if (!isUnset && !(overrideSentinel && isSentinel)) {
      return false;
    }

    setActiveClubTheme(clubId);
    return true;
  } catch (e) {
    console.warn("[seedClubFilterFromInvite] Failed:", e);
    return false;
  }
}
