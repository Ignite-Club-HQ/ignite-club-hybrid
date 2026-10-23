import type { FeatureBackendContext } from './featureRouter';
import { readMembershipInScope } from './membershipRouting';
import { readContentInScope } from './contentRouting';
import { assertReadNotAborted, withReadDeadline } from './readDeadline';
import { getLiveMyRoleGrants } from './features/membership';
import { getLiveTeam, getLiveClubProfile, getLiveTeamSubscription } from './features/club';
import { listMyLiveMiniLeagues, listLiveMiniLeaguesByClub, getLiveMiniLeague } from './features/miniLeagues';

export interface CarouselItem {
  id: string; name: string; logo_url: string | null; club_logo_url: string | null;
  type: 'team' | 'league' | 'competition'; club_name: string; sport: string | null;
  club_id: string; canManage: boolean; isOnTrial?: boolean; competitionTeamsLabel?: string;
}
/** Display progress is provisional; every destination still verifies access. */
export async function fetchIcpCarouselItems(ctx: FeatureBackendContext, clubFilter: string | null,
  onProgress?: (items: CarouselItem[]) => void, signal?: AbortSignal): Promise<{ items: CarouselItem[]; incomplete: boolean }> {
  const read = <T,>(promise: Promise<T>, label: string) => withReadDeadline(promise, label, 20_000, signal);
  const grants = await read(getLiveMyRoleGrants(ctx), 'Carousel memberships');
  const items = new Map<string, CarouselItem>();
  let incomplete = false;
  const snapshot = () => [...items.values()].sort((a, b) => Number(b.canManage) - Number(a.canManage) || a.type.localeCompare(b.type) || a.name.localeCompare(b.name));
  const publish = () => { assertReadNotAborted(signal); onProgress?.(snapshot()); };
  const meta = new Map<string, Promise<Awaited<ReturnType<typeof getLiveClubProfile>>[number] | undefined>>();
  const club = (id: string) => {
    let value = meta.get(id);
    if (!value) {
      value = read(readMembershipInScope(ctx, { clubId: id }, scoped => getLiveClubProfile(scoped, id)), 'Carousel club').then(rows => rows[0]);
      meta.set(id, value);
    }
    return value;
  };
  const enrich = async (item: CarouselItem) => {
    try {
      const profile = await club(item.club_id);
      if (profile?.deleted_at_ms.length) items.delete(`${item.type}:${item.id}`);
      else if (profile) items.set(`${item.type}:${item.id}`, { ...item, ...items.get(`${item.type}:${item.id}`), club_name: profile.name, club_logo_url: profile.logo_url[0] ?? null, sport: profile.sport[0] ?? null });
      publish();
    } catch { assertReadNotAborted(signal); incomplete = true; }
  };
  const teams = [...new Set(grants.flatMap(g => g.team[0] ? [g.team[0]] : []))];
  const teamTask = Promise.all(teams.map(async id => {
    try {
      const owner = grants.find(g => g.team[0] === id && g.club[0])?.club[0];
      const [team] = await read(readMembershipInScope(ctx, owner ? { clubId: owner } : { teamId: id }, scoped => getLiveTeam(scoped, id)), 'Carousel team');
      if (!team || team.archived || team.deleted_at_ms.length || (clubFilter && team.club_id !== clubFilter)) return;
      const item: CarouselItem = { id, name: team.name, logo_url: team.logo_url[0] ?? null, club_logo_url: null,
        club_name: '', sport: null, club_id: team.club_id, type: 'team',
        canManage: grants.some(g => (g.team[0] === id && ['coach', 'team_admin'].includes(g.role)) || (g.club[0] === team.club_id && ['club_admin', 'app_admin'].includes(g.role))) };
      items.set(`team:${id}`, item); publish();
      await Promise.all([enrich(item), (async () => {
        try {
          const sub = await read(readMembershipInScope(ctx, { clubId: team.club_id }, scoped => getLiveTeamSubscription(scoped, id)), 'Carousel trial');
          const current = items.get(`team:${id}`);
          if (current) { items.set(`team:${id}`, { ...current, isOnTrial: !!(sub?.is_pro && sub.trial_ends_at_ms.length) }); publish(); }
        } catch { assertReadNotAborted(signal); incomplete = true; }
      })()]);
    } catch { assertReadNotAborted(signal); incomplete = true; }
  }));
  const leaguesTask = (async () => {
    const adminClubs = [...new Set(grants.flatMap(g => g.role === 'league_admin' && g.club[0] ? [g.club[0]] : []))].filter(id => !clubFilter || id === clubFilter);
    const mine = read(readContentInScope(ctx, 'mini_leagues', { memberGroups: true, merge: parts => parts.flat() }, listMyLiveMiniLeagues), 'Carousel leagues');
    const lists = await Promise.allSettled([mine, ...adminClubs.map(id => read(readContentInScope(ctx, 'mini_leagues', { clubId: id }, scoped => listLiveMiniLeaguesByClub(scoped, id)), 'Carousel club leagues'))]);
    const leagues = new Map<string, { id: string; club_id: string }>();
    for (const result of lists) {
      if (result.status === 'rejected') { incomplete = true; continue; }
      for (const row of result.value) if (!clubFilter || row.club_id === clubFilter) leagues.set(row.id, row);
    }
    await Promise.all([...leagues.values()].map(async row => {
      try {
        const league = await read(readContentInScope(ctx, 'mini_leagues', { miniLeagueId: row.id }, scoped => getLiveMiniLeague(scoped, row.id)), 'Carousel league');
        if (league.status === 'deleted' || league.status === 'archived') return;
        const item: CarouselItem = { id: league.id, name: league.name, logo_url: league.logo_url[0] ?? null, club_logo_url: null,
          club_name: '', sport: null, club_id: league.club_id, type: 'league', canManage: adminClubs.includes(league.club_id) };
        items.set(`league:${item.id}`, item); publish(); await enrich(item);
      } catch { assertReadNotAborted(signal); incomplete = true; }
    }));
  })();
  await Promise.all([teamTask, leaguesTask]);
  assertReadNotAborted(signal);
  return { items: snapshot(), incomplete };
}