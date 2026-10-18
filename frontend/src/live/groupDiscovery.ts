/** Cross-group membership discovery (plan stage 3). Pure; not wired to production.
 * Every group answers only for clubs it is authoritatively assigned; a group
 * claiming another group's club, a failed group or an over-bounded registry
 * fails the whole page closed — never partial discovery. Destinations still
 * authorize the caller; this only merges their answers.
 */
import type { GroupRoutingTable } from './groupRouting';

export const MAX_DISCOVERY_GROUPS = 64;
export const MAX_DISCOVERY_PAGE = 100;

export type DiscoveredMembership = { clubId: string; role: string; accountId: string };
export type GroupPage = { memberships: readonly DiscoveredMembership[]; nextCursor: string | null };
export type DiscoveryCursor = Readonly<Record<string, string | null>>;

export async function discoverMemberships(
  table: GroupRoutingTable,
  targetAlias: string,
  accounts: readonly string[],
  cursor: DiscoveryCursor | null,
  limit: number,
  read: (groupId: string, accounts: readonly string[], cursor: string | null, limit: number) => Promise<GroupPage>,
): Promise<{ memberships: DiscoveredMembership[]; cursor: DiscoveryCursor | null }> {
  const ids = [...new Set(accounts)].filter(a => a && a !== '2vxsx-fae');
  if (!ids.length || ids.length !== accounts.length) throw new Error('Authenticated, distinct linked accounts required');
  if (!Number.isInteger(limit) || limit < 1 || limit > MAX_DISCOVERY_PAGE) throw new Error('Invalid page size');
  const groups = [...table.groups.values()].filter(g => g.targetAlias === targetAlias).map(g => g.id).sort();
  if (groups.length > MAX_DISCOVERY_GROUPS) throw new Error('Group registry exceeds discovery bound');
  if (cursor && Object.keys(cursor).some(id => !groups.includes(id))) throw new Error('Stale discovery cursor');
  const pending = groups.filter(id => !cursor || (id in cursor && cursor[id] !== null) || !(id in cursor));
  const pages = await Promise.all(pending.map(async id => {
    const page = await read(id, ids, cursor?.[id] ?? null, limit);
    if (page.memberships.length > limit) throw new Error('Group returned an oversized page');
    for (const m of page.memberships) {
      if (table.assignments.get(m.clubId)?.groupId !== id) throw new Error('Group answered for a club it does not own');
      if (!ids.includes(m.accountId)) throw new Error('Group returned another account');
    }
    return [id, page] as const;
  }));
  const next: Record<string, string | null> = { ...(cursor ?? {}) };
  const seen = new Set<string>();
  const memberships: DiscoveredMembership[] = [];
  for (const [id, page] of pages) {
    next[id] = page.nextCursor;
    for (const m of page.memberships) {
      const key = `${m.clubId}\u0000${m.accountId}\u0000${m.role}`;
      if (!seen.has(key)) { seen.add(key); memberships.push(m); }
    }
  }
  memberships.sort((a, b) => a.clubId.localeCompare(b.clubId) || a.accountId.localeCompare(b.accountId) || a.role.localeCompare(b.role));
  const done = groups.every(id => next[id] === null);
  return { memberships, cursor: done ? null : next };
}
