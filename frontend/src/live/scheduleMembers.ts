import { format } from 'date-fns';
import type { FeatureBackendContext } from './featureRouter';
import { readContentInScope } from './contentRouting';
import { readMembershipInScope } from './membershipRouting';
import { getLiveClubProfile, getLiveTeam } from './features/club';
import { listLiveEvents, listLiveEventDutyTeams } from './features/events';
import { assertReadNotAborted, withReadDeadline } from './readDeadline';
import { scheduleTimestampDate } from '@/lib/scheduleDates';
import { getCachedTeam } from '@/lib/clubTeamCache';

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
  onUpdate?: (snapshot: MemberScheduleSnapshot) => void, signal?: AbortSignal): Promise<MemberScheduleSnapshot> {
  const read = <T,>(value: Promise<T>, label: string) => withReadDeadline(value, label, 20_000, signal);
  // Cold group discovery may perform several consensus reads before reaching
  // the events actor. Its time must not consume the actor's entire deadline.
  // Bound coordination separately; still refuse real routing/service failures.
  const eventRead = async <T,>(clubId: string, label: string, action: (scoped: FeatureBackendContext) => Promise<T>) => {
    let retired = false;
    try {
      return await withReadDeadline(readContentInScope(ctx, 'events', { clubId }, scoped => {
        assertReadNotAborted(signal);
        if (retired) throw new Error(`${label} connection expired`);
        return read(action(scoped), label);
      }), `${label} connection`, 60_000, signal);
    } finally { retired = true; }
  };
  // Same split for display labels: cold group discovery right after sign-in
  // used to eat the whole 20s label deadline, so every login showed
  // "names could not be retrieved" even though the services were fine.
  const metaRead = async <T,>(clubId: string, label: string, action: (scoped: FeatureBackendContext) => Promise<T>) => {
    let retired = false;
    try {
      return await withReadDeadline(readMembershipInScope(ctx, { clubId }, scoped => {
        assertReadNotAborted(signal);
        if (retired) throw new Error(`${label} connection expired`);
        return read(action(scoped), label);
      }), `${label} connection`, 60_000, signal);
    } finally { retired = true; }
  };
  // One quiet retry for transient first-read failures before reporting.
  const once = async <T,>(source: string, attempt: () => Promise<T>): Promise<T> => {
    try { return await attempt(); } catch (first) {
      assertReadNotAborted(signal);
      const firstText = first instanceof Error ? first.message : String(first);
      // A stall already spent its deadline and a refusal is a real answer:
      // report those at once instead of doubling the wait.
      if (/timed?\s*out|deadline|expired|denied|unauthori[sz]ed|forbidden|not a member|membership/i.test(firstText)) {
        console.warn('[schedule] source failed', source, firstText);
        throw first;
      }
      await new Promise(resolve => setTimeout(resolve, 750));
      assertReadNotAborted(signal);
      try { return await attempt(); } catch (error) {
        console.warn('[schedule] source failed', source, error instanceof Error ? error.message : String(error), '| first:', first instanceof Error ? first.message : String(first));
        throw error;
      }
    }
  };
  const ids = [...new Set(scope.clubIds)];
  const rows = new Map<string, MemberScheduleEvent[]>();
  const failed = new Set<string>();
  const names = new Map<string, Promise<string | null>>();
  const pendingTeamNames = new Set<string>();
  const teamKey = (clubId: string, teamId: string) => JSON.stringify([clubId, teamId]);
  let pending = ids.length;
  let successful = 0;
  let firstError: unknown;
  const snapshot = (): MemberScheduleSnapshot => ({ events: [...new Map([...rows.values()].flat()
    .filter(row => !row.team_id || !pendingTeamNames.has(teamKey(row.club_id, row.team_id)))
    .map(row => [row.id, row])).values()]
    .sort((a, b) => a.event_date.localeCompare(b.event_date) || a.id.localeCompare(b.id)),
    incomplete: pending > 0 || failed.size > 0, pending, failed: [...failed] });
  const publish = () => { assertReadNotAborted(signal); onUpdate?.(snapshot()); };
  const teamName = (id: string, clubId: string) => {
    const key = teamKey(clubId, id);
    const hit = names.get(key); if (hit) return hit;
    const promise = once(`team:${id}`, () => metaRead(clubId, 'Schedule team name', scoped => getLiveTeam(scoped, id)))
      .then(value => {
        const name = value[0]?.name?.trim();
        if (!name) failed.add(`team:${id}`);
        return name || null;
      }).catch(() => { failed.add(`team:${id}`); return null; });
    names.set(key, promise); return promise;
  };
  await Promise.all(ids.map(async clubId => {
    try {
      const raw = await once(`club:${clubId}`, () => eventRead(clubId, 'Schedule events', scoped => listLiveEvents(scoped, clubId, scope.selectedTeamId)));
      successful++;
      const visible = raw.flatMap<MemberScheduleEvent>(event => {
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
          opponent: event.opponent[0] ?? null, teams: null, clubs: { name: 'Club', sport: null },
          start_time: format(start, 'HH:mm'), end_time: format(end, 'HH:mm'), description: event.description,
          updated_at: (scheduleTimestampDate(event.updated_at_ms) ?? start).toISOString(),
        } satisfies MemberScheduleEvent];
      });
      // Metadata is display-only and only applied after the authorized event
      // has supplied its exact team/club. A cold team card waits for its own
      // name, not every team's name or the slower profiles/duties.
      for (const row of visible) {
        if (!row.team_id) continue;
        const cached = getCachedTeam(row.team_id);
        if (cached?.club_id === clubId && cached.name?.trim() && cached.name !== 'Team') {
          row.teams = { name: cached.name };
        } else {
          pendingTeamNames.add(teamKey(clubId, row.team_id));
        }
      }
      rows.set(clubId, visible); publish();
      if (!visible.length) return;
      // Each ancillary reply updates only this club; slow names cannot delay
      // event visibility, and duties never query an unrelated group's actor.
      await Promise.all([
        once(`profile:${clubId}`, () => metaRead(clubId, 'Schedule club name', scoped => getLiveClubProfile(scoped, clubId))).then(value => {
          const profile = value[0];
          rows.set(clubId, (rows.get(clubId) ?? []).map(row => ({ ...row, clubs: { name: profile?.name ?? 'Club', sport: profile?.sport[0] ?? null } })));
          publish();
        }).catch(() => { failed.add(`profile:${clubId}`); }),
        once(`duties:${clubId}`, () => eventRead(clubId, 'Schedule duties', scoped => listLiveEventDutyTeams(scoped, visible.map(row => row.id)))).then(value => {
          const duties = new Map(value.map(row => [row.event_id, row.team_id]));
          rows.set(clubId, (rows.get(clubId) ?? []).map(row => ({ ...row, duty_team_id: duties.get(row.id) ?? null })));
          publish();
        }).catch(() => { failed.add(`duties:${clubId}`); }),
        ...[...new Set(visible.flatMap(row => row.team_id ? [row.team_id] : []))].map(async teamId => {
          const name = await teamName(teamId, clubId);
          pendingTeamNames.delete(teamKey(clubId, teamId));
          rows.set(clubId, (rows.get(clubId) ?? []).map(row => row.team_id === teamId ? { ...row, teams: name ? { name } : row.teams } : row)); publish();
        }),
      ]);
    } catch (error) { assertReadNotAborted(signal); failed.add(`club:${clubId}`); firstError ??= error; }
    finally { pending--; publish(); }
  }));
  if (ids.length && !successful) throw firstError instanceof Error ? firstError : new Error('Club events could not be loaded');
  return snapshot();
}