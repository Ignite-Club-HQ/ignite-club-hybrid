import { describe, it, expect, vi } from 'vitest';
import { placeNewClub, groupHealth, provisioningAlerts, GIB, type GroupCapacity, type PlacementPolicy } from './groupPlacement';
import { planTransfer, fence, recordCopy, verify, cutover, release, abort, servingGroup, TRANSFER_DOMAINS } from './groupTransfer';
import { groupWriteFeatures, NOTIFY_CHUNK } from './groupWriteFeatures';
import { Principal } from '@icp-sdk/core/principal';

const g = (groupId: string, o: Partial<GroupCapacity> = {}): GroupCapacity => {
  const row = { groupId, deploymentId: 'ic', subnetId: 's1', enabled: true, ready: true, cyclesHealthy: true, clubs: 10, maxDomainBytes: GIB, dailyGrowthBytes: 0, ...o };
  return { ...row, capacity: { deploymentId: row.deploymentId, observedAtMs: 1,
    requiredResources: ['storage', 'clubs'], readings: [
      { resource: 'storage', used: row.maxDomainBytes, testedLimit: 3 * GIB, evidence: 'test' },
      { resource: 'clubs', used: row.clubs, testedLimit: 500, evidence: 'test' },
    ] } };
};
const policy: PlacementPolicy = { deploymentId: 'ic', nowMs: 1, primarySubnet: 's1', additionalSubnetsEnabled: false, approvedSubnets: ['s1', 's2'] };
describe('placement and provisioning', () => {
  it('uses 70/80 percent of tested capacity, not absolute GB', () => {
    expect(groupHealth(g('a'), 1)).toBe('ok');
    expect(groupHealth(g('a', { maxDomainBytes: 2.2 * GIB }), 1)).toBe('watch');
    expect(groupHealth(g('a', { maxDomainBytes: 2.5 * GIB }), 1)).toBe('act');
    expect(groupHealth(g('a', { clubs: 400 }), 1)).toBe('act');
  });
  it('fills occupied healthy groups skipping disabled, foreign deployments and extra subnets', () => {
    const groups = [g('a', { clubs: 50 }), g('b', { clubs: 5, enabled: false }), g('c', { clubs: 1, deploymentId: 'engine' }), g('d', { clubs: 2, subnetId: 's2' }), g('e', { clubs: 20 })];
    expect(placeNewClub(groups, policy)).toEqual({ kind: 'place', groupId: 'a' });
    expect(placeNewClub(groups, { ...policy, additionalSubnetsEnabled: true })).toEqual({ kind: 'place', groupId: 'a' });
  });
  it('proposes closed provisioning when no group is ready; extra subnets only when enabled', () => {
    const full = [g('a', { maxDomainBytes: 3 * GIB })];
    expect(placeNewClub(full, policy)).toMatchObject({ kind: 'provision', subnetId: 's1' });
    expect(placeNewClub(full, { ...policy, additionalSubnetsEnabled: true })).toMatchObject({ kind: 'provision', subnetId: 's2' });
    expect(provisioningAlerts([...full, g('b')], 1).map(a => a.groupId)).toEqual(['a']);
  });
  it('engine-assigned clubs never fall back', () => {
    expect(() => placeNewClub([g('a')], { ...policy, requiredDeploymentId: 'engine' })).toThrow('Engine-assigned');
  });
});

describe('fenced club transfer', () => {
  const digests = (tweak = '') => TRANSFER_DOMAINS.map(domain => ({ domain, records: 3, digest: `h-${domain}${domain === 'vault_domain' ? tweak : ''}` }));
  it('runs the full sequence; writes pause during copy; target serves after cutover', () => {
    let t = planTransfer('club', 'a', 'b', 4n); expect(servingGroup(t)).toEqual({ group: 'a', writable: true });
    t = fence(t); expect(servingGroup(t).writable).toBe(false);
    t = verify(recordCopy(t, digests(), digests())); t = cutover(t, 4n);
    expect(servingGroup(t)).toEqual({ group: 'b', writable: true }); expect(t.registryRevision).toBe(5n);
    expect(release(t).log).toEqual(['planned', 'fenced', 'copied', 'verified', 'cutover', 'released']);
  });
  it('rejects skipped steps, incomplete evidence, mismatches and concurrent registry change', () => {
    expect(() => recordCopy(planTransfer('c', 'a', 'b', 1n), digests(), digests())).toThrow('Illegal');
    const f = fence(planTransfer('c', 'a', 'b', 1n));
    expect(() => recordCopy(f, digests().slice(1), digests())).toThrow('every domain');
    expect(() => verify(recordCopy(f, digests(), digests('x')))).toThrow('mismatch in vault_domain');
    expect(() => cutover(verify(recordCopy(f, digests(), digests())), 2n)).toThrow('re-plan');
  });
  it('abort restores source writes before cutover and is refused after', () => {
    const a = abort(fence(planTransfer('c', 'a', 'b', 1n))); expect(servingGroup(a)).toEqual({ group: 'a', writable: true });
    const c = cutover(verify(recordCopy(fence(planTransfer('c', 'a', 'b', 1n)), digests(), digests())), 1n);
    expect(() => abort(c)).toThrow('after cutover');
  });
});

describe('routed notifications', () => {
  it('chunks recipients with deterministic keys in the club group and reports queued counts', async () => {
    const calls: string[] = [];
    const session = { writeClub: vi.fn(async (club: string, domain: string, key: string) => { calls.push(`${club}|${domain}|${key}`); return calls.length === 3 ? 5 : NOTIFY_CHUNK; }) };
    const ids = Array.from({ length: NOTIFY_CHUNK * 2 + 5 }, (_, i) => Principal.fromUint8Array(new Uint8Array([i >> 8, i & 255, 1])).toText());
    const r = await groupWriteFeatures(session as never).notifyClub('club-a', { userIds: [...ids, ` principal:${ids[0]} `, ' '], kind: 'k', body: 'b', keyPrefix: 'rem-1' });
    expect(r.queued).toBe(NOTIFY_CHUNK * 2 + 5);
    expect(calls).toEqual(['club-a|notification_queue|rem-1.0', 'club-a|notification_queue|rem-1.1', 'club-a|notification_queue|rem-1.2']);
    await expect(groupWriteFeatures(session as never).notifyClub('club-a', { userIds: [ids[0]], kind: 'k', body: 'b', keyPrefix: '' })).rejects.toThrow('prefix');
  });
  it('reports only newly acknowledged queued rows, not attempted or duplicate recipients', async () => {
    const session = { writeClub: vi.fn().mockResolvedValue(0) };
    expect(await groupWriteFeatures(session as never).notifyClub('a', { userIds: ['aaaaa-aa'], kind: 'k', body: 'b', keyPrefix: 'retry' })).toEqual({ queued: 0 });
  });
});
