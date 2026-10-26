import type { FeatureBackendContext } from './featureRouter';
import { withFeatureBackend } from './featureRouter';
import { readMiniLeagueInScope } from './miniLeagueRouting';
import { readMembershipInScope } from './membershipRouting';
import { readRelationshipProfiles } from './relationshipProfileRead';

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
  const { members, profiles } = await readMiniLeagueInScope(ctx, { miniLeagueId: id }, async scoped => {
    const { connectLiveMiniLeagueDomain } = await import('./domains');
    const { actor } = await connectLiveMiniLeagueDomain(scoped.target, scoped.identity);
    const result = await actor.get_league_members(id);
    if ('Err' in result) throw new Error(result.Err);
    const members = result.Ok;
    const profiles = await readRelationshipProfiles(scoped, members.map(m => m.user_id), { kind: 'league', resource: id });
    return { members, profiles };
  });
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
/** League/player association uses league-player IDs, never parent principal IDs. */
export async function readLiveLeagueMemberships(ctx: FeatureBackendContext) {
  const { listMyLiveMiniLeagues } = await import('./features/miniLeagues');
  const leagues = await listMyLiveMiniLeagues(ctx);
  const access = await Promise.all(leagues.map(l => readLeagueAccess(ctx, l.id)));
  const adminLeagueIds = leagues.filter((_, i) => access[i]?.can_manage).map(l => l.id);
  return { allLeagueIds: leagues.map(l => l.id), adminLeagueIds, parentLeagueIds: leagues.filter(l => !adminLeagueIds.includes(l.id)).map(l => l.id), isAppAdmin: false };
}

export async function readLiveLeagueMatches(ctx: FeatureBackendContext, ids: string[], clubFilter?: string | null) {
  const leagueApi = await import('./features/miniLeagues');
  const matches = [];
  for (const id of ids) {
    const league = await readMiniLeagueInScope(ctx, { miniLeagueId: id }, scoped => leagueApi.getLiveMiniLeague(scoped, id));
    if (clubFilter && league.club_id !== clubFilter) continue;
    const [access, roster] = await Promise.all([readLeagueAccess(ctx, id), readMiniLeagueInScope(ctx, { miniLeagueId: id }, scoped => leagueApi.listLivePlayers(scoped, id))]);
    const events = await withFeatureBackend('events', { supabase: async () => { throw new Error('Internet Identity required'); }, icp: scoped => import('./features/events').then(api => api.listLiveEvents(scoped, league.club_id)) }, { clubId: league.club_id });
    for (const event of events.filter(e => !e.deleted && !e.cancelled && e.mini_league_id[0] === id)) {
      const rows = await withFeatureBackend('events', { supabase: async () => { throw new Error('Internet Identity required'); }, icp: async scoped => {
        const api = await import('./features/events');
        const groups = await api.listLiveEventGroups(scoped, event.id);
        return Promise.all(groups.map(async group => {
          const timer = group.timer_state_json[0] ? JSON.parse(group.timer_state_json[0]) : null;
          if (!timer || timer.isGameFinished || !(timer.isRunning || timer.elapsedSeconds > 0 || timer.currentHalf > 1)) return null;
          const [links, duties, canEdit] = await Promise.all([api.listLiveGroupPlayers(scoped, group.id), api.listLiveGroupDuties(scoped, group.id), api.getLiveGroupEditAccess(scoped, group.id)]);
          const principal = scoped.identity.getPrincipal().toText();
          const players = links.map(link => { const player = roster.find(p => p.id === link.account_id); if (!player) throw new Error('Match player missing from league'); return { id: player.id, name: player.name, team: (link.team_letter[0] ?? null) as 'a' | 'b' | null }; });
          const ownPlayer = links.some(link => roster.some(p => p.id === link.account_id && (p.parent_user_id[0] === principal || p.claimed_by[0]?.toText() === principal)));
          const ownDuties = duties.filter(d => d.account_id[0] === principal);
          if (!access.can_manage && !ownPlayer && !ownDuties.length) return null;
          const pitch = group.pitch_state_json[0] ? JSON.parse(group.pitch_state_json[0]) : {};
          const goals = Array.isArray(pitch.goals) ? pitch.goals : [];
          return { id: group.id, name: group.name, eventId: event.id, eventTitle: event.title, leagueId: id, leagueName: league.name, clubId: league.club_id, timerState: timer, pitchState: pitch, players, teamAColor: group.colour[0] ?? 'red', teamBColor: group.team_b_colour[0] ?? 'blue', teamAScore: goals.filter((g: { teamSide?: string }) => g.teamSide === 'a').length, teamBScore: goals.filter((g: { teamSide?: string }) => g.teamSide === 'b').length, isAdmin: canEdit, isReferee: ownDuties.some(d => d.duty === 'Referee'), minutesPerHalf: league.minutes_per_half };
        }));
      } }, { eventId: event.id });
      for (const row of rows) if (row) matches.push(row);
    }
  }
  return matches;
}
