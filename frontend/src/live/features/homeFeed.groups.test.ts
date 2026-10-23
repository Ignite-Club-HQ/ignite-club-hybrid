import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ failed: false, clubEventsFailed: false, calls: [] as Array<[string, string]>, clubWait: null as Promise<void> | null, slowClub: null as string | null, slowWait: null as Promise<void> | null, teamStarted: null as (() => void) | null }));
vi.mock('../contentRouting', () => ({ readContentInScope: async (_ctx: unknown, feature: string, scope: any, fn: any) => {
  const owner = scope.clubId ?? (scope.teamId === 'team-b' ? 'club-b' : scope.teamId === 'team-a' ? 'club-a' : 'shared');
  state.calls.push([feature, owner]);
  if (state.failed && owner === 'club-b') throw new Error('group-b offline');
  return fn({ target: { alias: owner } });
} }));
vi.mock('./membership', () => ({ getLiveMyRoleGrants: async () => ['a', 'b'].map(id => ({ role: 'player', club: [`club-${id}`], team: [`team-${id}`] })) }));
vi.mock('./club', () => ({
  listLivePersonalTeams: async () => [],
  getLiveClubProfile: async (ctx: any, id: string) => { if (ctx.target.alias !== id) throw new Error('wrong club group'); await state.clubWait; if (id === state.slowClub) await state.slowWait; return [{ id, name: id, deleted_at_ms: [] }]; },
  getLiveTeam: async (ctx: any, id: string) => { state.teamStarted?.(); const club = id.replace('team', 'club'); if (ctx.target.alias !== club) throw new Error('wrong team group'); return [{ id, name: id, club_id: club, deleted_at_ms: [] }]; },
}));
vi.mock('./events', () => ({ listLiveEvents: async (ctx: any, club: string | null, team: string | null) => {
  if (club && state.clubEventsFailed) throw new Error('Club events unavailable');
  const owner = club ?? team?.replace('team', 'club');
  if (ctx.target.alias !== owner) throw new Error('wrong events group');
  return [{ id: `${owner}-event`, club_id: owner, team_id: [owner?.replace('club', 'team')], title: 'Training', event_type: 'training', starts_at_ms: BigInt(Date.now() + 86400000), opponent: [], address: [], location: [], mini_league_id: [], cancelled: false }];
} }));
vi.mock('./vault', () => ({}));
import { fetchLiveHomeFeed } from './homeFeed';
describe('multi-club home content', () => {
  beforeEach(() => { state.failed = false; state.clubEventsFailed = false; state.calls = []; state.clubWait = null; state.teamStarted = null; state.slowClub = null; state.slowWait = null; });
  it('retains verified team events when the independent club-event read fails', async () => {
    state.clubEventsFailed = true;
    const feed = await fetchLiveHomeFeed({} as never);
    expect(feed.events.map(event => event.id)).toEqual(['club-a-event', 'club-b-event']);
    expect(feed.incomplete).toBe(true);
  });
  it('publishes verified club A events while club B remains unresolved and never marks that snapshot complete', async () => {
    state.slowClub = 'club-b';
    let finish: (() => void) | undefined;
    state.slowWait = new Promise<void>(resolve => { finish = resolve; });
    const progress = vi.fn();
    const pending = fetchLiveHomeFeed({} as never, { onProgress: progress });
    try {
      await vi.waitFor(() => expect(progress).toHaveBeenCalled());
      const partial = progress.mock.calls[0][0];
      expect(partial.events.map((event: any) => event.id)).toEqual(['club-a-event']);
      expect(partial.incomplete).toBe(true);
    } finally { finish?.(); }
    expect((await pending).events.map(event => event.id)).toEqual(['club-a-event', 'club-b-event']);
  });
  it('starts team validation before slower club validation completes', async () => {
    let releaseClubs: (() => void) | undefined;
    state.clubWait = new Promise<void>(resolve => { releaseClubs = resolve; });
    const teamStarted = new Promise<void>(resolve => { state.teamStarted = resolve; });
    const pending = fetchLiveHomeFeed({} as never);
    try {
      await Promise.race([teamStarted, new Promise((_, reject) => setTimeout(() => reject(new Error('Team reads waited for clubs')), 200))]);
    } finally { releaseClubs?.(); }
    expect((await pending).memberships.teamIds).toEqual(['team-a', 'team-b']);
  });
  it('loads names, teams and events from each club group and deduplicates events', async () => {
    const feed = await fetchLiveHomeFeed({} as never);
    expect(feed.memberships.clubIds).toEqual(['club-a', 'club-b']);
    expect(feed.events.map(event => event.id)).toEqual(['club-a-event', 'club-b-event']);
    expect(feed.events.map(event => event.clubs.name)).toEqual(['club-a', 'club-b']);
    expect(state.calls).toContainEqual(['events', 'club-a']);
    expect(state.calls).toContainEqual(['events', 'club-b']);
  });
  it('shows the clubs that loaded when another group is unavailable', async () => {
    state.failed = true;
    const feed = await fetchLiveHomeFeed({} as never);
    expect(feed.memberships.clubIds).toEqual(['club-a']);
    expect(feed.events.map(event => event.id)).toEqual(['club-a-event']);
  });
});