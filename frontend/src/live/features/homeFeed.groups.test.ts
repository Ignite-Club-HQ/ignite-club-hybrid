import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ failed: false, calls: [] as Array<[string, string]> }));
vi.mock('../contentRouting', () => ({ readContentInScope: async (_ctx: unknown, feature: string, scope: any, fn: any) => {
  const owner = scope.clubId ?? (scope.teamId === 'team-b' ? 'club-b' : scope.teamId === 'team-a' ? 'club-a' : 'shared');
  state.calls.push([feature, owner]);
  if (state.failed && owner === 'club-b') throw new Error('group-b offline');
  return fn({ target: { alias: owner } });
} }));
vi.mock('./membership', () => ({ getLiveMyRoleGrants: async () => ['a', 'b'].map(id => ({ role: 'player', club: [`club-${id}`], team: [`team-${id}`] })) }));
vi.mock('./club', () => ({
  listLivePersonalTeams: async () => [],
  getLiveClubProfile: async (ctx: any, id: string) => { if (ctx.target.alias !== id) throw new Error('wrong club group'); return [{ id, name: id, deleted_at_ms: [] }]; },
  getLiveTeam: async (ctx: any, id: string) => { const club = id.replace('team', 'club'); if (ctx.target.alias !== club) throw new Error('wrong team group'); return [{ id, name: id, club_id: club, deleted_at_ms: [] }]; },
}));
vi.mock('./events', () => ({ listLiveEvents: async (ctx: any, club: string | null, team: string | null) => {
  const owner = club ?? team?.replace('team', 'club');
  if (ctx.target.alias !== owner) throw new Error('wrong events group');
  return [{ id: `${owner}-event`, club_id: owner, team_id: [owner?.replace('club', 'team')], title: 'Training', event_type: 'training', starts_at_ms: BigInt(Date.now() + 86400000), opponent: [], address: [], location: [], mini_league_id: [], cancelled: false }];
} }));
vi.mock('./vault', () => ({}));
import { fetchLiveHomeFeed } from './homeFeed';
describe('multi-club home content', () => {
  beforeEach(() => { state.failed = false; state.calls = []; });
  it('loads names, teams and events from each club group and deduplicates events', async () => {
    const feed = await fetchLiveHomeFeed({} as never);
    expect(feed.memberships.clubIds).toEqual(['club-a', 'club-b']);
    expect(feed.events.map(event => event.id)).toEqual(['club-a-event', 'club-b-event']);
    expect(feed.events.map(event => event.clubs.name)).toEqual(['club-a', 'club-b']);
    expect(state.calls).toContainEqual(['events', 'club-a']);
    expect(state.calls).toContainEqual(['events', 'club-b']);
  });
  it('reports an unavailable group instead of saving an incomplete homepage', async () => {
    state.failed = true;
    await expect(fetchLiveHomeFeed({} as never)).rejects.toThrow('group-b offline');
  });
});