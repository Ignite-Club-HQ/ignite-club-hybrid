import type { FeatureBackendContext } from './featureRouter';
import { withFeatureBackend } from './featureRouter';
import { readMembershipInScope } from './membershipRouting';
import { mergeMiniLeagueRows } from './miniLeagueRouting';
import { readLeagueClub, readManageableLeagues } from './leagueReads';

export async function readLiveInviteTargets(ctx: FeatureBackendContext) {
  const { getLiveMyRoleGrants } = await import('./features/membership');
  const grants = await getLiveMyRoleGrants(ctx);
  const [miniLeagues, competitions] = await Promise.all([
    withFeatureBackend('mini_leagues', {
      supabase: async () => { throw new Error('Internet Identity required'); },
      icp: readManageableLeagues,
    }, { everyGroup: true, merge: mergeMiniLeagueRows }),
    withFeatureBackend('competitions', {
      supabase: async () => { throw new Error('Internet Identity required'); },
      icp: async scoped => (await import('./features/competitions')).listLiveMyNewsCompetitions(scoped),
    }, { everyGroup: true, merge: (parts) => [...new Map(parts.flat().map(row => [row.id, row])).values()] }),
  ]);
  const teamIds = [...new Set(grants.flatMap(g => g.team))];
  const teams = (await Promise.all(teamIds.map(teamId => readMembershipInScope(ctx, { teamId }, async scoped => {
    return (await (await import('./features/club')).getLiveTeam(scoped, teamId))[0] ?? null;
  })))).filter(t => t?.is_active);
  const clubIds = [...new Set([
    ...grants.flatMap(g => g.club), ...miniLeagues.map(l => l.club_id),
    ...teams.flatMap(t => t ? [t.club_id] : []), ...competitions.flatMap(c => c.club_id ? [c.club_id] : []),
  ])];
  const clubs = (await Promise.all(clubIds.map(id => readLeagueClub(ctx, id))))
    .filter(c => c?.is_active).map(c => ({ id: c?.id ?? '', name: c?.name ?? '' }));
  const names = new Map(clubs.map(c => [c.id, c.name]));
  return {
    clubs: clubs.sort((a, b) => a.name.localeCompare(b.name)),
    teams: teams.flatMap(t => t ? [{ ...t, clubs: { id: t.club_id, name: names.get(t.club_id) ?? '' } }] : []).sort((a, b) => a.name.localeCompare(b.name)),
    miniLeagues: miniLeagues.sort((a, b) => a.name.localeCompare(b.name)),
    competitions: competitions.map(c => ({ ...c, organizer_club_id: c.club_id, organizer_club: { name: names.get(c.club_id) ?? '' } })).sort((a, b) => a.name.localeCompare(b.name)),
  };
}