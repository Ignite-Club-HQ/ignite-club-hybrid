/** Concrete existing-feature adapters for the explicit inactive read session.
 * No implicit production activation; each destination keeps its own access rules.
 * Club-keyed reads go to the club's own group; competitions hosted by another
 * club are read from the host's group; team entries are discovered across groups.
 */
import type { openGroupSession } from './groupSession';
type Session = Awaited<ReturnType<typeof openGroupSession>>;
const perClub = <T>(session: Session, domain: Parameters<Session['readClubs']>[1], load: (ctx: Parameters<Parameters<Session['readClubs']>[2]>[0], id: string) => Promise<T>) =>
  (clubs: readonly string[]) => session.readClubs(clubs, domain, (ctx, ids) => Promise.all(ids.map(id => load(ctx, id))));

export function groupReadFeatures(session: Session) {
  return {
    profiles: perClub(session, 'club_domain', async (ctx, id) => (await import('./features/club')).getLiveClubProfile(ctx, id)),
    teams: perClub(session, 'club_domain', async (ctx, id) => (await import('./features/club')).listLiveTeams(ctx, id)),
    subscriptions: perClub(session, 'club_domain', async (ctx, id) => (await import('./features/club')).getLiveClubSubscription(ctx, id)),
    sponsors: perClub(session, 'club_domain', async (ctx, id) => (await import('./features/club')).listLiveSponsors(ctx, id)),
    announcements: perClub(session, 'club_domain', async (ctx, id) => (await import('./features/news')).getLiveClubAnnouncement(ctx, id)),
    events: perClub(session, 'events_domain', async (ctx, id) => (await import('./features/events')).listLiveEvents(ctx, id)),
    miniLeagues: perClub(session, 'mini_league_domain', async (ctx, id) => (await import('./features/miniLeagues')).listLiveMiniLeaguesByClub(ctx, id)),
    mediaAssets: perClub(session, 'media_metadata', async (ctx, id) => (await import('./features/media')).listLiveAssets(ctx, id)),
    vaultTrash: perClub(session, 'vault_domain', async (ctx, id) => (await import('./features/vault')).listLiveVaultTrash(ctx, id)),
    ownCompetitions: perClub(session, 'competition_domain', async (ctx, id) => (await import('./features/competitions')).listLiveCompetitions(ctx, id)),
    engagementTotals: (clubs: readonly string[], sinceMs: number, untilMs: number) => session.readClubs(clubs, 'insights_domain', async (ctx, ids) => {
      const { getLiveClubEngagementTotals } = await import('./features/insights');
      return Promise.all(ids.map(id => getLiveClubEngagementTotals(ctx, id, sinceMs, untilMs)));
    }),
    messages: (club: string, conversation: string, after: number | null, limit = 50) => session.readClub(club, 'messaging_domain', async ctx => {
      const { listLiveMessagesPage } = await import('./features/messaging');
      return listLiveMessagesPage(ctx, conversation, after, limit);
    }),
    /** A competition run by hostClubId — the host's group, even when the reader's club lives elsewhere. */
    hostedCompetition: (hostClubId: string, competitionId: string) => session.readHosted(hostClubId, 'competition_domain', async ctx => {
      const c = await import('./features/competitions');
      const [entries, matches, seasons] = await Promise.all([
        c.listLiveCompetitionEntries(ctx, competitionId), c.listLiveCompetitionMatches(ctx, competitionId), c.listLiveCompetitionSeasons(ctx, competitionId)]);
      return { entries, matches, seasons };
    }),
    /** Entries for the reader's teams in any group's competitions (bounded fan-out). */
    enteredCompetitions: (teamIds: readonly string[]) => {
      if (teamIds.length > 50) throw new Error('Too many teams for one cross-group read');
      return session.readEveryGroup('competition_domain', async ctx => {
        const { listLiveEntriesByTeam } = await import('./features/competitions');
        return (await Promise.all(teamIds.map(t => listLiveEntriesByTeam(ctx, t)))).flat();
      });
    },
  };
}
