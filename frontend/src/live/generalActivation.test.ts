import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GROUP_DOMAINS } from './groupRouting';
import { clearGeneralRoutingCache, routingActive, cachedGeneralRoutingActive, type RoutingGatesSnapshot } from './generalActivation';

const state = vi.hoisted(() => ({
  snapshot: null as RoutingGatesSnapshot | null,
  revision: 7n,
  groups: [] as unknown[],
}));
vi.mock('./generated/routingGates', () => ({ get ROUTING_GATES_SNAPSHOT() { return state.snapshot; } }));
vi.mock('./domains', () => ({
  connectLiveShardRouter: async () => ({
    actor: {
      read_group_registry_page: async () => ({
        Ok: { revision: state.revision, groups: state.groups, placements: state.groups.map((g: { id: string }) => ({ group_id: g.id })), next_cursor: [] },
      }),
    },
  }),
}));

const principal = 'renrk-eyaaa-aaaal-qadea-cai';
// The frontend's own target alias deliberately differs from the on-chain
// deployment name ('mainnet'); the snapshot binds by router canister id.
const ctx = {
  identity: { getPrincipal: () => ({ toText: () => principal }) },
  target: { alias: 'icp-public-mainnet', host: 'https://icp-api.io', networkKind: 'public_mainnet', canisterIds: { shard_router: 'jcdfe-vqaaa-aaaal-qxloq-cai' } },
} as never;

const liveGroup = (id: string) => ({
  id,
  target_alias: 'mainnet',
  domains: GROUP_DOMAINS.map(d => ({ domain: d, canister: { toText: () => `${id}-${d}` } })),
  photo_store: [{ toText: () => `${id}-photos` }],
  accepting: true,
});

const snapshot = (): RoutingGatesSnapshot => ({
  approved: true,
  generatedAt: '2026-10-21T00:00:00Z',
  targetAlias: 'mainnet',
  host: 'https://icp-api.io',
  routerCanisterId: 'jcdfe-vqaaa-aaaal-qxloq-cai',
  registryRevision: '7',
  groups: [{ id: 'g2', domains: GROUP_DOMAINS.map(d => ({ domain: d, canisterId: `g2-${d}` })), photoStore: 'g2-photos', moduleHashes: {} }],
  removalWiring: { revision: '7', groupIds: ['g2'], checkedAtMs: 1 },
  evidenceSha256: 'a'.repeat(64),
});

beforeEach(() => { clearGeneralRoutingCache(); state.snapshot = null; state.groups = []; state.revision = 7n; });

describe('general routing switch', () => {
  it('is inactive without an approved snapshot and never touches the network', async () => {
    expect(await routingActive(ctx)).toBe(false);
    expect(cachedGeneralRoutingActive()).toBe(false);
  });

  it('is inactive without a router or when signed out', async () => {
    state.snapshot = snapshot();
    expect(await routingActive({ ...ctx, target: { ...ctx.target, canisterIds: {} } } as never)).toBe(false);
    const anon = { identity: { getPrincipal: () => ({ toText: () => '2vxsx-fae' }) }, target: ctx.target } as never;
    expect(await routingActive(anon)).toBe(false);
  });

  it('activates when the live registry matches the approved snapshot exactly', async () => {
    state.snapshot = snapshot();
    state.groups = [liveGroup('g2')];
    expect(await routingActive(ctx)).toBe(true);
  });

  it('is inactive when the snapshot names another router canister or none', async () => {
    state.snapshot = { ...snapshot(), routerCanisterId: 'aaaaa-aa' };
    state.groups = [liveGroup('g2')];
    expect(await routingActive(ctx)).toBe(false);
    const legacy = snapshot();
    delete legacy.routerCanisterId;
    state.snapshot = legacy;
    expect(await routingActive(ctx)).toBe(false);
  });

  it('fails closed when the registry revision moved past the approved snapshot', async () => {
    state.snapshot = snapshot();
    state.groups = [liveGroup('g2')];
    state.revision = 8n;
    await expect(routingActive(ctx)).rejects.toThrow('older registry revision');
  });

  it('fails closed when a group changed since the snapshot', async () => {
    state.snapshot = snapshot();
    const g = liveGroup('g2') as { photo_store: { toText(): string }[] };
    g.photo_store = [{ toText: () => 'other-store' }];
    state.groups = [g];
    await expect(routingActive(ctx)).rejects.toThrow('changed since the routing snapshot');
  });

  it('fails closed when a group was added or removed since the snapshot', async () => {
    state.snapshot = snapshot();
    state.groups = [liveGroup('g2'), liveGroup('g3')];
    await expect(routingActive(ctx)).rejects.toThrow('group set changed');
  });
});
