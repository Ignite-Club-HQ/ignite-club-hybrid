import type { FeatureBackendContext } from './featureRouter';
import { withFeatureBackend } from './featureRouter';
import { readMiniLeagueInScope } from './miniLeagueRouting';
import { readMembershipInScope } from './membershipRouting';

export async function readLeagueAccess(ctx: FeatureBackendContext, id: string) {
  return readMiniLeagueInScope(ctx, { miniLeagueId: id }, async scoped => {
    const { connectLiveMiniLeagueDomain } = await import('./domains');
    const { actor } = await connectLiveMiniLeagueDomain(scoped.target, scoped.identity);
    const result = await actor.get_my_league_access([id]);
    if ('Err' in result) throw new Error(result.Err);
    const access = result.Ok.find(row => row.id === id);
    if (!access) throw new Error('League not found or not visible');
    return access;
  });
}

export async function readLeagueMembers(ctx: FeatureBackendContext, id: string) {
  const members = await readMiniLeagueInScope(ctx, { miniLeagueId: id }, async scoped => {
    const { connectLiveMiniLeagueDomain } = await import('./domains');
    const { actor } = await connectLiveMiniLeagueDomain(scoped.target, scoped.identity);
    const result = await actor.get_league_members(id);
    if ('Err' in result) throw new Error(result.Err);
    return result.Ok;
  });
  const profiles = await withFeatureBackend('membership', {
    supabase: async () => { throw new Error('Canister profiles require Internet Identity'); },
    icp: async shared => (await import('./features/identityAccessClient')).listLiveProfilesByIds(shared, members.map(m => m.user_id)),
  }, { shared: 'person' });
  const byId = new Map(profiles.map(p => [p.account_id, p]));
  return members.map(m => ({
    id: m.user_id,
    display_name: byId.get(m.user_id)?.display_name ?? null,
    avatar_url: byId.get(m.user_id)?.avatar_ref[0] ?? null,
    role: m.is_staff ? 'league_admin' : 'parent',
    isAlsoParent: m.is_parent && m.is_staff,
  }));
}

export async function readManageableLeagues(ctx: FeatureBackendContext) {
  const { listMyLiveMiniLeagues } = await import('./features/miniLeagues');
  const leagues = await listMyLiveMiniLeagues(ctx);
  if (!leagues.length) return [];
  const { connectLiveMiniLeagueDomain } = await import('./domains');
  const { actor } = await connectLiveMiniLeagueDomain(ctx.target, ctx.identity);
  const allowed = new Set<string>();
  for (let offset = 0; offset < leagues.length; offset += 200) {
    const result = await actor.get_my_league_access(leagues.slice(offset, offset + 200).map(l => l.id));
    if ('Err' in result) throw new Error(result.Err);
    for (const row of result.Ok) if (row.can_manage) allowed.add(row.id);
  }
  return leagues.filter(l => allowed.has(l.id));
}

export async function readLeagueClub(ctx: FeatureBackendContext, clubId: string) {
  return readMembershipInScope(ctx, { clubId }, async scoped => {
    const rows = await (await import('./features/club')).getLiveClubProfile(scoped, clubId);
    return rows[0] ?? null;
  });
}

export async function readLeagueEvents(ctx: FeatureBackendContext, leagueId: string, clubId: string) {
  const events = await withFeatureBackend('events', {
    supabase: async () => { throw new Error('Canister events require Internet Identity'); },
    icp: async scoped => (await import('./features/events')).listLiveEvents(scoped, clubId),
  }, { clubId });
  return Promise.all(events.filter(e => e.mini_league_id[0] === leagueId && !e.deleted).sort((a, b) => Number(b.starts_at_ms) - Number(a.starts_at_ms)).map(async event => {
    const allocations = await withFeatureBackend('events', {
      supabase: async () => { throw new Error('Canister groups require Internet Identity'); },
      icp: async scoped => {
        const api = await import('./features/events');
        const groups = await api.listLiveEventGroups(scoped, event.id);
        const players = await Promise.all(groups.map(g => api.listLiveGroupPlayers(scoped, g.id)));
        return players.reduce((count, rows) => count + rows.length, 0);
      },
    }, { eventId: event.id });
    return {
      id: event.id, title: event.title, event_date: new Date(Number(event.starts_at_ms)).toISOString(),
      start_time: new Date(Number(event.starts_at_ms)).toISOString(),
      end_time: event.ends_at_ms ? new Date(Number(event.ends_at_ms)).toISOString() : null,
      location_name: event.location[0] ?? null, is_cancelled: event.cancelled,
      final_score_home: null, final_score_away: null, _allocatedPlayers: allocations,
    };
  }));
}