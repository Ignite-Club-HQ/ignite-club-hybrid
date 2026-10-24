import { supabase } from '@/integrations/supabase/client';
import { withFeatureBackend } from '@/live/featureRouter';
import { readContentInScope } from '@/live/contentRouting';

export type GameEventRow = { id: string; time: number; cancelled: boolean; deleted: boolean };
export function nearestGame(events: GameEventRow[], now: number, linked?: string | null) {
  const rows = events.filter(e => !e.cancelled && !e.deleted && Number.isFinite(e.time) && e.time >= now - 3 * 60 * 60_000 && e.time <= now + 2 * 60 * 60_000);
  if (linked && rows.some(e => e.id === linked)) return linked;
  rows.sort((a, b) => Math.abs(a.time - now) - Math.abs(b.time - now) || Number(b.time >= now) - Number(a.time >= now) || a.id.localeCompare(b.id));
  return rows[0]?.id ?? null;
}
export function recentGame(events: GameEventRow[], now: number) {
  return events.some(e => !e.cancelled && !e.deleted && Number.isFinite(e.time) && e.time <= now && e.time >= now - 48 * 60 * 60_000);
}
export async function readIcpGameEvents(teamId?: string | null, miniLeagueId?: string | null): Promise<GameEventRow[]> {
  if (!teamId && !miniLeagueId) return [];
  return withFeatureBackend('events', {
    supabase: async () => { throw new Error('ICP game read required'); },
    icp: async ctx => {
      const { listLiveEvents } = await import('@/live/features/events');
      const { getLiveTeam } = await import('@/live/features/club');
      const { getLiveMiniLeague } = await import('@/live/features/miniLeagues');
      const clubId = teamId ? (await getLiveTeam(ctx, teamId))[0]?.club_id : (await getLiveMiniLeague(ctx, miniLeagueId ?? ''))?.club_id;
      if (!clubId) throw new Error('Game club could not be verified');
      const events = await readContentInScope(ctx, 'events', { clubId }, scoped => listLiveEvents(scoped, clubId, null));
      return events.filter(e => e.event_type === 'game' && ((teamId && e.team_id[0] === teamId) || (miniLeagueId && e.mini_league_id[0] === miniLeagueId)))
        .map(e => ({ id: e.id, time: Number(e.starts_at_ms), cancelled: e.cancelled, deleted: e.deleted }));
    },
  }, teamId ? { teamId } : { miniLeagueId: miniLeagueId ?? '' });
}
export async function readGoingGameRsvps(eventId: string) {
  return withFeatureBackend('events', {
    supabase: async () => {
      const { data, error } = await supabase.from('rsvps').select('user_id, child_id').eq('event_id', eventId).eq('status', 'going');
      if (error) throw error;
      return data ?? [];
    },
    icp: async ctx => {
      const { getLiveEventRosterDetailed } = await import('@/live/features/events');
      const rows = await getLiveEventRosterDetailed(ctx, eventId);
      return rows.rsvps.filter(row => row.rsvp.state === 'going').map(row => ({ user_id: row.rsvp.account_id, child_id: row.rsvp.child_id[0] ?? null }));
    },
  }, { eventId });
}
export async function readGameSubsDuty(eventId: string, userId: string) {
  return withFeatureBackend('events', {
    supabase: async () => {
      const { data, error } = await supabase.from('duties').select('name').eq('event_id', eventId).eq('assigned_to', userId);
      if (error) throw error;
      return (data ?? []).some(d => d.name.trim().toLowerCase() === 'subs manager');
    },
    icp: async ctx => {
      const { listLiveDuties } = await import('@/live/features/events');
      return (await listLiveDuties(ctx, eventId)).some(d => d.account_id.replace(/^principal:/, '') === userId.replace(/^principal:/, '') && d.duty.trim().toLowerCase() === 'subs manager');
    },
  }, { eventId });
}