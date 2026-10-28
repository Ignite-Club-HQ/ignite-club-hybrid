import { pruneCachedPhotosForClubs, pruneStoredClubKeys } from './deviceMediaCache';
/** Caller's clubs/teams read from each club's own group (Group 1 clubs from the
 * original services, newer groups from theirs), all at once. One slow or
 * refusing club never empties the list: its row is simply missing and
 * `failed` says so, so callers can show what loaded. Everything failing throws
 * so cached data is kept instead of an empty page. */
import type { FeatureBackendContext } from './featureRouter';
import { readMembershipInScope } from './membershipRouting';
import { getLiveMyRoleGrants } from './features/membership';
import { getLiveClubProfile } from './features/club';

export type Settled<T> = { values: T[]; failed: number };

/** Progress is display-only; only complete results may replace saved inventories. */
export function completeClubRows<T>(result: Settled<T>): T[] {
  if (result.failed) throw new Error('Some clubs could not be loaded; please try again.');
  return result.values;
}

/** Promise.allSettled that keeps successes; throws only when every item failed. */
export async function settleAll<T>(items: readonly Promise<T>[]): Promise<Settled<T>> {
  const results = await Promise.allSettled(items);
  const values: T[] = []; let failed = 0; let firstError: unknown;
  for (const r of results) {
    if (r.status === 'fulfilled') values.push(r.value);
    else { failed++; firstError ??= r.reason; }
  }
  if (items.length > 0 && values.length === 0) throw firstError instanceof Error ? firstError : new Error(String(firstError));
  return { values, failed };
}

type Grant = { club?: [] | [string]; club_id?: unknown; team?: [] | [string]; team_id?: unknown };
export const grantClubId = (g: Grant): string | null =>
  (g.club?.[0] ?? (Array.isArray(g.club_id) ? g.club_id[0] : g.club_id) ?? null) as string | null;
export const grantTeamId = (g: Grant): string | null =>
  (g.team?.[0] ?? (Array.isArray(g.team_id) ? g.team_id[0] : null) ?? null) as string | null;

export type LiveClubRow = Awaited<ReturnType<typeof getLiveClubProfile>>[number];

/** Active (not deleted) club profiles for the given ids, each from its own group. */
/** `onProgress` receives the active clubs loaded so far (in request order)
 * each time another club arrives, so pages can render before the slowest
 * group answers. The returned value is still the complete settled result. */
export async function readClubsInOwnGroups(
  ctx: FeatureBackendContext,
  clubIds: readonly string[],
  onProgress?: (loaded: LiveClubRow[]) => void,
): Promise<Settled<LiveClubRow>> {
  const ids = [...new Set(clubIds)];
  if (ids.length === 0) return { values: [], failed: 0 };
  const isActive = (c: LiveClubRow | undefined): c is LiveClubRow => !!c && !c.deleted_at_ms?.length;
  const slots: (LiveClubRow | undefined)[] = new Array(ids.length);
  const settled = await settleAll(ids.map((id, i) =>
    readMembershipInScope(ctx, { clubId: id }, scoped => getLiveClubProfile(scoped, id)).then(rows => {
      slots[i] = rows[0];
      if (onProgress && isActive(rows[0])) {
        try { onProgress(slots.filter(isActive)); } catch { /* render hook must not fail the read */ }
      }
      return rows;
    })));
  return { values: settled.values.map(rows => rows[0]).filter(isActive), failed: settled.failed };
}

/** All the caller's active clubs across every group. */
export async function listMyClubsAcrossGroups(ctx: FeatureBackendContext): Promise<Settled<LiveClubRow>> {
  const grants = (await getLiveMyRoleGrants(ctx)) as unknown as Grant[];
  const clubIds = grants.map(grantClubId).filter((c): c is string => !!c);
  // Removal cleanup: drop saved club keys for clubs this sign-in no longer
  // belongs to, so a removed member's device stops opening that club's names/photos.
  pruneStoredClubKeys(ctx.identity.getPrincipal().toText(), clubIds);
  void pruneCachedPhotosForClubs(ctx.identity.getPrincipal().toText(), clubIds);
  return readClubsInOwnGroups(ctx, clubIds);
}
