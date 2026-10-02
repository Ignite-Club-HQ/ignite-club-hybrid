/**
 * The signed-in user's club memberships (club ids), used by backend routing
 * to apply per-club backend overrides (`clubBackendOverrides` in the routing
 * config). Populated after sign-in by `ClubBackendEnforcement`; empty before
 * auth completes, in which case routing falls back to the cached club
 * backend hint (see `backendRouting.ts`).
 *
 * Deliberately Supabase-free so it can sit on the live-config import path
 * (same module-cycle rule as `userCountry.ts` / `backendRouting.ts`).
 */

let memberClubIds: string[] = [];

export function setUserClubIds(ids: readonly string[]): void {
  memberClubIds = [...new Set(ids)];
}

export function getUserClubIds(): readonly string[] {
  return memberClubIds;
}

export function clearUserClubIds(): void {
  memberClubIds = [];
}
