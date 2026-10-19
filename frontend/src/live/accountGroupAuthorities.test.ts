import { describe, expect, it, vi } from 'vitest';
import { wireAccountGroupAuthorities, wireVerifiedLocalAccountAuthorities } from './accountGroupAuthorities';
import { Principal } from '@icp-sdk/core/principal';
import { GROUP_DOMAINS } from './groupRouting';
const groups = [{ groupId: 'a', clubDomain: 'rrkah-fqaaa-aaaaa-aaaaq-cai' }, { groupId: 'b', clubDomain: 'ryjl3-tyaaa-aaaaa-aaaba-cai' }];
const identityId = 'r7inp-6aaaa-aaaaa-aaabq-cai';
describe('complete account authority wiring', () => {
  it('wires both club groups before publishing the complete identity inventory', async () => {
    const calls: string[] = [];
    await wireAccountGroupAuthorities(groups, identityId, {
      club: id => ({ set_identity_access_canister: async p => { calls.push(`${id}:${p.toText()}`); return { Ok: null }; } }),
      identity: () => ({ set_club_authorities: async ids => { calls.push(ids.map(p => p.toText()).join(',')); return { Ok: null }; } }),
    });
    expect(calls).toEqual([`${groups[0].clubDomain}:${identityId}`, `${groups[1].clubDomain}:${identityId}`, groups.map(g => g.clubDomain).join(',')]);
  });
  it('does not publish an inventory after a club refuses wiring', async () => {
    const publish = vi.fn();
    await expect(wireAccountGroupAuthorities(groups, identityId, {
      club: () => ({ set_identity_access_canister: async () => ({ Err: 'Governor required' }) }),
      identity: () => ({ set_club_authorities: publish }),
    })).rejects.toThrow('Governor required');
    expect(publish).not.toHaveBeenCalled();
  });
  it('rejects duplicate authorities before mutation', async () => {
    const club = vi.fn();
    await expect(wireAccountGroupAuthorities([groups[0], { ...groups[0], groupId: 'b' }], identityId, { club, identity: vi.fn() })).rejects.toThrow('Duplicate');
    expect(club).not.toHaveBeenCalled();
  });
  it('refuses pending unlink when the identity authority rejects the inventory', async () => {
    await expect(wireAccountGroupAuthorities(groups, identityId, {
      club: () => ({ set_identity_access_canister: async () => ({ Ok: null }) }),
      identity: () => ({ set_club_authorities: async () => ({ Err: 'Unlink recovery pending' }) }),
    })).rejects.toThrow('Unlink recovery pending');
  });
  it('rejects production wiring before reading or mutating any authority', async () => {
    const readRegistry = vi.fn(); const club = vi.fn();
    await expect(wireVerifiedLocalAccountAuthorities({ targetAlias: 'mainnet', deploymentId: 'ignite', deploymentRevision: 1n,
      host: 'https://icp-api.io', networkKind: 'public_mainnet', registryRevision: 1n, requiredClubAuthorities: [] }, identityId,
    { readRegistry, actors: { club, identity: vi.fn() } })).rejects.toThrow('local-only');
    expect(readRegistry).not.toHaveBeenCalled(); expect(club).not.toHaveBeenCalled();
  });
  it('does not publish identity targets when the verified registry changes between setters', async () => {
    const domains = GROUP_DOMAINS.map((domain, i) => ({ domain, canister: Principal.fromUint8Array(Uint8Array.from([i + 10, 1])) }));
    const subnet = Principal.fromText(groups[1].clubDomain);
    const snapshot = { revision: 1n, groups: [{ id: 'a', target_alias: 'local', domains }], placements: [{
      group_id: 'a', deployment_id: 'local', deployment_revision: 1n, host: 'https://icp-api.io', network_kind: 'public_mainnet',
      primary_subnet: subnet, approved_subnets: [subnet], additional_subnets_enabled: false, domains: domains.map(d => ({ ...d, subnet })),
    }] };
    let reads = 0; const publish = vi.fn(); const wire = vi.fn(async () => ({ Ok: null }));
    await expect(wireVerifiedLocalAccountAuthorities({ targetAlias: 'local', deploymentId: 'local', deploymentRevision: 1n,
      host: 'https://icp-api.io', networkKind: 'public_mainnet', registryRevision: 1n, requiredClubAuthorities: [domains[0].canister.toText()] }, identityId,
    { readRegistry: async () => ({ ...snapshot, revision: ++reads > 2 ? 2n : 1n }),
      actors: { club: () => ({ set_identity_access_canister: wire }), identity: () => ({ set_club_authorities: publish }) },
    })).rejects.toThrow('stale');
    expect(wire).toHaveBeenCalledOnce(); expect(publish).not.toHaveBeenCalled();
  });
});