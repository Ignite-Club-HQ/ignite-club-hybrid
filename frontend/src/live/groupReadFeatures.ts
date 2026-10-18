/** Concrete existing-feature adapters for the explicit inactive read session.
 * No writes or implicit production activation; each destination keeps its ACL.
 */
import type { openGroupSession } from './groupSession';
type Session = Awaited<ReturnType<typeof openGroupSession>>;
export function groupReadFeatures(session: Session) {
  return {
    profiles: (clubs: readonly string[]) => session.readClubs(clubs, 'club_domain', async (ctx, ids) => {
      const { getLiveClubProfile } = await import('./features/club');
      return Promise.all(ids.map(id => getLiveClubProfile(ctx, id)));
    }),
    teams: (clubs: readonly string[]) => session.readClubs(clubs, 'club_domain', async (ctx, ids) => {
      const { listLiveTeams } = await import('./features/club');
      return Promise.all(ids.map(id => listLiveTeams(ctx, id)));
    }),
    subscriptions: (clubs: readonly string[]) => session.readClubs(clubs, 'club_domain', async (ctx, ids) => {
      const { getLiveClubSubscription } = await import('./features/club');
      return Promise.all(ids.map(id => getLiveClubSubscription(ctx, id)));
    }),
    events: (clubs: readonly string[]) => session.readClubs(clubs, 'events_domain', async (ctx, ids) => {
      const { listLiveEvents } = await import('./features/events');
      return Promise.all(ids.map(id => listLiveEvents(ctx, id)));
    }),
    messages: (club: string, conversation: string, before: number | null, limit = 50) => session.readClub(club, 'messaging_domain', async ctx => {
      const { listLiveMessagesPage } = await import('./features/messaging');
      return listLiveMessagesPage(ctx, conversation, before, limit);
    }),
  };
}