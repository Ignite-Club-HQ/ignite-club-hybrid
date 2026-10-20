import { Principal } from '@icp-sdk/core/principal';
import { accountAuthoritiesFromRegistry, type AccountRegistryBinding, type AccountRegistrySnapshot } from './accountAuthorityRegistry';

type Result = { Ok: unknown } | { Err: string };
export type AccountAuthorityGroup = { groupId: string; clubDomain: string };
type Actors = {
  club(id: string): { set_identity_access_canister(id: Principal): Promise<Result> };
  identity(id: string): { set_club_authorities(ids: Principal[]): Promise<Result> };
};

/** Governor-only composition; input must be the complete approved deployment
 * inventory, including legacy/shared groups. Never caller membership discovery. */
export async function wireAccountGroupAuthorities(groups: readonly AccountAuthorityGroup[], identityId: string, actors: Actors): Promise<void> {
  if (!groups.length || groups.length > 4096) throw new Error('Complete bounded group inventory required');
  if (new Set(groups.map(g => g.groupId)).size !== groups.length || new Set(groups.map(g => g.clubDomain)).size !== groups.length) throw new Error('Duplicate account authority');
  const identity = Principal.fromText(identityId);
  const clubs = groups.map(g => Principal.fromText(g.clubDomain));
  if (identity.isAnonymous() || clubs.some(p => p.isAnonymous())) throw new Error('Anonymous authority');
  const check = (r: Result) => { if ('Err' in r) throw new Error(r.Err); };
  for (const group of groups) check(await actors.club(group.clubDomain).set_identity_access_canister(identity));
  check(await actors.identity(identityId).set_club_authorities(clubs));
}

/** Local rehearsal only. Re-read the consensus registry before each setter;
 * any concurrent placement change stops publishing the authority inventory.
 * This is NOT all-domain revocation attestation or a production release gate. */
export async function wireVerifiedLocalAccountAuthorities(binding: AccountRegistryBinding, identityId: string,
  deps: { readRegistry(): Promise<AccountRegistrySnapshot>; actors: Actors }) {
  if (binding.targetAlias !== 'local' || binding.deploymentId !== 'local') throw new Error('Account authority wiring remains local-only');
  const groups = accountAuthoritiesFromRegistry(await deps.readRegistry(), binding);
  const expected = JSON.stringify(groups);
  const unchanged = async () => {
    const current = accountAuthoritiesFromRegistry(await deps.readRegistry(), binding);
    if (JSON.stringify(current) !== expected) throw new Error('Account authority inventory changed');
  };
  await wireAccountGroupAuthorities(groups, identityId, {
    club: id => ({ set_identity_access_canister: async principal => {
      await unchanged(); return deps.actors.club(id).set_identity_access_canister(principal);
    } }),
    identity: id => ({ set_club_authorities: async principals => {
      await unchanged(); return deps.actors.identity(id).set_club_authorities(principals);
    } }),
  });
  await unchanged();
}