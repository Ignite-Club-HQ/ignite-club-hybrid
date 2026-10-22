import { format } from 'date-fns';
import type { FeatureBackendContext } from './featureRouter';
import { readContentInScope } from './contentRouting';
import { readMembershipInScope } from './membershipRouting';
import { getLiveClubProfile, getLiveTeam } from './features/club';
import { listLiveEvents, listLiveEventDutyTeams } from './features/events';
import { scheduleTimestampDate } from '@/lib/scheduleDates';

export type MemberScheduleEvent = {
  id: string; title: string; type: 'game' | 'training' | 'social'; event_date: string;
  address: string | null; suburb: null; location_name: string | null; club_id: string;
  team_id: string | null; duty_team_id: string | null; mini_league_id: string | null;
  is_cancelled: boolean; is_bye: false; is_recurring: boolean; parent_event_id: null;
  opponent: string | null; teams: { name: string } | null; clubs: { name: string; sport: string | null };
  start_time: string; end_time: string; description: string; updated_at: string;
};
export type MemberScheduleSnapshot = { events: MemberScheduleEvent[]; incomplete: boolean; pending: number; failed: string[] };
export type MemberScheduleScope = { clubIds: string[]; teamIds: string[]; adminClubIds: string[];
  selectedTeamId: string | null; filter: string; fromMs: number; toMs: number };

/** Authorized event rows publish before labels/duties, per owning club. A
 * refused source is never a successfully empty source or an offline snapshot. */
export async function loadMemberSchedule(ctx: FeatureBackendContext, scope: MemberScheduleScope,
  onUpdate?: (snapshot: MemberScheduleSnapshot) => void): Promise<MemberScheduleSnapshot> {
  const ids = [...new Set(scope.clubIds)];
  const rows = new Map<string, MemberScheduleEvent[]>();
  const failed = new Set<string>();
  const names = new Map<string, Promise<string>>();
  let pending = ids.length;
  let successful = 0;
  let firstError: unknown;
  const snapshot = (): MemberScheduleSnapshot => ({ events: [...new Map([...rows.values()].flat().map(row => [row.id, row])).values()]
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.id.localeCompare(b.id)),
    incomplete: pending > 0 || failed.size > 0, pending, failed: [...failed] });
  const publish = () => onUpdate?.(snapshot());
  const teamName = (id: string) => {
    const hit = names.get(id); if (hit) return hit;
    const read = readMembershipInScope(ctx, { teamId: id }, scoped => getLiveTeam(scoped, id))
      .then(value => value[0]?.name ?? 'Team').catch(() => { failed.add(`team:${id}`); return 'Team'; });
    names.set(id, read); return read;
  };
  await Promise.all(ids.map(async clubId => {
    try {
      const raw = await readContentInScope(ctx, 'events', { clubId }, scoped => listLiveEvents(scoped, clubId, scope.selectedTeamId));
      successful++;
      const visible = raw.flatMap(event => {
        const start = scheduleTimestampDate(event.starts_at_ms);
        const teamId = event.team_id[0] ?? null;
        if (event.deleted || !start || start.getTime() < scope.fromMs || start.getTime() > scope.toMs ||
          (scope.filter !== 'all' && event.event_type !== scope.filter) ||
          (teamId && !scope.teamIds.includes(teamId) && !scope.adminClubIds.includes(clubId))) return [];
        const end = scheduleTimestampDate(event.ends_at_ms) ?? start;
        return [{ id: event.id, title: event.title, type: event.event_type as MemberScheduleEvent['type'], event_date: format(start, 'yyyy-MM-dd'),
          address: event.address[0] ?? null, suburb: null, location_name: event.location[0] ?? null,
          club_id: event.club_id, team_id: teamId, duty_team_id: null, mini_league_id: event.mini_league_id[0] ?? null,
          is_cancelled: event.cancelled, is_bye: false, is_recurring: event.series_id.length > 0, parent_event_id: null,
          opponent: event.opponent[0] ?? null, teams: teamId ? { name: 'Team' } : null, clubs: { name: 'Club', sport: null },
          start_time: format(start, 'HH:mm'), end_time: format(end, 'HH:mm'), description: event.description,
          updated_at: (scheduleTimestampDate(event.updated_at_ms) ?? start).toISOString(),
        } satisfies MemberScheduleEvent];
      });
      rows.set(clubId, visible); publish();
      if (!visible.length) return;
      // Each ancillary reply updates only this club; slow names cannot delay
      // event visibility, and duties never query an unrelated group's actor.
      await Promise.all([
        readMembershipInScope(ctx, { clubId }, scoped => getLiveClubProfile(scoped, clubId)).then(value => {
          const profile = value[0];
          rows.set(clubId, (rows.get(clubId) ?? []).map(row => ({ ...row, clubs: { name: profile?.name ?? 'Club', sport: profile?.sport[0] ?? null } })));
          publish();
        }).catch(() => { failed.add(`profile:${clubId}`); }),
        readContentInScope(ctx, 'events', { clubId }, scoped => listLiveEventDutyTeams(scoped, visible.map(row => row.id))).then(value => {
          const duties = new Map(value.map(row => [row.event_id, row.team_id]));
          rows.set(clubId, (rows.get(clubId) ?? []).map(row => ({ ...row, duty_team_id: duties.get(row.id) ?? null })));
          publish();
        }).catch(() => { failed.add(`duties:${clubId}`); }),
        ...[...new Set(visible.flatMap(row => row.team_id ? [row.team_id] : []))].map(async teamId => {
          const name = await teamName(teamId);
          rows.set(clubId, (rows.get(clubId) ?? []).map(row => row.team_id === teamId ? { ...row, teams: { name } } : row)); publish();
        }),
      ]);
    } catch (error) { failed.add(`club:${clubId}`); firstError ??= error; }
    finally { pending--; publish(); }
  }));
  if (ids.length && !successful) throw firstError instanceof Error ? firstError : new Error('Club events could not be loaded');
  return snapshot();
}