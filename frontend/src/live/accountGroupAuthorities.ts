import { Principal } from '@icp-sdk/core/principal';

type Result = { Ok: unknown } | { Err: string };
export type AccountAuthorityGroup = { groupId: string; clubDomain: string };
type Actors = {
  club(id: string): { set_identity_access_canister(id: Principal): Promise<Result> };
  identity(id: string): { set_club_authorities(ids: Principal[]): Promise<Result> };
};

/** Governor-only composition; input must be the complete approved deployment
 * inventory, including legacy/shared groups. Never caller membership discovery. */
export async function wireAccountGroupAuthorities(groups: readonly AccountAuthorityGroup[], identityId: string, actors: Actors): Promise<void> {
  if (!groups.length || groups.length > 64) throw new Error('Complete bounded group inventory required');
  if (new Set(groups.map(g => g.groupId)).size !== groups.length || new Set(groups.map(g => g.clubDomain)).size !== groups.length) throw new Error('Duplicate account authority');
  const identity = Principal.fromText(identityId);
  const clubs = groups.map(g => Principal.fromText(g.clubDomain));
  if (identity.isAnonymous() || clubs.some(p => p.isAnonymous())) throw new Error('Anonymous authority');
  const check = (r: Result) => { if ('Err' in r) throw new Error(r.Err); };
  for (const group of groups) check(await actors.club(group.clubDomain).set_identity_access_canister(identity));
  check(await actors.identity(identityId).set_club_authorities(clubs));
}