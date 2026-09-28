/**
 * Cross-hook hint so `useClubTheme` can skip its own `profiles.active_club_theme_id`
 * round-trip when `useAuth.fetchProfile` already retrieved the value during the
 * SIGNED_IN gate. Removes one blocking DB RTT from cold-login home render.
 *
 * The hint is in-memory only, scoped to a single user id and a freshness window
 * (10s). Outside that window `useClubTheme` falls back to its DB fetch, so
 * cross-device sync remains intact.
 */

interface Hint {
  userId: string;
  value: string | null; // active_club_theme_id (nullable column)
  fetchedAt: number;
}

const HINT_TTL_MS = 10_000;
let hint: Hint | null = null;

export function setAuthThemeHint(userId: string, value: string | null): void {
  hint = { userId, value, fetchedAt: Date.now() };
}

export function consumeAuthThemeHint(userId: string): { value: string | null } | null {
  if (!hint) return null;
  if (hint.userId !== userId) return null;
  if (Date.now() - hint.fetchedAt > HINT_TTL_MS) {
    hint = null;
    return null;
  }
  const snapshot = { value: hint.value };
  // Single-use to avoid masking later cross-device updates.
  hint = null;
  return snapshot;
}

export function clearAuthThemeHint(): void {
  hint = null;
}
