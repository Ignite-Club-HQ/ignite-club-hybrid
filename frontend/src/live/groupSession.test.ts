import { describe, it, expect, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
import { GROUP_DOMAINS } from './groupRouting';
import { openGroupSession, READ_RECHECK_WINDOW_MS, type GroupRegistry, type GroupSessionTransport } from './groupSession';

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
  it('a verified complete directory skips membership searches but retains destination checks', async () => {
    const f = fixture();
    f.transport.readMembershipDirectory = vi.fn(async (_, sequence, fingerprint) => ({ caller: 'person', accountVersion: 1n,
      generation: 1n, directoryRevision: 1n, instance: 1n, registryFingerprint: fingerprint, verifiedCurrent: true,
      assignments: f.assignments, legacyClubs: [], next: null }));
    const s = await openGroupSession(f.ctx, f.transport);
    expect(s.memberClubIds).toEqual(['club-a', 'club-b']);
    expect(f.transport.readMembershipDirectory).toHaveBeenCalledTimes(1);
    expect(f.transport.readMemberships).not.toHaveBeenCalled();
    expect(f.transport.readAssignments).toHaveBeenCalledWith(['club-a', 'club-b'], 2n);
  });
  it('an incomplete or foreign directory falls back to complete discovery without keeping its rows', async () => {
    for (const kind of ['partial', 'foreign', 'unavailable']) {
      const f = fixture();
      f.transport.readMembershipDirectory = async (_, __, fingerprint) => {
        if (kind === 'unavailable') throw new Error('Directory unavailable');
        return { caller: 'person', accountVersion: 1n, generation: 1n, directoryRevision: 1n, instance: 1n,
          registryFingerprint: fingerprint, verifiedCurrent: kind !== 'partial',
          assignments: [{ clubId: 'phantom', groupId: 'foreign', revision: 1n }], legacyClubs: [], next: null };
      };
      const s = await openGroupSession(f.ctx, f.transport);
      expect(s.memberClubIds).toEqual(['club-a', 'club-b']);
      expect(f.transport.readMemberships).toHaveBeenCalledTimes(2);
    }
  });
  it('directory display hints do not bypass a revoked destination membership', async () => {
    const f = fixture();
    f.transport.readMembershipDirectory = async (_, __, fingerprint) => ({ caller: 'person', accountVersion: 1n,
      generation: 1n, directoryRevision: 1n, instance: 1n, registryFingerprint: fingerprint, verifiedCurrent: true,
      assignments: f.assignments, legacyClubs: [], next: null });
    f.transport.readAssignments = async () => { throw new Error('Club membership required'); };
    await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('Club membership required');
    expect(f.transport.readMemberships).not.toHaveBeenCalled();
  });
  it('a replaced directory instance discards provisional rows and uses complete discovery', async () => {
    const f = fixture();
    f.transport.readMembershipDirectory = async (_, continuation, fingerprint) => ({ caller: 'person', accountVersion: 1n,
      generation: 1n, directoryRevision: 1n, instance: continuation === null ? 7n : 8n,
      registryFingerprint: fingerprint, verifiedCurrent: true,
      assignments: [{ clubId: 'phantom', groupId: 'a', revision: 1n }], legacyClubs: [],
      next: continuation === null ? { instance: 7n, sequence: 1n } : null });
    const s = await openGroupSession(f.ctx, f.transport);
    expect(s.memberClubIds).toEqual(['club-a', 'club-b']);
    expect(f.transport.readMemberships).toHaveBeenCalledTimes(2);
    expect(f.transport.readAssignments).toHaveBeenCalledWith(['club-a', 'club-b'], 2n);
  });
  it('routes when the on-chain deployment alias differs from the frontend target alias', async () => {
    const f = fixture();
    // The router knows its deployment as 'mainnet'; the frontend target is a
    // local name for the same deployment. Routing must bind to the on-chain name.
    f.ctx.target.alias = 'icp-public-mainnet';
    f.registry.deployment.alias = 'mainnet';
    f.transport.deploymentAlias = () => 'mainnet';
    const s = await openGroupSession(f.ctx, f.transport);
    expect(s.clubIds).toEqual(['club-a', 'club-b']);
    const seen = await s.readClub('club-a', 'club_domain', async ctx => ctx.target.canisterIds.club_domain);
    expect(seen).toBe('a-0-cai');
  });
  it('refuses a registry whose alias matches neither the target nor the declared on-chain alias', async () => {
    const f = fixture();
    f.ctx.target.alias = 'icp-public-mainnet';
    f.registry.deployment.alias = 'mainnet';
    // Without the transport declaring the on-chain alias, the mismatch fails closed.
    await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('Invalid authoritative group registry');
    expect(f.transport.readMemberships).not.toHaveBeenCalled();
  });
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
    // Deletion validation always asks fresh (the open-time read is otherwise reused briefly).
    await expect(s.assertRegistryUnchanged(true)).rejects.toThrow('registry changed');
  });
  it('rejects a registry change while all-group discovery replies are in flight', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    await expect(s.readEveryGroup('club_domain', async () => {
      f.registry.revision += 1n; return [];
    })).rejects.toThrow('registry changed');
  });
  it('concurrent all-group reads share one post-read registry confirmation', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    const before = vi.mocked(f.transport.readRegistry).mock.calls.length;
    await Promise.all([1, 2, 3, 4].map(() => s.readEveryGroup('club_domain', async () => [])));
    expect(vi.mocked(f.transport.readRegistry).mock.calls.length - before).toBe(1);
  });
  it('a read finishing after a confirmation started still gets its own fresh check', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    let release!: () => void; const gate = new Promise<void>(r => { release = r; });
    const fast = s.readEveryGroup('club_domain', async () => []);
    const slow = s.readEveryGroup('club_domain', async () => { await gate; f.registry.revision += 1n; return []; });
    await fast; release();
    await expect(slow).rejects.toThrow('registry changed');
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
  it('indexed account admission rejection never falls back to the scan pager or creates a session', async () => {
    const f = fixture();
    f.transport.readMembershipsIndexed = vi.fn(async () => { throw new Error('Account admission denied or unavailable'); });
    await expect(openGroupSession(f.ctx, f.transport)).rejects.toThrow('Account admission denied or unavailable');
    // Groups are asked together; each refuses once and nothing falls back.
    expect(f.transport.readMembershipsIndexed).toHaveBeenCalledTimes(f.registry.groups.length);
    expect(f.transport.readMemberships).not.toHaveBeenCalled();
    expect(f.transport.readAssignments).not.toHaveBeenCalled();
  });
  it('revoked membership, stale registry and unknown clubs block before feature reads', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport); const read = vi.fn(async () => ['ok']);
    await expect(s.readClubs(['foreign'], 'events_domain', read)).rejects.toThrow('outside');
    f.transport.readAssignments = async () => { throw new Error('Club membership required'); };
    // Member reads reuse opening's confirmed checks for READ_RECHECK_WINDOW_MS; after it revocation is caught.
    const base = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(base + READ_RECHECK_WINDOW_MS + 1_000);
    try {
      await expect(s.readClubs(['club-a'], 'events_domain', read)).rejects.toThrow('membership');
      f.registry.revision = 3n;
      spy.mockReturnValue(base + 2 * READ_RECHECK_WINDOW_MS + 2_000);
      await expect(s.readClubs(['club-a'], 'events_domain', read)).rejects.toThrow('registry changed');
    } finally { spy.mockRestore(); }
    expect(read).not.toHaveBeenCalled();
  });
  it('member reads within five minutes skip re-checks; writes after 15 seconds still re-check first', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    const assignments = f.transport.readAssignments as ReturnType<typeof vi.fn>; const before = assignments.mock.calls.length;
    const base = Date.now();
    const spy = vi.spyOn(Date, 'now').mockReturnValue(base + 2 * 60_000);
    try {
      await s.readClub('club-a', 'messaging_domain', async () => 1);
      expect(assignments.mock.calls.length - before).toBe(0);
      f.transport.readAssignments = async () => { throw new Error('Club membership required'); };
      const write = vi.fn(async () => 1);
      await expect(s.writeClub('club-a', 'messaging_domain', 'k1', write)).rejects.toThrow('membership');
      expect(write).not.toHaveBeenCalled();
    } finally { spy.mockRestore(); }
  });
  it('shares one assignment check across concurrent reads of the same club', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    const spy = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + READ_RECHECK_WINDOW_MS + 1_000);
    const spyFn = f.transport.readAssignments as ReturnType<typeof vi.fn>; const before = spyFn.mock.calls.length;
    try { await Promise.all([1, 2, 3].map(() => s.readClub('club-a', 'club_domain', async () => 1))); } finally { spy.mockRestore(); }
    expect(spyFn.mock.calls.length - before).toBe(1);
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