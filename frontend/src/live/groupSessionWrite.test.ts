import { describe, it, expect, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
import { GROUP_DOMAINS } from './groupRouting';
import { openGroupSession, isTransientWriteError, type GroupRegistry, type GroupSessionTransport } from './groupSession';
import { groupWriteFeatures } from './groupWriteFeatures';

function fixture() {
  const ctx = { identity: { getPrincipal: () => ({ toText: () => 'person' }) }, target: {
    alias: 'mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet', provider: 'icp',
    deploymentClass: 'public_subnet', canisterIds: { identity_access: 'global-cai' } } } as unknown as FeatureBackendContext;
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
const prefix = (c: FeatureBackendContext, d: string) => c.target.canisterIds[d as keyof typeof c.target.canisterIds]!.split('-')[0];

describe('routed group writes', () => {
  it('each write lands in the club group for every domain, keeping global services', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    for (const d of ['messaging_domain', 'events_domain', 'vault_domain', 'media_metadata'] as const) {
      expect(await s.writeClub('club-b', d, 'k1', async c => { expect(c.target.canisterIds.identity_access).toBe('global-cai');
        expect(prefix(c, 'pii_access_control')).toBe('b'); return prefix(c, d); })).toBe('b');
    }
  });
  it('non-member, revoked, stale registry and disposed sessions never call the write', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport); const w = vi.fn(async () => 1);
    await expect(s.writeClub('foreign', 'messaging_domain', 'k', w)).rejects.toThrow('outside');
    f.registry.revision = 3n; await expect(s.writeClub('club-a', 'messaging_domain', 'k', w)).rejects.toThrow('registry changed');
    f.registry.revision = 2n; f.transport.readAssignments = async () => { throw new Error('Club membership required'); };
    await expect(s.writeClub('club-a', 'messaging_domain', 'k', w)).rejects.toThrow('membership');
    s.dispose(); await expect(s.writeClub('club-a', 'messaging_domain', 'k', w)).rejects.toThrow('disposed');
    expect(w).not.toHaveBeenCalled();
  });
  it('requires a bounded idempotency key', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    await expect(s.writeClub('club-a', 'messaging_domain', '', async () => 1)).rejects.toThrow('idempotency');
    await expect(s.writeClub('club-a', 'messaging_domain', 'x'.repeat(129), async () => 1)).rejects.toThrow('idempotency');
  });
  it('transient loss retries the same group with the same key and revalidates each attempt', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport); const keys: string[] = []; let n = 0;
    const before = (f.transport.readAssignments as ReturnType<typeof vi.fn>).mock.calls.length;
    const r = await s.writeClub('club-a', 'messaging_domain', 'send-1', async (c, k) => { keys.push(`${prefix(c, 'messaging_domain')}:${k}`);
      if (++n < 3) throw new Error('Request timed out'); return 'ok'; });
    expect(r).toBe('ok'); expect(keys).toEqual(['a:send-1', 'a:send-1', 'a:send-1']);
    expect((f.transport.readAssignments as ReturnType<typeof vi.fn>).mock.calls.length - before).toBe(3);
  });
  it('permission and validation rejections are final, never retried', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport); const w = vi.fn(async () => { throw new Error('Not authorized'); });
    await expect(s.writeClub('club-a', 'vault_domain', 'k', w)).rejects.toThrow('Not authorized'); expect(w).toHaveBeenCalledTimes(1);
  });
  it('exhausted retries or revocation after a lost reply report uncertain outcome', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    await expect(s.writeClub('club-a', 'messaging_domain', 'k', async () => { throw new Error('network error'); })).rejects.toThrow('uncertain after 3');
    const w = vi.fn(async () => { f.registry.revision = 3n; throw new Error('Gateway timeout'); });
    await expect(s.writeClub('club-a', 'messaging_domain', 'k2', w)).rejects.toThrow('uncertain; Group registry changed'); expect(w).toHaveBeenCalledTimes(1);
  });
  it('concurrent duplicate submissions coalesce into one write', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport); const w = vi.fn(async () => 'sent');
    const [a, b] = await Promise.all([s.writeClub('club-a', 'messaging_domain', 'dup', w), s.writeClub('club-a', 'messaging_domain', 'dup', w)]);
    expect([a, b]).toEqual(['sent', 'sent']); expect(w).toHaveBeenCalledTimes(1);
  });
  it('event creation (no canister idempotency) is never auto-retried', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport); let calls = 0;
    await expect(s.writeClub('club-a', 'events_domain', 'e', async () => { calls++; throw new Error('timeout'); }, 1)).rejects.toThrow('uncertain after 1');
    expect(calls).toBe(1);
  });
  it('media paths outside the routed club are rejected before any upload', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    expect(() => groupWriteFeatures(s).uploadClubMedia('club-a', 'clubs/club-b/x.jpg', new Blob(['x']), 'image/jpeg')).toThrow('outside routed club');
  });
  it('classifies transient vs final errors', () => {
    expect(isTransientWriteError(new Error('fetch failed'))).toBe(true);
    expect(isTransientWriteError(new Error('Quota exceeded'))).toBe(false);
    expect(isTransientWriteError(new Error('permission denied: timeout'))).toBe(false);
  });
});

describe('remaining feature saves (roadmap 51)', () => {
  it('points, mini-league, competition and news saves pin the club group and only retry safe writes', async () => {
    const f = fixture(); const s = await openGroupSession(f.ctx, f.transport);
    const seen: string[] = []; const orig = s.writeClub;
    (s as { writeClub: typeof orig }).writeClub = (async (club, domain, key, fn, attempts) => { seen.push(`${club}:${domain}:${attempts ?? 'd'}`); return 'ok'; }) as typeof orig;
    const w = groupWriteFeatures(s);
    await w.awardPoints('club-b', 'k', {} as never, 'a', 's', 1, 'd');
    await w.createMiniLeague('club-b', 'k', {} as never);
    await w.updateMiniLeague('club-b', 'ml', {} as never);
    await w.setMatchResult('club-a', 'm1', 2, 1, 0);
    await w.createNewsPost('club-b', 'k', 't', 'b', 'draft', {} as never);
    await w.saveAnnouncement('club-b', 'hi');
    expect(seen).toEqual(['club-b:club_points_domain:1', 'club-b:mini_league_domain:1', 'club-b:mini_league_domain:d',
      'club-a:competition_domain:d', 'club-b:club_domain:1', 'club-b:club_domain:d']);
  });
});
