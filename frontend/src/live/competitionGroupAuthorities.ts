import { Principal } from '@icp-sdk/core/principal';
import type { Provision } from './groupProvisioner';
type Group = { groupId: string; clubDomain: string; competitionDomain: string };
type ActorSet = {
  club(id: string): { set_competition_authorities(ids: Principal[]): Promise<{ Ok: unknown } | { Err: string }> };
  competition(id: string): { set_participant_club_authorities(ids: Principal[]): Promise<{ Ok: unknown } | { Err: string }> };
};
/** Governor-only deployment adapter. Supply the complete same-deployment
 * inventory, not browser member groups; call before enabling any new group. */
export async function wireCompetitionGroupAuthorities(groups: readonly Group[], actors: ActorSet): Promise<void> {
  if (!groups.length || groups.length > 64) throw new Error('Complete bounded group inventory required');
  if (new Set(groups.map(g => g.groupId)).size !== groups.length || new Set(groups.map(g => g.clubDomain)).size !== groups.length || new Set(groups.map(g => g.competitionDomain)).size !== groups.length) throw new Error('Duplicate group authority');
  const clubs = groups.map(g => Principal.fromText(g.clubDomain));
  const competitions = groups.map(g => Principal.fromText(g.competitionDomain));
  const check = (r: { Ok: unknown } | { Err: string }) => { if ('Err' in r) throw new Error(r.Err); };
  for (const g of groups) check(await actors.club(g.clubDomain).set_competition_authorities(competitions));
  for (const g of groups) check(await actors.competition(g.competitionDomain).set_participant_club_authorities(clubs));
}
export function provisionCompetitionAuthority(p: Provision): Group {
  const clubDomain = p.canisters.club_domain, competitionDomain = p.canisters.competition_domain;
  if (!clubDomain || !competitionDomain) throw new Error('Incomplete group authority');
  return { groupId: p.groupId, clubDomain, competitionDomain };
}