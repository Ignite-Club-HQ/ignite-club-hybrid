import { describe, expect, it } from 'vitest';
import { groupApprovalConfiguration } from './groupApproval';

const principal = (text: string) => ({ toText: () => text });
const group = () => ({ id: 'g2', target_alias: 'mainnet', accepting: true, max_clubs: 500,
  heap_budget_bytes: 3n * 1024n ** 3n, min_cycles: 1n, photo_store: [principal('store')],
  domains: [{ domain: 'club_domain', canister: principal('club') }],
  assigned_clubs: 0, heap_bytes: 0n, cycles: 1n, observed_at_ns: 1n });
const placement = () => ({ group_id: 'g2', deployment_id: 'mainnet', deployment_revision: 1n,
  host: 'https://icp-api.io', network_kind: 'public_mainnet', primary_subnet: principal('subnet'),
  additional_subnets_enabled: false, approved_subnets: [principal('subnet')],
  domains: [{ domain: 'club_domain', canister: principal('club'), subnet: principal('subnet') }] });
const project = (g = group(), p = placement()) => groupApprovalConfiguration([g] as never, [p] as never);

describe('approval configuration', () => {
  it('excludes club counts and fresh fuel/memory observations', () => {
    const g = group(); const before = project(g);
    g.assigned_clubs = 2; g.heap_bytes = 100n; g.cycles = 200n; g.observed_at_ns = 999n;
    expect(project(g)).toBe(before);
  });
  it('binds placement host rather than just the service inventory', () => {
    const p = placement(); const before = project(group(), p);
    p.host = 'https://foreign.invalid';
    expect(project(group(), p)).not.toBe(before);
  });
  it('binds every service subnet', () => {
    const p = placement(); const before = project(group(), p);
    p.domains[0].subnet = principal('different-subnet');
    expect(project(group(), p)).not.toBe(before);
  });
  it('binds the 500-club limit', () => {
    const g = group(); const before = project(g);
    g.max_clubs = 501;
    expect(project(g)).not.toBe(before);
  });
  it('refuses incomplete placement inventory', () => {
    expect(() => groupApprovalConfiguration([group()] as never, [])).toThrow('Incomplete');
  });
});