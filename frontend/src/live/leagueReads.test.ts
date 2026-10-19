import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
const state = vi.hoisted(() => ({ access: vi.fn(), members: vi.fn(), profiles: vi.fn(), leagues: vi.fn(), events: vi.fn(), groups: vi.fn(), players: vi.fn() }));
vi.mock('./domains', () => ({ connectLiveMiniLeagueDomain: async () => ({ actor: { get_my_league_access: state.access, get_league_members: state.members } }) }));
vi.mock('./featureRouter', () => ({ withFeatureBackend: async (_f: unknown, p: { icp: (ctx: unknown) => unknown }, scope: { clubId?: string; eventId?: string }) => p.icp({ target: { alias: scope.clubId ?? scope.eventId ?? 'shared' } }) }));
vi.mock('./miniLeagueRouting', () => ({ readMiniLeagueInScope: async (ctx: unknown, _s: unknown, fn: (c: unknown) => unknown) => fn(ctx) }));
vi.mock('./membershipRouting', () => ({ readMembershipInScope: async (ctx: unknown, _s: unknown, fn: (c: unknown) => unknown) => fn(ctx) }));
vi.mock('./features/identityAccessClient', () => ({ listLiveProfilesByIds: state.profiles }));
vi.mock('./features/miniLeagues', () => ({ listMyLiveMiniLeagues: state.leagues }));
vi.mock('./features/events', () => ({ listLiveEvents: state.events, listLiveEventGroups: state.groups, listLiveGroupPlayers: state.players }));
import { readLeagueAccess, readLeagueMembers, readManageableLeagues, readLeagueEvents } from './leagueReads';
const ctx = { target: { alias: 'league-group' } } as FeatureBackendContext;
beforeEach(() => { vi.resetAllMocks(); });
describe('league canister reads', () => {
  it('returns authoritative management permissions, not viewer roles inferred in the browser', async () => {
    state.access.mockResolvedValue({ Ok: [{ id: 'league-a', can_manage: false, can_delete: false, is_club_admin: false }] });
    expect((await readLeagueAccess(ctx, 'league-a')).can_manage).toBe(false);
    expect(state.access).toHaveBeenCalledWith(['league-a']);
  });
  it('does not treat an unreadable league as a permitted empty result', async () => {
    state.access.mockResolvedValue({ Ok: [] });
    await expect(readLeagueAccess(ctx, 'private')).rejects.toThrow('not visible');
  });
  it('resolves assignee profiles and preserves staff who are also parents', async () => {
    state.members.mockResolvedValue({ Ok: [{ user_id: 'parent-a', is_staff: false, is_parent: true }, { user_id: 'staff-b', is_staff: true, is_parent: true }] });
    state.profiles.mockResolvedValue([{ account_id: 'parent-a', display_name: 'Sam', avatar_ref: ['avatar'] }, { account_id: 'staff-b', display_name: 'Jo', avatar_ref: [] }]);
    expect(await readLeagueMembers(ctx, 'league-a')).toEqual([
      { id: 'parent-a', display_name: 'Sam', avatar_url: 'avatar', role: 'parent', isAlsoParent: false },
      { id: 'staff-b', display_name: 'Jo', avatar_url: null, role: 'league_admin', isAlsoParent: true },
    ]);
    expect(state.profiles.mock.calls[0]?.[0].target.alias).toBe('shared');
  });
  it('does not fabricate an empty assignee list on a denied read', async () => {
    state.members.mockResolvedValue({ Err: 'Forbidden' });
    await expect(readLeagueMembers(ctx, 'league-a')).rejects.toThrow('Forbidden');
    expect(state.profiles).not.toHaveBeenCalled();
  });
  it('invite targets include only leagues the caller can actually manage', async () => {
    state.leagues.mockResolvedValue([{ id: 'a' }, { id: 'b' }]);
    state.access.mockResolvedValue({ Ok: [{ id: 'a', can_manage: true }, { id: 'b', can_manage: false }] });
    expect(await readManageableLeagues(ctx)).toEqual([{ id: 'a' }]);
  });
  it('fetches league events from the club group and allocations from each event owner', async () => {
    state.events.mockResolvedValue([
      { id: 'event-a', title: 'Round', mini_league_id: ['league-a'], deleted: false, starts_at_ms: 1000n, ends_at_ms: 2000n, location: ['Pitch'], cancelled: false },
      { id: 'event-b', mini_league_id: ['league-b'], deleted: false },
      { id: 'deleted', mini_league_id: ['league-a'], deleted: true },
    ]);
    state.groups.mockResolvedValue([{ id: 'group-a' }]); state.players.mockResolvedValue([{ account_id: 'p1' }, { account_id: 'p2' }]);
    const result = await readLeagueEvents(ctx, 'league-a', 'club-a');
    expect(result.map(r => [r.id, r._allocatedPlayers])).toEqual([['event-a', 2]]);
    expect(state.events.mock.calls[0]?.[0].target.alias).toBe('club-a');
    expect(state.groups.mock.calls[0]?.[0].target.alias).toBe('event-a');
  });
});