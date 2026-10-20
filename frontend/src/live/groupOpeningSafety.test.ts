import { describe, it, expect } from 'vitest';
import { verifyRemovalWiring, ADMISSION_DOMAINS, ADMISSION_FLAG, ADMISSION_AUTHORITY } from './groupRemovalWiring';
import { activationStatus, OFF } from './groupActivation';
import { groupCanisterIds } from './groupSession';
import { GROUP_DOMAINS, type GroupDescriptor } from './groupRouting';

const ID = 'identity-cai';
const group = (id: string, photoStore?: string): GroupDescriptor => ({ id, targetAlias: 'ic', photoStore,
  domains: GROUP_DOMAINS.map(d => ({ domain: d, canisterId: `${id}-${d}` })) });
const on = [{ name: ADMISSION_FLAG, value: '1' }, { name: ADMISSION_AUTHORITY, value: ID }];

describe('opening a group', () => {
  it('routes a group club only to its own photo store, never a shared one', () => {
    const ids = groupCanisterIds({ media_blob_store: 'shared', media_blob_store_2: 'shared2', identity_access: ID } as Record<string, string>, group('g2', 'g2-photos'));
    expect(ids.media_blob_store).toBe('g2-photos');
    expect(ids.media_blob_store_2).toBeUndefined();
    expect(ids.identity_access).toBe(ID);
  });
  it('a group without its own photo store gets no store at all', () => {
    const ids = groupCanisterIds({ media_blob_store: 'shared' } as Record<string, string>, group('g2'));
    expect(ids.media_blob_store).toBeUndefined();
  });
  it('proves removal checks on every admission service and the photo store', async () => {
    const r = await verifyRemovalWiring({ revision: 7n, groups: [group('g2', 'g2-photos')] }, ID, async () => on, 1);
    expect(r.problems).toEqual([]);
    expect(r.evidence).toEqual({ revision: 7n, groupIds: ['g2'], checkedAtMs: 1 });
    expect(ADMISSION_DOMAINS).toHaveLength(11);
  });
  it('fails when any service has removal checks off or points at another account service', async () => {
    const r = await verifyRemovalWiring({ revision: 7n, groups: [group('g2', 'g2-photos')] }, ID,
      async c => c === 'g2-vault_domain' ? [] : c === 'g2-photos' ? [{ name: ADMISSION_FLAG, value: '1' }, { name: ADMISSION_AUTHORITY, value: 'other' }] : on, 1);
    expect(r.evidence).toBeNull();
    expect(r.problems).toEqual(['g2: vault_domain removal checks off', 'g2: vault_domain not bound to the account service', 'g2: photo store not bound to the account service']);
  });
  it('fails without a photo store', async () => {
    const r = await verifyRemovalWiring({ revision: 7n, groups: [group('g2')] }, ID, async () => on, 1);
    expect(r.problems).toEqual(['g2: photo store missing']);
  });
  it('activation requires removal proof for the exact approved revision', () => {
    const ready = { ...OFF, operatorApproved: true, recoveryVerified: true, rehearsalPassed: true, mainnetVerified: true,
      routedDomains: GROUP_DOMAINS, registryRevision: 7n, approvedRevision: 7n };
    expect(activationStatus(ready).missing).toEqual(['verified removal wiring']);
    expect(activationStatus({ ...ready, removalWiring: { revision: 6n, groupIds: ['g2'], checkedAtMs: 1 } }).active).toBe(false);
    expect(activationStatus({ ...ready, removalWiring: { revision: 7n, groupIds: ['g2'], checkedAtMs: 1 } }).active).toBe(true);
  });
});
