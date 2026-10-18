import { describe, expect, it } from 'vitest';
import { GROUP_DOMAINS } from './groupRouting';
import { groupRouteScope, resolveDeploymentClubDomain, type DeploymentBoundTable, type GroupDeployment } from './groupDeployment';

function fixture(kind: GroupDeployment['networkKind'] = 'public_mainnet') {
  const deployment: GroupDeployment = {
    id: 'deployment-one', alias: 'same-alias', networkKind: kind,
    host: 'https://engine.example', revision: 1n, enabled: true,
    primarySubnet: 'subnet-one', approvedSubnets: ['subnet-one', 'subnet-two'],
    additionalSubnetsEnabled: false,
  };
  const domains = GROUP_DOMAINS.map((domain, index) => ({ domain, canisterId: `domain-${index}-cai` }));
  const table: DeploymentBoundTable = {
    routing: {
      groups: new Map([['group-one', { id: 'group-one', targetAlias: deployment.alias, domains }]]),
      assignments: new Map([['club-one', { clubId: 'club-one', groupId: 'group-one', revision: 1n }]]),
    },
    deployments: new Map([[deployment.id, deployment]]),
    bindings: new Map([['group-one', {
      groupId: 'group-one', deploymentId: deployment.id, deploymentRevision: 1n,
      domains: domains.map(entry => ({ ...entry, subnetId: 'subnet-one' })),
    }]]),
  };
  return { table, deployment };
}
const resolve = (f: ReturnType<typeof fixture>) => resolveDeploymentClubDomain(f.table, f.deployment, 'club-one', 'events_domain');
describe('deployment-isolated group routing preparation', () => {
  it.each(['public_mainnet', 'cloud_engine'] as const)('resolves a complete approved %s group', kind => {
    expect(resolve(fixture(kind))).toMatchObject({ deploymentId: 'deployment-one', networkKind: kind, host: 'https://engine.example', subnetId: 'subnet-one', canisterId: 'domain-1-cai' });
  });
  it('rejects a different deployment even when alias and canister IDs match', () => {
    const f = fixture(); f.deployment = { ...f.deployment, id: 'other-engine' };
    expect(() => resolve(f)).toThrow('approved deployment');
  });
  it('rejects changed host, network kind or revision under the same alias', () => {
    for (const change of [{ host: 'https://other.example' }, { networkKind: 'cloud_engine' as const }, { revision: 2n }]) {
      const f = fixture(); f.deployment = { ...f.deployment, ...change };
      expect(() => resolve(f)).toThrow('approved deployment');
    }
  });
  it('rejects disabled engines without falling back to mainnet', () => {
    const f = fixture('cloud_engine'); f.deployment = { ...f.deployment, enabled: false };
    expect(() => resolve(f)).toThrow('approved deployment');
  });
  it('keeps additional subnet routing disabled until explicitly enabled', () => {
    const f = fixture();
    const binding = f.table.bindings.get('group-one');
    if (!binding) throw new Error('Fixture missing');
    f.table.bindings = new Map([['group-one', { ...binding, domains: binding.domains.map(entry => entry.domain === 'messaging_domain' ? { ...entry, subnetId: 'subnet-two' } : entry) }]]);
    // Validate all domains even when this request is for events.
    expect(() => resolve(f)).toThrow('Unapproved group domain placement');
    f.deployment = { ...f.deployment, additionalSubnetsEnabled: true };
    f.table.deployments = new Map([[f.deployment.id, f.deployment]]);
    expect(resolveDeploymentClubDomain(f.table, f.deployment, 'club-one', 'messaging_domain').subnetId).toBe('subnet-two');
    expect(resolve(f).subnetId).toBe('subnet-one');
  });
  it('rejects unapproved subnets even after expansion is enabled', () => {
    const f = fixture(); f.deployment = { ...f.deployment, additionalSubnetsEnabled: true };
    f.table.deployments = new Map([[f.deployment.id, f.deployment]]);
    const binding = f.table.bindings.get('group-one');
    if (!binding) throw new Error('Fixture missing');
    f.table.bindings = new Map([['group-one', { ...binding, domains: binding.domains.map(entry => ({ ...entry, subnetId: 'unknown-subnet' })) }]]);
    expect(() => resolve(f)).toThrow('Unapproved group domain placement');
  });
  it('rejects stale bindings and changed canister destinations', () => {
    for (const stale of [true, false]) {
      const f = fixture(); const binding = f.table.bindings.get('group-one');
      if (!binding) throw new Error('Fixture missing');
      f.table.bindings = new Map([['group-one', { ...binding, deploymentRevision: stale ? 2n : 1n, domains: binding.domains.map(entry => ({ ...entry, canisterId: stale ? entry.canisterId : 'substituted-cai' })) }]]);
      expect(() => resolve(f)).toThrow();
    }
  });
  it('rejects duplicate domain placements', () => {
    const f = fixture(); const binding = f.table.bindings.get('group-one');
    if (!binding || !binding.domains[0]) throw new Error('Fixture missing');
    const first = binding.domains[0];
    f.table.bindings = new Map([['group-one', { ...binding, domains: binding.domains.map(() => first) }]]);
    expect(() => resolve(f)).toThrow('Unapproved group domain placement');
  });
  it.each(['http://engine.example', 'https://user:password@engine.example', 'https://engine.example/path', 'https://engine.example?key=x'])('rejects unsafe endpoint %s', host => {
    const f = fixture(); f.deployment = { ...f.deployment, host }; f.table.deployments = new Map([[f.deployment.id, f.deployment]]);
    expect(() => resolve(f)).toThrow('HTTPS origin');
  });
  it('isolates route cache scope by deployment and account', () => {
    const route = resolve(fixture());
    expect(groupRouteScope(route, 'account-one')).not.toBe(groupRouteScope(route, 'account-two'));
    expect(groupRouteScope(route, 'account-one')).not.toBe(groupRouteScope({ ...route, deploymentId: 'other-engine' }, 'account-one'));
    expect(() => groupRouteScope(route, '2vxsx-fae')).toThrow('Authenticated account');
  });
});