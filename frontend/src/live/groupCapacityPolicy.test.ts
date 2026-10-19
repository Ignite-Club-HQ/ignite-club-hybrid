import { describe, it, expect } from 'vitest';
import { capacityPercent, capacityState, type CapacityEvidence } from './groupCapacityPolicy';
import { placeNewClub, type GroupCapacity, type PlacementPolicy } from './groupPlacement';
import { prepareCapacityRequests } from './groupCapacityPreparation';
const now = 1_000_000;
const evidence = (used: number): CapacityEvidence => ({ deploymentId: 'ic', observedAtMs: now,
  requiredResources: ['blob-admission', 'chat-throughput'], readings: [
    { resource: 'blob-admission', used, testedLimit: 1000, evidence: 'verified-admission-budget' },
    { resource: 'chat-throughput', used: 1, testedLimit: 100, evidence: 'load-test-acceptance' },
  ] });
const group = (groupId: string, used: number, clubs = 1): GroupCapacity => ({ groupId,
  deploymentId: 'ic', subnetId: 's1', enabled: true, ready: true, cyclesHealthy: true,
  clubs, maxDomainBytes: 1, dailyGrowthBytes: 0, capacity: evidence(used) });
const policy: PlacementPolicy = { deploymentId: 'ic', currentGroupId: 'a', nowMs: now,
  primarySubnet: 's1', approvedSubnets: ['s1'], additionalSubnetsEnabled: false };
describe('owner capacity rules', () => {
  it('prepares at 70%, not below, and keeps the current group receiving clubs', () => {
    expect(prepareCapacityRequests([group('a', 699)], policy).requests).toHaveLength(0);
    const requests = prepareCapacityRequests([group('a', 700)], policy).requests;
    expect(requests).toHaveLength(1); expect(requests[0].status).toBe('requested-closed');
    expect(placeNewClub([group('a', 700, 10), group('b', 0, 0)], policy)).toEqual({ kind: 'place', groupId: 'a' });
    expect(capacityState(70)).toBe('watch');
  });
  it('switches new clubs at exactly 80%, never sooner', () => {
    expect(placeNewClub([group('a', 799), group('b', 0, 0)], policy)).toEqual({ kind: 'place', groupId: 'a' });
    expect(placeNewClub([group('a', 800), group('b', 0, 0)], policy)).toEqual({ kind: 'place', groupId: 'b' });
    expect(capacityState(80)).toBe('act');
  });
  it('uses the tightest tested resource rather than total memory', () => {
    const e = evidence(1); e.readings[1].used = 80; expect(capacityPercent(e, 'ic', now)).toBe(80);
  });
  it('requires approval/readiness and blocks if no ready group exists', () => {
    expect(placeNewClub([group('a', 800), { ...group('b', 0), ready: false }], policy).kind).toBe('provision');
    expect(placeNewClub([group('a', 800), { ...group('b', 0), enabled: false }], policy).kind).toBe('provision');
  });
  it('low fuel requests a top-up, not another group', () => {
    const result = prepareCapacityRequests([{ ...group('a', 700), cyclesHealthy: false }], policy);
    expect(result.requests).toHaveLength(0); expect(result.blocked).toEqual(['Top up cycles; fuel is not a capacity trigger']);
  });
  it('missing stale future incomplete or foreign evidence fails closed', () => {
    for (const e of [undefined, { ...evidence(700), observedAtMs: now - 900001 },
      { ...evidence(700), observedAtMs: now + 1 }, { ...evidence(700), deploymentId: 'foreign' },
      { ...evidence(700), readings: evidence(700).readings.slice(1) }]) {
      expect(capacityPercent(e, 'ic', now)).toBeNull();
      expect(prepareCapacityRequests([{ ...group('a', 700), capacity: e }], policy).requests).toHaveLength(0);
    }
  });
  it('does not duplicate requests after rerun or while a ready sibling exists', () => {
    const first = prepareCapacityRequests([group('a', 700)], policy).requests;
    expect(prepareCapacityRequests([group('a', 750)], policy, first).requests).toEqual(first);
    expect(prepareCapacityRequests([group('a', 700), group('b', 0)], policy).requests).toHaveLength(0);
  });
  it('cannot use another deployment or unapproved subnet', () => {
    const rows = [group('a', 800), { ...group('b', 0), deploymentId: 'other' }, { ...group('c', 0), subnetId: 's2' }];
    expect(placeNewClub(rows, policy).kind).toBe('provision');
    expect(() => placeNewClub(rows, { ...policy, requiredDeploymentId: 'engine' })).toThrow('Engine-assigned');
  });
});
