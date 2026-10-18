import { describe, it, expect } from 'vitest';
import { GROUP_DOMAINS, resolveClubDomain, partitionClubRequests, executeClubBatches, type GroupRoutingTable, type GroupDescriptor } from './groupRouting';
const group = (id: string): GroupDescriptor => ({ id, targetAlias: 'mainnet', domains: GROUP_DOMAINS.map((domain, i) => ({ domain, canisterId: `${id}-${i}-cai` })) });
const table = (): GroupRoutingTable => ({ groups: new Map([['a', group('a')], ['b', group('b')]]), assignments: new Map([['c1', { clubId: 'c1', groupId: 'a', revision: 1n }], ['c2', { clubId: 'c2', groupId: 'b', revision: 2n }]]) });
describe('immutable club-group routing prerequisite', () => {
  it('resolves all 13 domains to the authoritative group', () => {
    for (const [i, domain] of GROUP_DOMAINS.entries()) expect(resolveClubDomain(table(), 'mainnet', 'c2', domain)).toEqual({ groupId: 'b', canisterId: `b-${i}-cai`, revision: 2n });
  });
  it('never falls back for an unknown club or different deployment', () => {
    expect(() => resolveClubDomain(table(), 'mainnet', 'missing', 'club_domain')).toThrow();
    expect(() => resolveClubDomain(table(), 'eu-engine', 'c1', 'club_domain')).toThrow();
  });
  it('rejects mismatched assignment identity or revision', () => {
    for (const bad of [{ clubId: 'other', groupId: 'a', revision: 1n }, { clubId: 'c1', groupId: 'a', revision: 0n }]) {
      const t = table(); t.assignments = new Map([['c1', bad]]);
      expect(() => resolveClubDomain(t, 'mainnet', 'c1', 'club_domain')).toThrow();
    }
  });
  it('rejects an incomplete group, duplicate canister or missing group', () => {
    const base = group('a');
    for (const domains of [base.domains.slice(1), base.domains.map(item => ({ ...item, canisterId: 'same-cai' }))]) {
      const t = table(); t.groups = new Map([['a', { ...base, domains }]]);
      expect(() => resolveClubDomain(t, 'mainnet', 'c1', 'club_domain')).toThrow();
    }
    const t = table(); t.groups = new Map();
    expect(() => resolveClubDomain(t, 'mainnet', 'c1', 'club_domain')).toThrow();
  });
  it('partitions batches retaining duplicates and original indices', () => {
    const input = [{ clubId: 'c1', id: 1 }, { clubId: 'c2', id: 2 }, { clubId: 'c1', id: 1 }];
    const batches = partitionClubRequests(table(), 'mainnet', 'events_domain', input);
    expect(batches.get('a')?.requests.map(r => r.index)).toEqual([0, 2]);
    expect(batches.get('b')?.requests.map(r => r.index)).toEqual([1]);
    expect([...batches.values()].flatMap(b => b.requests).sort((a, b) => a.index - b.index).map(r => r.value)).toEqual(input);
  });
  it('reads each group once and restores order despite out-of-order completion', async () => {
    const input = [{ clubId: 'c1', id: 1 }, { clubId: 'c2', id: 2 }, { clubId: 'c1', id: 1 }];
    const calls: string[] = [];
    const rows = await executeClubBatches(table(), 'mainnet', 'events_domain', input, async (route, requests) => {
      calls.push(route.canisterId);
      if (route.groupId === 'a') await new Promise(resolve => setTimeout(resolve, 5));
      return requests.map(request => `${route.groupId}:${request.id}`);
    });
    expect(calls).toEqual(['a-1-cai', 'b-1-cai']);
    expect(rows).toEqual(['a:1', 'b:2', 'a:1']);
  });
  it('validates all assignments before calling any destination', async () => {
    let reads = 0;
    await expect(executeClubBatches(table(), 'mainnet', 'events_domain', [{ clubId: 'c1' }, { clubId: 'unknown' }], async () => {
      reads += 1; return [];
    })).rejects.toThrow('Missing authoritative club assignment');
    expect(reads).toBe(0);
  });
  it('rejects partial or extra responses rather than hiding or inventing rows', async () => {
    for (const response of [[], ['one', 'extra']]) {
      await expect(executeClubBatches(table(), 'mainnet', 'events_domain', [{ clubId: 'c1' }], async () => response)).rejects.toThrow('incomplete batch');
    }
  });
  it('propagates denied shard reads without returning partial data', async () => {
    await expect(executeClubBatches(table(), 'mainnet', 'events_domain', [{ clubId: 'c1' }, { clubId: 'c2' }], async route => {
      if (route.groupId === 'b') throw new Error('Membership revoked');
      return ['visible'];
    })).rejects.toThrow('Membership revoked');
  });
  it('performs no destination reads for an empty batch', async () => {
    let reads = 0;
    expect(await executeClubBatches(table(), 'mainnet', 'events_domain', [], async () => { reads += 1; return []; })).toEqual([]);
    expect(reads).toBe(0);
  });
});