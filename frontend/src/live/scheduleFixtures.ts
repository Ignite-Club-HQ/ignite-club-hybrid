import type { FeatureBackendContext } from './featureRouter';
import { listLiveCompetitionMatches, listLiveCompetitionsMulti, listLiveMyNewsCompetitions, listLivePublicCompetitions } from './features/competitions';
import { getLiveClubProfile, getLiveTeam } from './features/club';
import { readMembershipInScope } from './membershipRouting';

export type FixtureScope = {
  leagueClubIds: string[];
  clubId: string | null;
  teamId: string | null;
  fromMs: number;
  toMs: number;
};
type Competition = Awaited<ReturnType<typeof listLivePublicCompetitions>>[number];
export type FixtureSnapshot = { events: ScheduleFixture[]; incomplete: boolean; pending: number; failed: string[] };
export type ScheduleFixture = {
  id: string; title: string; type: 'game'; event_date: string; start_time: string;
  address: string | null; suburb: null; location_name: string | null; club_id: string;
  team_id: null; mini_league_id: null; is_cancelled: false; is_bye: false;
  is_recurring: false; parent_event_id: null; opponent: string; teams: null;
  clubs: { name: string; sport: string | null }; competition_id: string; is_competition_fixture: true;
};

/** Foreign-host discovery stays explicit and authorized. Each discovery source
 * and each host publishes independently; failures never mean an empty schedule. */
export async function loadScheduleFixtures(ctx: FeatureBackendContext, scope: FixtureScope,
  onUpdate?: (snapshot: FixtureSnapshot) => void): Promise<FixtureSnapshot> {
  const jobs = new Map<string, Promise<void>>();
  const rows = new Map<string, ScheduleFixture>();
  const failed = new Set<string>();
  let pending = 3;
  const teams = new Map<string, Promise<string>>();
  const clubs = new Map<string, Promise<{ name: string; sport: string | null }>>();
  const snapshot = (): FixtureSnapshot => ({ events: [...rows.values()].sort((a, b) => a.event_date.localeCompare(b.event_date) || a.id.localeCompare(b.id)),
    incomplete: pending > 0 || failed.size > 0, pending, failed: [...failed] });
  const publish = () => onUpdate?.(snapshot());
  const teamName = (id: string) => {
    const hit = teams.get(id);
    if (hit) return hit;
    const value = readMembershipInScope(ctx, { teamId: id }, scoped => getLiveTeam(scoped, id))
      .then(value => value[0]?.name ?? 'Team').catch(() => 'Team');
    teams.set(id, value); return value;
  };
  const clubInfo = (id: string) => {
    const hit = clubs.get(id);
    if (hit) return hit;
    const value = readMembershipInScope(ctx, { clubId: id }, scoped => getLiveClubProfile(scoped, id))
      .then(value => ({ name: value[0]?.name ?? 'Club', sport: value[0]?.sport[0] ?? null }))
      .catch(() => ({ name: 'Club', sport: null }));
    clubs.set(id, value); return value;
  };
  const readCompetition = (competition: Competition, managed: boolean): Promise<void> => {
    const hit = jobs.get(competition.id);
    if (hit) return hit;
    pending++;
    const job = (async () => {
      try {
        const club = clubInfo(competition.club_id);
        // This helper resolves the host, not the viewer's member group.
        const matches = await listLiveCompetitionMatches(ctx, competition.id);
        const scheduled = matches.flatMap(match => {
          const raw = match.scheduled_at_ms[0];
          if (raw == null || match.status === 'cancelled') return [];
          const time = Number(raw);
          if (!Number.isFinite(time) || time < scope.fromMs || time > scope.toMs ||
            (scope.teamId && match.home_team !== scope.teamId && match.away_team !== scope.teamId)) return [];
          return [{ match, time }];
        });
        await Promise.all(scheduled.flatMap(({ match }) => [teamName(match.home_team), teamName(match.away_team)]));
        const info = await club;
        for (const { match, time } of scheduled) {
          const start = new Date(time).toISOString();
          rows.set(match.id, {
            id: `competition-fixture-${match.id}`, title: competition.name, type: 'game', event_date: start, start_time: start,
            address: match.venue[0] ?? null, suburb: null, location_name: match.venue[0] ?? null,
            club_id: competition.club_id, team_id: null, mini_league_id: null, is_cancelled: false, is_bye: false,
            is_recurring: false, parent_event_id: null, opponent: `${await teamName(match.home_team)} vs ${await teamName(match.away_team)}`,
            teams: null, clubs: info, competition_id: competition.id, is_competition_fixture: true,
          });
        }
      } catch (error) {
        // Other clubs' public competitions are listed to everyone, but their
        // fixtures are only readable by participants. "Not yours" is not a
        // failed refresh; only competitions you manage/entered report errors.
        const text = error instanceof Error ? error.message : String(error);
        if (!managed && /forbidden|denied|not authori[sz]ed/i.test(text)) return;
        console.warn('[schedule] competition fixtures failed', competition.id, text);
        failed.add(`competition:${competition.id}`);
      }
      finally { pending--; publish(); }
    })();
    jobs.set(competition.id, job); return job;
  };
  await Promise.all([
    { id: 'entered', managed: true, read: () => listLiveMyNewsCompetitions(ctx) },
    { id: 'league-admin', managed: true, read: () => scope.leagueClubIds.length ? listLiveCompetitionsMulti(ctx, scope.leagueClubIds) : Promise.resolve([]) },
    { id: 'public', managed: false, read: () => listLivePublicCompetitions(ctx) },
  ].map(async source => {
    try {
      const competitions = await source.read();
      await Promise.all(competitions.filter(competition => competition.status !== 'archived' &&
        (source.managed || competition.visibility === 'public') && (!scope.clubId || competition.club_id === scope.clubId))
        .map(competition => readCompetition(competition, source.managed)));
    } catch (error) { console.warn('[schedule] competition list failed', source.id, error instanceof Error ? error.message : String(error)); failed.add(source.id); }
    finally { pending--; publish(); }
  }));
  return snapshot();
}