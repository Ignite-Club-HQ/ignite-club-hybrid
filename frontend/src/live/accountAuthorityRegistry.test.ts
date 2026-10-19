import { describe, expect, it } from 'vitest';
import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';
import { accountAuthoritiesFromRegistry, type AccountRegistrySnapshot } from './accountAuthorityRegistry';

const principal = (n: number) => Principal.fromUint8Array(Uint8Array.from([n, 1]));
const subnet = principal(100);
function fixture() {
  const groups = ['a', 'b'].map((id, group) => ({ id, target_alias: 'mainnet',
    domains: GROUP_DOMAINS.map((domain, i) => ({ domain, canister: principal(i + group * 20 + 1) })) }));
  const snapshot: AccountRegistrySnapshot = { revision: 8n, groups, placements: groups.map(g => ({
    group_id: g.id, deployment_id: 'ignite', deployment_revision: 3n, host: 'https://icp-api.io', network_kind: 'public_mainnet',
    primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false,
    domains: g.domains.map(d => ({ ...d, subnet })),
  })) };
  const binding = { targetAlias: 'mainnet', deploymentId: 'ignite', deploymentRevision: 3n, host: 'https://icp-api.io',
    networkKind: 'public_mainnet', registryRevision: 8n, requiredClubAuthorities: [groups[0].domains[0].canister.toText()] };
  return { snapshot, binding };
}
describe('account authority deployment inventory', () => {
  it('includes both groups and the required legacy club authority', () => {
    const { snapshot, binding } = fixture();
    expect(accountAuthoritiesFromRegistry(snapshot, binding)).toEqual(snapshot.groups.map(g => ({ groupId: g.id, clubDomain: g.domains[0].canister.toText() })));
  });
  it('rejects registry changes rather than accepting a different target set', () => {
    const { snapshot, binding } = fixture(); snapshot.revision = 9n;
    expect(() => accountAuthoritiesFromRegistry(snapshot, binding)).toThrow('stale');
  });
  it('rejects omission of the original club authority', () => {
    const { snapshot, binding } = fixture(); snapshot.groups.shift(); snapshot.placements.shift();
    expect(() => accountAuthoritiesFromRegistry(snapshot, binding)).toThrow('legacy');
  });
  it('rejects a foreign deployment even when its club IDs match', () => {
    const { snapshot, binding } = fixture(); snapshot.placements[1].deployment_id = 'foreign';
    expect(() => accountAuthoritiesFromRegistry(snapshot, binding)).toThrow('Foreign');
  });
  it('rejects a missing domain and a substituted domain principal', () => {
    const { snapshot, binding } = fixture(); snapshot.placements[0].domains.pop();
    expect(() => accountAuthoritiesFromRegistry(snapshot, binding)).toThrow('Incomplete');
    const other = fixture(); other.snapshot.placements[0].domains[0].canister = principal(90);
    expect(() => accountAuthoritiesFromRegistry(other.snapshot, other.binding)).toThrow('Unapproved');
  });
  it('refuses subnet expansion without approval', () => {
    const { snapshot, binding } = fixture(); snapshot.placements[0].domains[0].subnet = principal(101);
    expect(() => accountAuthoritiesFromRegistry(snapshot, binding)).toThrow('Unapproved');
  });
  it('rejects duplicated groups and misplaced placement rows', () => {
    const { snapshot, binding } = fixture(); snapshot.groups[1].id = 'a';
    expect(() => accountAuthoritiesFromRegistry(snapshot, binding)).toThrow('Incomplete');
    const other = fixture(); other.snapshot.placements[1].group_id = 'missing';
    expect(() => accountAuthoritiesFromRegistry(other.snapshot, other.binding)).toThrow('Foreign');
  });
});