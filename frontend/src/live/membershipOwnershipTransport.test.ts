import { beforeEach, expect, it, vi } from 'vitest';
import type { HttpAgent } from '@icp-sdk/core/agent';
import { PINNED } from '../../../scripts/membership-lookup-release-policy.mjs';
import { OWNER_GROUP1_CLUBS, checkLegacyOwnership } from '../../../scripts/membership-legacy-ownership.mjs';
const mocks = vi.hoisted(() => ({ create: vi.fn(), read: vi.fn(), status: vi.fn() }));
vi.mock('@icp-sdk/core/agent', () => ({ Actor: { createActor: mocks.create } }));
import { membershipOwnershipTransport } from '../../scripts/membership-ownership-transport';

const snapshot = () => ({ revision: 9n, configurationRevision: 2n,
  groups: ['g2', 'g3'].map(id => ({ id, target_alias: 'mainnet', domains: [{ domain: 'club_domain', canister: id === 'g2' ? PINNED.g2 : 'group3-authority' }] })),
  placements: ['g2', 'g3'].map(id => ({ group_id: id, deployment_id: 'mainnet', deployment_revision: 1n, host: 'https://icp-api.io', network_kind: 'public_mainnet', domains: [{ domain: 'club_domain', canister: id === 'g2' ? PINNED.g2 : 'group3-authority' }] })),
});
beforeEach(() => {
  vi.clearAllMocks();
  mocks.create.mockImplementation((_idl, options) => ({
    read_membership_source_page: (cursor: unknown) => mocks.read(options.canisterId, cursor),
    read_membership_discovery_status: () => mocks.status(options.canisterId),
  }));
  mocks.read.mockImplementation(async id => ({ Ok: { revision: 7n, scanned: id === PINNED.g1 ? 3n : 0n,
    edges: id === PINNED.g1 ? Object.values(OWNER_GROUP1_CLUBS).map(club => ({ Club: { id: club, deleted: false } })) : [], next: [] } }));
  mocks.status.mockResolvedValue({ Ok: { revision: 7n } });
});

it('runs complete original G1/G2/G3 observation through shared lazy update actors without configuring anything', async () => {
  const registry = vi.fn(async () => snapshot());
  const transport = membershipOwnershipTransport({} as HttpAgent, registry);
  expect(mocks.create).not.toHaveBeenCalled();
  const report = await checkLegacyOwnership(transport);
  expect(mocks.read.mock.calls.map(c => c[0])).toEqual([PINNED.g1, PINNED.g2, 'group3-authority', PINNED.g1, PINNED.g2, 'group3-authority']);
  expect(mocks.read.mock.calls.every(c => Array.isArray(c[1]) && c[1].length === 0)).toBe(true);
  expect(mocks.create).toHaveBeenCalledTimes(3);
  expect(mocks.status).toHaveBeenCalledTimes(3);
  expect(report.sources.map((s: { groupId: string }) => s.groupId)).toEqual(['g1', 'g2', 'g3']);
  expect(report.ready).toBe(false); expect(report.appEnabled).toBe(false);
  expect(report.locations).toHaveLength(3);
});

it('refused Group 3 consensus export fails the whole check rather than omitting its source', async () => {
  mocks.read.mockImplementation(async id => id === 'group3-authority' ? { Err: 'Governor required' } :
    { Ok: { revision: 7n, scanned: 0n, edges: [], next: [] } });
  await expect(checkLegacyOwnership(membershipOwnershipTransport({} as HttpAgent, async () => snapshot()))).rejects.toThrow('Governor required');
  expect(mocks.status).not.toHaveBeenCalled();
});

it('a late source revision refuses the entire observation', async () => {
  mocks.status.mockImplementation(async id => ({ Ok: { revision: id === 'group3-authority' ? 8n : 7n } }));
  await expect(checkLegacyOwnership(membershipOwnershipTransport({} as HttpAgent, async () => snapshot()))).rejects.toThrow('changed after');
});