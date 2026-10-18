import { describe, it, expect, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
import { GROUP_DOMAINS } from './groupRouting';
import { openGroupSession, type GroupRegistry, type GroupSessionTransport } from './groupSession';

function fixture() {
  const ctx = { identity: { getPrincipal: () => ({ toText: () => 'person' }) }, target: {
    alias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet', provider: 'icp',
    deploymentClass: 'public_subnet', canisterIds: {},
  } } as unknown as FeatureBackendContext;
  const deployment: GroupRegistry['deployment'] = { id: 'ic', alias: 'mainnet', networkKind: 'public_mainnet', host: 'https://icp-api.io', revision: 1n,
    enabled: true, additionalSubnetsEnabled: false, primarySubnet: 's1', approvedSubnets: ['s1'] };
  const groups = ['a', 'b'].map(id => ({ id, targetAlias: 'mainnet', domains: GROUP_DOMAINS.map((domain, i) => ({ domain, canisterId: `${id}-${i}-cai` })) }));
  const registry: GroupRegistry = { revision: 2n, deployment, groups, bindings: groups.map(g => ({ groupId: g.id, deploymentId: 'ic', deploymentRevision: 1n, domains: g.domains.map(d => ({ ...d, subnetId: 's1' })) })) };
  const assignments = [{ clubId: 'club-a', groupId: 'a', revision: 1n }, { clubId: 'host-b', groupId: 'b', revision: 2n }];
  const inGroupA = (c: FeatureBackendContext) => c.target.canisterIds.club_domain.startsWith('a-');
  const transport: GroupSessionTransport = {
    readRegistry: vi.fn(async () => structuredClone(registry)),
    readMemberships: vi.fn(async c => ({ clubs: inGroupA(c) ? ['club-a'] : [], next: null, aclRevision: 1n })),
    readAssignments: vi.fn(async ids => assignments.filter(a => ids.includes(a.clubId))),
    readHostedAssignment: vi.fn(async id => { const a = assignments.find(x => x.clubId === id); if (!a) throw new Error('Missing club assignment'); return a; }),
  };
  return { ctx, registry, transport, inGroupA };
}

describe('cross-group reads', () => {
  it('reads a competition hosted by a club in another group from the host group only', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    expect(s.clubIds).toEqual(['club-a']);
    const seen = await s.readHosted('host-b', 'competition_domain', async ctx => ctx.target.canisterIds.competition_domain);
    expect(seen.startsWith('b-')).toBe(true);
  });

  it('never lets a hosted lookup unlock writes to that club', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    await s.readHosted('host-b', 'competition_domain', async () => 1);
    await expect(s.writeClub('host-b', 'competition_domain', 'k1', async () => 1)).rejects.toThrow('outside discovered membership');
  });

  it('rejects a hosted assignment naming an unknown group or a newer revision', async () => {
    for (const bad of [{ groupId: 'zzz', revision: 1n }, { groupId: 'b', revision: 9n }, { clubId: 'other', groupId: 'b', revision: 1n }]) {
      const f = fixture();
      f.transport.readHostedAssignment = vi.fn(async id => ({ clubId: id, ...bad }));
      const s = await openGroupSession(f.ctx, f.transport);
      await expect(s.readHosted('host-b', 'competition_domain', async () => 1)).rejects.toThrow('Foreign or stale');
    }
  });

  it('stops hosted reads when the group registry changed', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    f.registry.revision = 3n;
    await expect(s.readHosted('host-b', 'competition_domain', async () => 1)).rejects.toThrow('registry changed');
  });

  it('fans out to every group and requires every group to answer', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    const rows = await s.readEveryGroup('competition_domain', async ctx => [ctx.target.canisterIds.competition_domain[0]]);
    expect(rows).toEqual(['a', 'b']);
    await expect(s.readEveryGroup('competition_domain', async ctx => { if (!f.inGroupA(ctx)) throw new Error('down'); return [1]; })).rejects.toThrow('down');
    await expect(s.readEveryGroup('competition_domain', async () => [1, 2, 3], 5)).rejects.toThrow('row budget');
  });
});

describe('indexed membership discovery', () => {
  it('uses the faster pager with ascending, contiguous pages', async () => {
    const f = fixture();
    f.transport.readMembershipsIndexed = vi.fn(async (c, after) => {
      if (!f.inGroupA(c)) return { clubs: [], next: null, aclRevision: 1n };
      return after === null ? { clubs: ['club-a'], next: 'club-a', aclRevision: 1n } : { clubs: [], next: null, aclRevision: 1n };
    });
    const s = await openGroupSession(f.ctx, f.transport);
    expect(s.clubIds).toEqual(['club-a']);
    expect(f.transport.readMemberships).not.toHaveBeenCalled();
  });

  it('falls back to the scan pager for app-wide accounts', async () => {
    const f = fixture();
    f.transport.readMembershipsIndexed = vi.fn(async () => { throw new Error('Use read_my_club_memberships for app-wide accounts'); });
    const s = await openGroupSession(f.ctx, f.transport);
    expect(s.clubIds).toEqual(['club-a']);
    expect(f.transport.readMemberships).toHaveBeenCalledTimes(2);
  });

  it('rejects out-of-order, repeated or mismatched cursor pages', async () => {
    const pages = [
      { clubs: ['z', 'a'], next: null },
      { clubs: ['a'], next: 'b' },
    ];
    for (const p of pages) {
      const f = fixture();
      f.transport.readMembershipsIndexed = vi.fn(async () => ({ ...p, aclRevision: 1n }));
      await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('Invalid or changing membership page');
    }
  });

  it('does not hide other indexed errors behind the scan pager', async () => {
    const f = fixture();
    f.transport.readMembershipsIndexed = vi.fn(async () => { throw new Error('Authentication required'); });
    await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('Authentication required');
    expect(f.transport.readMemberships).not.toHaveBeenCalled();
  });
});
