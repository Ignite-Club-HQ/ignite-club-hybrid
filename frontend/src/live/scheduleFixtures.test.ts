import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
const mocks = vi.hoisted(() => ({ entered: vi.fn(), managed: vi.fn(), public: vi.fn(), matches: vi.fn(), team: vi.fn(), club: vi.fn() }));
vi.mock('./features/competitions', () => ({ listLiveMyNewsCompetitions: () => mocks.entered(), listLiveCompetitionsMulti: () => mocks.managed(),
  listLivePublicCompetitions: () => mocks.public(), listLiveCompetitionMatches: (_ctx: unknown, id: string) => mocks.matches(id) }));
vi.mock('./features/club', () => ({ getLiveTeam: (_ctx: unknown, id: string) => mocks.team(id), getLiveClubProfile: (_ctx: unknown, id: string) => mocks.club(id) }));
vi.mock('./membershipRouting', () => ({ readMembershipInScope: (ctx: unknown, _scope: unknown, read: (ctx: unknown) => unknown) => read(ctx) }));
import { loadScheduleFixtures, type FixtureSnapshot } from './scheduleFixtures';
const ctx = {} as FeatureBackendContext;
const scope = { leagueClubIds: ['admin-club'], clubId: null, teamId: null, fromMs: 100, toMs: 1000 };
const competition = { id: 'cup', club_id: 'foreign-host', name: 'Cup', status: 'open', visibility: 'public' };
const match = { id: 'match', home_team: 'home', away_team: 'away', scheduled_at_ms: [500n], status: 'scheduled', venue: [] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.entered.mockResolvedValue([]); mocks.managed.mockResolvedValue([]); mocks.public.mockResolvedValue([competition]);
  mocks.matches.mockResolvedValue([match]); mocks.team.mockImplementation(async id => [{ name: id }]); mocks.club.mockResolvedValue([{ name: 'Host', sport: [] }]);
});
describe('independent foreign-host fixture sources', () => {
  it('publishes public fixtures while entered-competition discovery is still pending', async () => {
    let finish: ((value: unknown[]) => void) | undefined;
    mocks.entered.mockImplementation(() => new Promise(resolve => { finish = resolve; }));
    const updates: FixtureSnapshot[] = [];
    const loading = loadScheduleFixtures(ctx, scope, value => updates.push(value));
    await vi.waitFor(() => expect(updates.some(value => value.events.length === 1)).toBe(true));
    expect(updates.at(-1)?.incomplete).toBe(true);
    expect(mocks.matches).toHaveBeenCalledWith('cup');
    finish?.([]);
    expect((await loading).incomplete).toBe(false);
  });
  it('keeps foreign public and private entered competitions, reading duplicate IDs once', async () => {
    mocks.entered.mockResolvedValue([competition, { ...competition, id: 'private-cup', visibility: 'private' }]);
    mocks.matches.mockImplementation(async id => [{ ...match, id: `${id}-match` }]);
    const result = await loadScheduleFixtures(ctx, scope);
    expect(result.events.map(event => event.competition_id).sort()).toEqual(['cup', 'private-cup']);
    expect(mocks.matches).toHaveBeenCalledTimes(2);
    expect(result.incomplete).toBe(false);
  });
  it('retains successful fixtures and distinguishes refused discovery and failed host reads from emptiness', async () => {
    mocks.entered.mockRejectedValue(new Error('Access denied'));
    mocks.managed.mockResolvedValue([{ ...competition, id: 'broken' }]);
    mocks.matches.mockImplementation(async id => { if (id === 'broken') throw new Error('Network unavailable'); return [match]; });
    const result = await loadScheduleFixtures(ctx, scope);
    expect(result.events.map(event => event.id)).toEqual(['competition-fixture-match']);
    expect(result.failed.sort()).toEqual(['competition:broken', 'entered']);
    expect(result.incomplete).toBe(true); expect(result.pending).toBe(0);
  });
  it('keeps archive, public visibility, club, team, cancellation and date filters', async () => {
    mocks.public.mockResolvedValue([competition, { ...competition, id: 'archived', status: 'archived' }, { ...competition, id: 'private', visibility: 'private' }]);
    mocks.matches.mockResolvedValue([match, { ...match, id: 'cancelled', status: 'cancelled' }, { ...match, id: 'old', scheduled_at_ms: [99n] }]);
    const result = await loadScheduleFixtures(ctx, { ...scope, clubId: 'foreign-host', teamId: 'home' });
    expect(result.events.map(event => event.id)).toEqual(['competition-fixture-match']);
    expect(mocks.matches).toHaveBeenCalledTimes(1);
    expect((await loadScheduleFixtures(ctx, { ...scope, clubId: 'other' })).events).toEqual([]);
    expect((await loadScheduleFixtures(ctx, { ...scope, teamId: 'other' })).events).toEqual([]);
  });
  it('reports all discovery failures as incomplete rather than a complete empty schedule', async () => {
    for (const read of [mocks.entered, mocks.managed, mocks.public]) read.mockRejectedValue(new Error('Denied'));
    const result = await loadScheduleFixtures(ctx, scope);
    expect(result.events).toEqual([]); expect(result.failed).toHaveLength(3); expect(result.incomplete).toBe(true);
  });
  it('does not warn when another club\'s public competition only lets participants read fixtures', async () => {
    mocks.matches.mockRejectedValue(new Error('Competition access forbidden'));
    const result = await loadScheduleFixtures(ctx, scope);
    expect(result.failed).toEqual([]);
    expect(result.incomplete).toBe(false);
  });
  it('still reports a refused competition the member entered', async () => {
    mocks.public.mockResolvedValue([]);
    mocks.entered.mockResolvedValue([competition]);
    mocks.matches.mockRejectedValue(new Error('Competition access forbidden'));
    expect((await loadScheduleFixtures(ctx, scope)).failed).toEqual(['competition:cup']);
  });
});
