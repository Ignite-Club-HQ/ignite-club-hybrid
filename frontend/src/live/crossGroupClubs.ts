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
export async function readClubsInOwnGroups(ctx: FeatureBackendContext, clubIds: readonly string[]): Promise<Settled<LiveClubRow>> {
  const ids = [...new Set(clubIds)];
  if (ids.length === 0) return { values: [], failed: 0 };
  const settled = await settleAll(ids.map(id => readMembershipInScope(ctx, { clubId: id }, scoped => getLiveClubProfile(scoped, id))));
  return { values: settled.values.map(rows => rows[0]).filter((c): c is LiveClubRow => !!c && !c.deleted_at_ms?.length), failed: settled.failed };
}

/** All the caller's active clubs across every group. */
export async function listMyClubsAcrossGroups(ctx: FeatureBackendContext): Promise<Settled<LiveClubRow>> {
  const grants = (await getLiveMyRoleGrants(ctx)) as unknown as Grant[];
  return readClubsInOwnGroups(ctx, grants.map(grantClubId).filter((c): c is string => !!c));
}
