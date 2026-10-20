/** In-memory integrated rehearsal: several groups, automatic placement,
 * operator-approved provisioning with a crash, a cross-group move with a crash,
 * and the activation gate. Real canister behaviour is covered separately by
 * scripts/test-transfer-replica.mjs. */
import { describe, it, expect } from 'vitest';
import { placeNewClub, MAX_CLUBS_PER_GROUP, type GroupCapacity } from './groupPlacement';
import { approveProvision, runProvision, PER_GROUP_DOMAINS, type Provision, type ProvisionAdapter } from './groupProvisioner';
import { activationStatus, chooseRoute, OFF, SHIPPED_GATES } from './groupActivation';
import { planTransfer, TRANSFER_DOMAINS } from './groupTransfer';
import { runTransfer, type TransferAdapter } from './groupTransferRunner';
import { GROUP_DOMAINS } from './groupRouting';

const policy = { deploymentId: 'ic', nowMs: 1, primarySubnet: 's1', additionalSubnetsEnabled: false, approvedSubnets: ['s1'] };
const cap = (groupId: string, clubs: number): GroupCapacity => ({ groupId, deploymentId: 'ic', subnetId: 's1', enabled: true, ready: true, cyclesHealthy: true, clubs, maxDomainBytes: 1e8, dailyGrowthBytes: 0, capacity: { deploymentId: 'ic', observedAtMs: 1, requiredResources: ['clubs'], readings: [{ resource: 'clubs', used: clubs, testedLimit: MAX_CLUBS_PER_GROUP, evidence: 'local-fixture' }] } });

function provisionWorld(crashAt = -1, subnet = 's1') {
  let revision = 2n; let created = 0; const saved: Provision[] = []; const registry: string[] = []; const enabled: string[] = [];
  const a: ProvisionAdapter = {
    createCanister: async (_p, d) => { if (created === crashAt) { created++; throw new Error('Request timed out'); } created++; return { canisterId: `c-${d}`, subnetId: subnet }; },
    install: async () => {}, configure: async () => {}, healthy: async () => true,
    readRegistryRevision: async () => revision,
    registerGroup: async p => { registry.push(p.groupId); revision++; }, enableGroup: async p => { enabled.push(p.groupId); },
    save: async p => { saved.push(structuredClone(p)); },
  };
  return { a, saved, registry, enabled, created: () => created, bump: () => revision++ };
}

describe('integrated scaling rehearsal', () => {
  it('fills an occupied group, then asks to provision when all are full', () => {
    expect(placeNewClub([cap('a', 10), cap('b', 3)], policy)).toEqual({ kind: 'place', groupId: 'a' });
    expect(placeNewClub([cap('a', MAX_CLUBS_PER_GROUP), cap('b', MAX_CLUBS_PER_GROUP)], policy).kind).toBe('provision');
  });

  it('provisioning needs a matching operator approval', () => {
    const d = placeNewClub([cap('a', MAX_CLUBS_PER_GROUP)], policy);
    expect(() => approveProvision(d, { operator: '', proposalId: 'p', deploymentId: 'ic', subnetId: 's1' }, 'c', 2n)).toThrow('approval');
    expect(() => approveProvision(d, { operator: 'gov', proposalId: 'p', deploymentId: 'ic', subnetId: 's9' }, 'c', 2n)).toThrow('match');
  });

  it('a crash mid-provision resumes without duplicate canisters and only registers a complete group', async () => {
    const d = placeNewClub([cap('a', MAX_CLUBS_PER_GROUP)], policy);
    const w = provisionWorld(4); let p = approveProvision(d, { operator: 'gov', proposalId: 'p1', deploymentId: 'ic', subnetId: 's1' }, 'c', 2n);
    p = await runProvision(p, w.a);
    expect(p.phase).toBe('failed'); expect(w.registry).toEqual([]);
    const receipt = w.saved.filter(s => s.phase === 'approved').at(-1);
    if (!receipt) throw new Error('Missing provisioning receipt');
    // This fixture failed before creation; an operator has proved no commit.
    const resumed = { ...receipt, pending: undefined, phase: 'approved' as const };
    expect(Object.keys(resumed.canisters)).toHaveLength(4);
    const done = await runProvision(resumed, w.a);
    expect(done.phase).toBe('enabled'); expect(Object.keys(done.canisters)).toHaveLength(PER_GROUP_DOMAINS.length);
    expect(done.canisters.secret_workload_identity).toBeUndefined();
    expect(w.created()).toBe(PER_GROUP_DOMAINS.length + 1); // one failed attempt, no duplicates
    expect(w.registry).toEqual(['c']); expect(w.enabled).toEqual(['c']);
  });

  it('refuses wrong-subnet canisters and stale registry revisions', async () => {
    const d = placeNewClub([cap('a', MAX_CLUBS_PER_GROUP)], policy);
    const appr = { operator: 'gov', proposalId: 'p', deploymentId: 'ic', subnetId: 's1' };
    const bad = provisionWorld(-1, 's2'); expect((await runProvision(approveProvision(d, appr, 'c', 2n), bad.a)).error).toMatch('unapproved subnet');
    const stale = provisionWorld(); stale.bump(); const r = await runProvision(approveProvision(d, appr, 'c', 2n), stale.a);
    expect(r.error).toMatch('Registry changed'); expect(stale.registry).toEqual([]);
  });

  it('moves a club to the new group, survives a crash and keeps other clubs intact', async () => {
    const store: Record<string, Record<string, string[]>> = { a: Object.fromEntries(TRANSFER_DOMAINS.map(d => [d, ['x:' + d]])), c: {} };
    const other = 'other-club-row'; store.c.club_domain = [other];
    const fenced = new Set<string>(); let crashed = false; let rev = 3n; const saved: unknown[] = [];
    const key = (g: string, club: string, d: string) => (store[g][d] ?? []).filter(r => club === 'k1' ? r !== other : r === other);
    const a: TransferAdapter = {
      sameDeployment: async () => true, setFence: async (g, _c, on) => { if (on) fenced.add(g); else fenced.delete(g); },
      exportPage: async (g, c, d) => ({ rows: key(g, c, d).map(r => new TextEncoder().encode(r)), next: null }),
      importPage: async (g, _c, d, rows) => {
        if (d === 'events_domain' && !crashed) { crashed = true; throw new Error('Request timed out'); }
        const cur = store[g][d] ?? []; for (const r of rows.map(x => new TextDecoder().decode(x))) if (!cur.includes(r)) cur.push(r); store[g][d] = cur;
      },
      digest: async (g, c, d) => ({ domain: d, records: key(g, c, d).length, digest: key(g, c, d).join('|') }),
      readRegistryRevision: async () => rev, swapAssignment: async () => { rev++; },
      purgeSource: async (g, c) => { for (const d of Object.keys(store[g])) store[g][d] = store[g][d].filter(r => !key(g, c, d).includes(r)); },
      save: async t => { saved.push(t); },
    };
    const t = planTransfer('k1', 'a', 'c', 3n);
    await expect(runTransfer(t, a)).rejects.toThrow();
    const last = (saved.at(-1) ?? t) as typeof t;
    const done = await runTransfer(last.phase === 'aborted' ? planTransfer('k1', 'a', 'c', 3n) : last, a);
    expect(done.phase).toBe('released'); expect(fenced.has('c')).toBe(false); // the new group is writable; the purged source stays locked
    expect(Object.values(store.a).flat()).toEqual([]);
    expect(store.c.club_domain).toContain(other);
  });

  it('activation stays off until every gate passes; inactive always routes legacy', () => {
    expect(chooseRoute(OFF, true)).toBe('legacy');
    const almost = { ...OFF, operatorApproved: true, recoveryVerified: true, rehearsalPassed: true, routedDomains: GROUP_DOMAINS, registryRevision: 4n, approvedRevision: 4n, removalWiring: { revision: 4n, groupIds: ["a"], checkedAtMs: 0 } };
    expect(activationStatus(almost).missing).toEqual(['mainnet verification']);
    expect(chooseRoute(almost, true)).toBe('legacy');
    expect(chooseRoute({ ...almost, mainnetVerified: true }, true)).toBe('group');
    expect(chooseRoute({ ...almost, mainnetVerified: true, approvedRevision: 3n }, true)).toBe('legacy');
  });
  it('this build ships with group routing switched off', () => {
    expect(activationStatus(SHIPPED_GATES).active).toBe(false);
  });
});
