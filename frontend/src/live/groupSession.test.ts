import { describe, it, expect, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
import { GROUP_DOMAINS } from './groupRouting';
import { openGroupSession, type GroupRegistry, type GroupSessionTransport } from './groupSession';

function fixture() {
  const ctx = { identity: { getPrincipal: () => ({ toText: () => 'person' }) }, target: {
    alias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet', provider: 'icp',
    deploymentClass: 'public_subnet', canisterIds: { identity_access: 'global-cai' },
  } } as unknown as FeatureBackendContext;
  const deployment: GroupRegistry['deployment'] = { id: 'ic', alias: 'mainnet', networkKind: 'public_mainnet', host: 'https://icp-api.io', revision: 1n,
    enabled: true, additionalSubnetsEnabled: false, primarySubnet: 's1', approvedSubnets: ['s1'] };
  const groups = ['a', 'b'].map(id => ({ id, targetAlias: 'mainnet', domains: GROUP_DOMAINS.map((domain, i) => ({ domain, canisterId: `${id}-${i}-cai` })) }));
  const registry: GroupRegistry = { revision: 2n, deployment, groups, bindings: groups.map(g => ({ groupId: g.id, deploymentId: 'ic', deploymentRevision: 1n, domains: g.domains.map(d => ({ ...d, subnetId: 's1' })) })) };
  const assignments = [{ clubId: 'club-a', groupId: 'a', revision: 1n }, { clubId: 'club-b', groupId: 'b', revision: 2n }];
  const transport: GroupSessionTransport = {
    readRegistry: vi.fn(async () => structuredClone(registry)),
    readMemberships: vi.fn(async c => ({ clubs: c.target.canisterIds.club_domain.startsWith('a-') ? ['club-a'] : ['club-b'], next: null, aclRevision: 1n })),
    readAssignments: vi.fn(async ids => assignments.filter(a => ids.includes(a.clubId))),
  };
  return { ctx, registry, assignments, transport };
}
describe('integrated deployment-bound group read session', () => {
  it('creates once only after an exact original-creator placement read at the current revision', async () => {
    const f = fixture(); const placement = { clubId: 'new-test-club', groupId: 'b', revision: 2n };
    f.transport.readNewClubPlacement = vi.fn(async () => placement);
    const s = await openGroupSession(f.ctx, f.transport); const create = vi.fn(async ctx => ctx.target.canisterIds.club_domain);
    expect(await s.createInGroup(placement, 'club_domain', create)).toBe('b-0-cai');
    expect(f.transport.readNewClubPlacement).toHaveBeenCalledWith('new-test-club', 2n);
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('stale, foreign or missing creator proof cannot run a create', async () => {
    for (const kind of ['missing', 'foreign', 'stale', 'registry']) {
      const f = fixture(); const placement = { clubId: 'new-test-club', groupId: 'b', revision: 2n };
      if (kind !== 'missing') f.transport.readNewClubPlacement = async () => {
        if (kind === 'registry') f.registry.revision++;
        return { ...placement, groupId: kind === 'foreign' ? 'a' : 'b', revision: kind === 'stale' ? 1n : 2n };
      };
      const s = await openGroupSession(f.ctx, f.transport); const create = vi.fn();
      await expect(s.createInGroup(placement, 'club_domain', create)).rejects.toThrow();
      expect(create).not.toHaveBeenCalled();
    }
  });
  it('a lost creation reply is not automatically retried', async () => {
    const f = fixture(); const placement = { clubId: 'new-test-club', groupId: 'b', revision: 2n };
    f.transport.readNewClubPlacement = async () => placement;
    const s = await openGroupSession(f.ctx, f.transport); const create = vi.fn(async () => { throw new Error('reply lost'); });
    await expect(s.createInGroup(placement, 'club_domain', create)).rejects.toThrow('reply lost');
    expect(create).toHaveBeenCalledTimes(1);
  });
  it('rejects same-revision authority substitution during deletion inventory validation', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    f.registry.groups[1].domains[0].canisterId = 'replacement-cai';
    await expect(s.assertRegistryUnchanged()).rejects.toThrow('registry changed');
  });
  it('rejects a registry change while all-group discovery replies are in flight', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    await expect(s.readEveryGroup('club_domain', async () => {
      f.registry.revision += 1n; return [];
    })).rejects.toThrow('registry changed');
  });
  it('discovers both groups then routes each full group context preserving duplicates and order', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    expect(s.clubIds).toEqual(['club-a', 'club-b']);
    const calls: string[][] = [];
    const rows = await s.readClubs(['club-b', 'club-a', 'club-b'], 'events_domain', async (ctx, ids) => {
      calls.push([...ids]);
      expect(ctx.target.canisterIds.identity_access).toBe('global-cai');
      const prefix = ctx.target.canisterIds.club_domain.split('-')[0];
      expect(ctx.target.canisterIds.events_domain.startsWith(prefix)).toBe(true);
      expect(ctx.target.canisterIds.pii_access_control.startsWith(prefix)).toBe(true);
      return ids.map(id => `${id}:${prefix}`);
    });
    expect(rows).toEqual(['club-b:b', 'club-a:a', 'club-b:b']); expect(calls).toHaveLength(2);
  });
  it('invalid destination binding prevents every discovery call', async () => {
    const f = fixture(); f.registry.bindings[1].domains[0].subnetId = 'unapproved';
    await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('placement');
    expect(f.transport.readMemberships).not.toHaveBeenCalled();
  });
  it('foreign membership ownership or duplicate claims denies the complete session', async () => {
    const f = fixture(); f.assignments[0].groupId = 'b';
    await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('Foreign');
    const g = fixture(); g.transport.readMemberships = async () => ({ clubs: ['club-a'], next: null, aclRevision: 1n });
    await expect(openGroupSession(g.ctx, g.transport)).rejects.toThrow('multiple groups');
  });
  it('empty intermediate pages advance bounded offsets rather than truncate discovery', async () => {
    const f = fixture(); const original = f.transport.readMemberships;
    f.transport.readMemberships = async (ctx, offset, limit) => offset === 0n ? { clubs: [], next: 200n, aclRevision: 1n } : original(ctx, offset, limit);
    const s = await openGroupSession(f.ctx, f.transport); expect(s.clubIds).toEqual(['club-a', 'club-b']);
  });
  it('changing permissions or repeated cursor denies discovery', async () => {
    for (const kind of ['acl', 'cursor']) {
      const f = fixture();
      f.transport.readMemberships = async (_, offset) => offset === 0n ? { clubs: [], next: 200n, aclRevision: 1n } :
        { clubs: [], next: kind === 'cursor' ? 200n : null, aclRevision: kind === 'acl' ? 2n : 1n };
      await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('membership page');
    }
  });
  it('unavailable group or incomplete assignments never returns partial membership', async () => {
    const f = fixture(); f.transport.readAssignments = async () => [];
    await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('Incomplete');
    const g = fixture(); g.transport.readMemberships = async () => { throw new Error('Group unavailable'); };
    await expect(openGroupSession(g.ctx, g.transport)).rejects.toThrow('unavailable');
  });
  it('revoked membership, stale registry and unknown clubs block before feature reads', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport); const read = vi.fn(async () => ['ok']);
    await expect(s.readClubs(['foreign'], 'events_domain', read)).rejects.toThrow('outside');
    f.transport.readAssignments = async () => { throw new Error('Club membership required'); };
    await expect(s.readClubs(['club-a'], 'events_domain', read)).rejects.toThrow('membership');
    f.registry.revision = 3n;
    await expect(s.readClubs(['club-a'], 'events_domain', read)).rejects.toThrow('registry changed');
    expect(read).not.toHaveBeenCalled();
  });
  it('disposed session cannot read or release an in-flight result', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    await expect(s.readClub('club-a', 'club_domain', async () => { s.dispose(); return 42; })).rejects.toThrow('disposed');
    await expect(s.readClub('club-a', 'club_domain', async () => 42)).rejects.toThrow('disposed');
  });
  it('incomplete batch, permission rejection and group failure discard the entire result', async () => {
    for (const kind of ['short', 'deny']) {
      const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
      await expect(s.readClubs(['club-a', 'club-b'], 'messaging_domain', async (ctx, ids) => {
        if (ctx.target.canisterIds.club_domain.startsWith('b-')) { if (kind === 'deny') throw new Error('Denied'); return []; }
        return ids.map(() => 1);
      })).rejects.toThrow(kind === 'deny' ? 'Denied' : 'incomplete');
    }
  });
  it('identity changes during discovery discard the session', async () => {
    const f = fixture(); const original = f.transport.readMemberships;
    f.transport.readMemberships = async (ctx, offset, limit) => {
      const page = await original(ctx, offset, limit);
      f.ctx.identity = { getPrincipal: () => ({ toText: () => 'other-person' }) } as unknown as FeatureBackendContext['identity'];
      return page;
    };
    await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('identity changed');
  });
  it('cross-engine host or network substitution rejects without fallback', async () => {
    for (const kind of ['host', 'network']) {
      const f = fixture(); if (kind === 'host') f.registry.deployment.host = 'https://other-engine.invalid';
      else f.registry.deployment.networkKind = 'cloud_engine';
      await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('registry');
      expect(f.transport.readMemberships).not.toHaveBeenCalled();
    }
  });
});