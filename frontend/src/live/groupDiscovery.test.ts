import { describe, it, expect } from 'vitest';
import { GROUP_DOMAINS, type GroupRoutingTable, type GroupDescriptor } from './groupRouting';
import { discoverMemberships, type GroupPage } from './groupDiscovery';
const group = (id: string): GroupDescriptor => ({ id, targetAlias: 'mainnet', domains: GROUP_DOMAINS.map((domain, i) => ({ domain, canisterId: `${id}-${i}-cai` })) });
const table = (): GroupRoutingTable => ({ groups: new Map([['a', group('a')], ['b', group('b')]]), assignments: new Map([['c1', { clubId: 'c1', groupId: 'a', revision: 1n }], ['c2', { clubId: 'c2', groupId: 'b', revision: 1n }], ['c3', { clubId: 'c3', groupId: 'a', revision: 1n }]]) });
const m = (clubId: string, accountId = 'p1', role = 'member') => ({ clubId, accountId, role });

describe('cross-group membership discovery', () => {
  it('merges linked accounts across groups and pages to completion', async () => {
    const pages: Record<string, GroupPage[]> = { a: [{ memberships: [m('c1')], nextCursor: 'x' }, { memberships: [m('c3', 'p2')], nextCursor: null }], b: [{ memberships: [m('c2', 'p2')], nextCursor: null }] };
    const read = async (g: string) => pages[g].shift()!;
    const first = await discoverMemberships(table(), 'mainnet', ['p1', 'p2'], null, 10, read);
    expect(first.memberships).toEqual([m('c1'), m('c2', 'p2')]);
    expect(first.cursor).toEqual({ a: 'x', b: null });
    const second = await discoverMemberships(table(), 'mainnet', ['p1', 'p2'], first.cursor, 10, read);
    expect(second.memberships).toEqual([m('c3', 'p2')]);
    expect(second.cursor).toBeNull();
  });
  it('fails closed when one group fails, claims a foreign club or another account', async () => {
    await expect(discoverMemberships(table(), 'mainnet', ['p1'], null, 10, async g => { if (g === 'b') throw new Error('down'); return { memberships: [], nextCursor: null }; })).rejects.toThrow();
    await expect(discoverMemberships(table(), 'mainnet', ['p1'], null, 10, async g => ({ memberships: g === 'a' ? [m('c2')] : [], nextCursor: null }))).rejects.toThrow('does not own');
    await expect(discoverMemberships(table(), 'mainnet', ['p1'], null, 10, async g => ({ memberships: g === 'a' ? [m('c1', 'p9')] : [], nextCursor: null }))).rejects.toThrow('another account');
  });
  it('rejects anonymous callers, bad page sizes, oversized pages and stale cursors', async () => {
    const empty = async () => ({ memberships: [], nextCursor: null });
    await expect(discoverMemberships(table(), 'mainnet', ['2vxsx-fae'], null, 10, empty)).rejects.toThrow();
    await expect(discoverMemberships(table(), 'mainnet', ['p1'], null, 101, empty)).rejects.toThrow();
    await expect(discoverMemberships(table(), 'mainnet', ['p1'], null, 1, async () => ({ memberships: [m('c1'), m('c3')], nextCursor: null }))).rejects.toThrow('oversized');
    await expect(discoverMemberships(table(), 'mainnet', ['p1'], { gone: 'x' }, 10, empty)).rejects.toThrow('Stale');
  });
  it('ignores groups of another deployment', async () => {
    const t = table(); t.groups.set('eu', { ...group('eu'), targetAlias: 'eu-engine' });
    const asked: string[] = [];
    await discoverMemberships(t, 'mainnet', ['p1'], null, 10, async g => { asked.push(g); return { memberships: [], nextCursor: null }; });
    expect(asked.sort()).toEqual(['a', 'b']);
  });
});
