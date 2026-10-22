import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GROUP_DOMAINS } from './groupRouting';
import { groupApprovalConfiguration, approvalConfigurationSha256 } from './groupApproval';
import { clearGeneralRoutingCache, routingActive, cachedGeneralRoutingActive, type RoutingGatesSnapshot } from './generalActivation';

const state = vi.hoisted(() => ({
  snapshot: null as RoutingGatesSnapshot | null,
  revision: 7n,
  configurationRevision: 7n,
  groups: [] as unknown[],
  approval: undefined as unknown,
}));
vi.mock('./generated/routingGates', () => ({ get ROUTING_GATES_SNAPSHOT() { return state.snapshot; } }));
vi.mock('./domains', () => ({
  connectLiveShardRouter: async () => ({
    actor: {
      read_group_registry_page: async () => ({
        Ok: { revision: state.revision, configuration_revision: [state.configurationRevision], groups: state.groups, placements: state.groups.map((g: { id: string }) => placement(g.id)), next_cursor: [] },
      }),
      ...(state.approval === undefined ? {} : { read_routing_approval: async () => state.approval }),
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
  accepting: true, max_clubs: 500, heap_budget_bytes: 1n, min_cycles: 1n,
});
const placement = (id: string) => ({ group_id: id, deployment_id: 'mainnet', deployment_revision: 1n,
  host: 'https://icp-api.io', network_kind: 'public_mainnet', primary_subnet: { toText: () => 'subnet' },
  approved_subnets: [{ toText: () => 'subnet' }], additional_subnets_enabled: false,
  domains: GROUP_DOMAINS.map(domain => ({ domain, canister: { toText: () => `${id}-${domain}` }, subnet: { toText: () => 'subnet' } })),
});

const snapshot = (): RoutingGatesSnapshot => ({
  approved: true,
  generatedAt: '2026-10-21T00:00:00Z',
  targetAlias: 'mainnet',
  host: 'https://icp-api.io',
  routerCanisterId: 'jcdfe-vqaaa-aaaal-qxloq-cai',
  registryRevision: '7', configurationRevision: '7',
  approvedConfiguration: groupApprovalConfiguration([liveGroup('g2')] as never, [placement('g2')] as never),
  groups: [{ id: 'g2', domains: GROUP_DOMAINS.map(d => ({ domain: d, canisterId: `g2-${d}` })), photoStore: 'g2-photos', moduleHashes: {} }],
  removalWiring: { revision: '7', groupIds: ['g2'], checkedAtMs: 1 },
  evidenceSha256: 'a'.repeat(64),
});

beforeEach(() => { clearGeneralRoutingCache(); state.approval = undefined; state.snapshot = null; state.groups = []; state.revision = 7n; state.configurationRevision = 7n; });

describe('general routing switch', () => {
  it('keeps approval active after two ordinary club reservations advance the assignment revision', async () => {
    state.snapshot = snapshot(); state.groups = [liveGroup('g2')];
    state.revision = 8n; expect(await routingActive(ctx)).toBe(true);
    clearGeneralRoutingCache(); state.revision = 9n; expect(await routingActive(ctx)).toBe(true);
  });
  it('requires regeneration of legacy approval instead of trusting assignment drift', async () => {
    const old = snapshot(); delete old.configurationRevision;
    state.snapshot = old; state.groups = [liveGroup('g2')];
    await expect(routingActive(ctx)).rejects.toThrow('configuration changed');
  });
  it('rejects a replaced domain even when the configuration revision is unchanged', async () => {
    state.snapshot = snapshot(); const g = liveGroup('g2');
    g.domains[0].canister = { toText: () => 'replacement' }; state.groups = [g];
    await expect(routingActive(ctx)).rejects.toThrow('changed since the routing snapshot');
  });
  it('rejects policy drift even at the same configuration revision', async () => {
    state.snapshot = snapshot(); state.groups = [{ ...liveGroup('g2'), accepting: false }];
    await expect(routingActive(ctx)).rejects.toThrow('placement or policy changed');
  });
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

  it('fails closed when configuration moved past the approved snapshot', async () => {
    state.snapshot = snapshot();
    state.groups = [liveGroup('g2')];
    state.configurationRevision = 8n;
    await expect(routingActive(ctx)).rejects.toThrow('configuration changed');
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

  describe('live approval recorded on the router (no app release after opening)', () => {
    const approve = async (groups: ReturnType<typeof liveGroup>[], revision: bigint, ids = groups.map(g => g.id)) => ({
      Ok: [{ target_alias: 'mainnet', configuration_revision: revision, removal_wiring_group_ids: ids, removal_checked_at_ms: 5n, evidence_sha256: 'e'.repeat(64),
        approved_configuration_sha256: await approvalConfigurationSha256(groupApprovalConfiguration(groups as never, groups.map(g => placement(g.id)) as never)) }],
    });
    it('activates a newly opened group from the live approval without a new snapshot', async () => {
      state.snapshot = snapshot(); state.groups = [liveGroup('g2'), liveGroup('g3')]; state.configurationRevision = 9n;
      state.approval = await approve(state.groups as never, 9n);
      expect(await routingActive(ctx)).toBe(true);
    });
    it('fails closed when the live approval is for an older configuration', async () => {
      state.snapshot = snapshot(); state.groups = [liveGroup('g2'), liveGroup('g3')]; state.configurationRevision = 10n;
      state.approval = await approve(state.groups as never, 9n);
      await expect(routingActive(ctx)).rejects.toThrow('configuration changed');
    });
    it('fails closed when the live registry differs from the approved digest', async () => {
      state.snapshot = snapshot(); state.configurationRevision = 9n;
      state.approval = await approve([liveGroup('g2'), liveGroup('g3')], 9n);
      state.groups = [liveGroup('g2'), { ...liveGroup('g3'), max_clubs: 7 }];
      await expect(routingActive(ctx)).rejects.toThrow('placement or policy changed');
    });
    it('fails closed when the approval does not cover every registered group', async () => {
      state.snapshot = snapshot(); state.groups = [liveGroup('g2'), liveGroup('g3')]; state.configurationRevision = 9n;
      state.approval = await approve(state.groups as never, 9n, ['g2']);
      await expect(routingActive(ctx)).rejects.toThrow('group set changed');
    });
    it('fails closed when no live approval exists yet', async () => {
      state.snapshot = snapshot(); state.groups = [liveGroup('g2'), liveGroup('g3')]; state.configurationRevision = 9n;
      state.approval = { Ok: [] };
      await expect(routingActive(ctx)).rejects.toThrow('configuration changed');
    });
  });
});
