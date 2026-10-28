import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
const mocks = vi.hoisted(() => ({ events: vi.fn(), duties: vi.fn(), profile: vi.fn(), team: vi.fn(), scopes: vi.fn(), cachedTeam: vi.fn(), membershipScopes: vi.fn(), route: vi.fn() }));
vi.mock('@/lib/clubTeamCache', () => ({ getCachedTeam: (id: string) => mocks.cachedTeam(id) }));
vi.mock('./contentRouting', () => ({ readContentInScope: (ctx: unknown, feature: unknown, scope: unknown, read: (ctx: unknown) => unknown) => {
  mocks.scopes(feature, scope); return mocks.route(ctx, read);
} }));
vi.mock('./membershipRouting', () => ({ readMembershipInScope: (ctx: unknown, scope: unknown, read: (ctx: unknown) => unknown) => {
  mocks.membershipScopes(scope); return read(ctx);
} }));
vi.mock('./features/events', () => ({ listLiveEvents: (_ctx: unknown, id: string) => mocks.events(id), listLiveEventDutyTeams: (_ctx: unknown, ids: string[]) => mocks.duties(ids) }));
vi.mock('./features/club', () => ({ getLiveClubProfile: (_ctx: unknown, id: string) => mocks.profile(id), getLiveTeam: (_ctx: unknown, id: string) => mocks.team(id) }));
import { loadMemberSchedule, type MemberScheduleSnapshot } from './scheduleMembers';
const ctx = {} as FeatureBackendContext;
const scope = { clubIds: ['g1', 'g2'], teamIds: ['my-team'], adminClubIds: [], selectedTeamId: null, filter: 'all', fromMs: 0, toMs: 10000 };
const event = { id: 'event-1', title: 'Training', event_type: 'training', starts_at_ms: 5000n, ends_at_ms: 6000n,
  updated_at_ms: 5000n, deleted: false, club_id: 'g1', team_id: [], address: [], location: [], mini_league_id: [],
  cancelled: false, series_id: [], opponent: [], description: '' };
beforeEach(() => {
  mocks.route.mockImplementation((ctx, read) => read(ctx));
  mocks.cachedTeam.mockReset().mockReturnValue(null);
  vi.clearAllMocks(); mocks.events.mockImplementation(async id => id === 'g1' ? [event] : []);
  mocks.profile.mockResolvedValue([{ name: 'Cats', sport: [] }]); mocks.team.mockResolvedValue([{ name: 'U9' }]); mocks.duties.mockResolvedValue([]);
});
describe('progressive member schedule', () => {
  it('does not time out a healthy event service while cold group routing is still resolving', async () => {
    vi.useFakeTimers();
    try {
      mocks.route.mockImplementation(async (ctx, read) => {
        await new Promise(resolve => setTimeout(resolve, 25_000));
        return read(ctx);
      });
      mocks.events.mockImplementation(async id => {
        await new Promise(resolve => setTimeout(resolve, 15_000));
        return id === 'g1' ? [event] : [];
      });
      const pending = loadMemberSchedule(ctx, { ...scope, clubIds: ['g1'] });
      await vi.advanceTimersByTimeAsync(25_001);
      expect(mocks.events).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(40_000);
      const result = await pending;
      expect(result.events.map(row => row.id)).toEqual(['event-1']);
      expect(result.failed).toEqual([]);
      expect(result.incomplete).toBe(false);
    } finally { vi.useRealTimers(); }
  });
  it('retains the event service deadline after routing completes', async () => {
    vi.useFakeTimers();
    try {
      mocks.events.mockReturnValue(new Promise(() => {}));
      const pending = expect(loadMemberSchedule(ctx, { ...scope, clubIds: ['g1'] })).rejects.toThrow('Schedule events timed out');
      await vi.advanceTimersByTimeAsync(20_001);
      await pending;
    } finally { vi.useRealTimers(); }
  });
  it('reveals a named team without waiting for another team in the same club', async () => {
    let finishSlow: ((value: unknown[]) => void) | undefined;
    mocks.events.mockResolvedValue([
      { ...event, id: 'ready', team_id: ['ready-team'] },
      { ...event, id: 'slow', team_id: ['slow-team'] },
    ]);
    mocks.team.mockImplementation(id => id === 'ready-team' ? Promise.resolve([{ name: 'U9 Hawks' }])
      : new Promise(resolve => { finishSlow = resolve; }));
    const updates: MemberScheduleSnapshot[] = [];
    const pending = loadMemberSchedule(ctx, { ...scope, clubIds: ['g1'], teamIds: ['ready-team', 'slow-team'] }, value => updates.push(value));
    await vi.waitFor(() => expect(updates.some(value => value.events.some(row => row.id === 'ready'))).toBe(true));
    expect(updates.flatMap(value => value.events).find(row => row.id === 'ready')?.teams?.name).toBe('U9 Hawks');
    expect(updates.some(value => value.events.some(row => row.id === 'slow'))).toBe(false);
    finishSlow?.([{ name: 'U10 Hawks' }]);
    const result = await pending;
    expect(result.events.find(row => row.id === 'slow')?.teams?.name).toBe('U10 Hawks');
  });
  it('first publishes a cold team card with its actual name while club-wide events reveal independently', async () => {
    let finishName: ((value: unknown[]) => void) | undefined;
    mocks.events.mockImplementation(async id => id === 'g1' ? [event, { ...event, id: 'u9-training', team_id: ['my-team'] }] : []);
    mocks.team.mockImplementation(() => new Promise(resolve => { finishName = resolve; }));
    const updates: MemberScheduleSnapshot[] = [];
    const pending = loadMemberSchedule(ctx, scope, value => updates.push(value));
    await vi.waitFor(() => expect(updates.some(value => value.events.some(row => row.id === 'event-1'))).toBe(true));
    expect(updates.some(value => value.events.some(row => row.id === 'u9-training'))).toBe(false);
    finishName?.([{ name: 'U9 Hawks' }]);
    await pending;
    const firstTeam = updates.flatMap(value => value.events).find(row => row.id === 'u9-training');
    expect(firstTeam?.teams?.name).toBe('U9 Hawks');
    expect(mocks.membershipScopes).toHaveBeenCalledWith({ clubId: 'g1' });
    expect(mocks.membershipScopes).not.toHaveBeenCalledWith({ teamId: 'my-team' });
  });

  it('uses known exact-club team metadata immediately but ignores another club metadata', async () => {
    mocks.events.mockResolvedValue([{ ...event, team_id: ['my-team'] }]);
    mocks.cachedTeam.mockReturnValue({ id: 'my-team', club_id: 'g1', name: 'U9 Hawks' });
    const updates: MemberScheduleSnapshot[] = [];
    await loadMemberSchedule(ctx, { ...scope, clubIds: ['g1'] }, value => updates.push(value));
    expect(updates[0].events[0].teams?.name).toBe('U9 Hawks');
    mocks.cachedTeam.mockReturnValue({ id: 'my-team', club_id: 'other-club', name: 'Wrong team' });
    const cold: MemberScheduleSnapshot[] = [];
    await loadMemberSchedule(ctx, { ...scope, clubIds: ['g1'] }, value => cold.push(value));
    expect(cold[0].events).toEqual([]);
    expect(cold.flatMap(value => value.events).some(row => row.teams?.name === 'Wrong team')).toBe(false);
  });

  it('keeps authorized events and retry evidence after a failed name read without inventing Team', async () => {
    mocks.events.mockResolvedValue([{ ...event, team_id: ['my-team'] }]);
    mocks.team.mockRejectedValue(new Error('Name unavailable'));
    const result = await loadMemberSchedule(ctx, { ...scope, clubIds: ['g1'] });
    expect(result.events[0].id).toBe('event-1');
    expect(result.events[0].teams).toBeNull();
    expect(result.failed).toContain('team:my-team');
    expect(result.incomplete).toBe(true);
  });
  it('settles with visible events and incomplete evidence after stalled optional duties', async () => {
    vi.useFakeTimers();
    try {
      mocks.duties.mockReturnValue(new Promise(() => {}));
      const updates: MemberScheduleSnapshot[] = [];
      const pending = loadMemberSchedule(ctx, { ...scope, clubIds: ['g1'] }, value => updates.push(value));
      await vi.advanceTimersByTimeAsync(0);
      expect(updates.some(value => value.events[0]?.id === 'event-1')).toBe(true);
      await vi.advanceTimersByTimeAsync(20_001);
      const result = await pending;
      expect(result.events[0].id).toBe('event-1');
      expect(result.pending).toBe(0);
      expect(result.failed).toContain('duties:g1');
      expect(result.incomplete).toBe(true);
    } finally { vi.useRealTimers(); }
  });
  it('publishes a ready club while another club and the ready club profile are unresolved', async () => {
    let finishClub: ((value: unknown[]) => void) | undefined; let finishProfile: ((value: unknown[]) => void) | undefined;
    mocks.events.mockImplementation(id => id === 'g1' ? Promise.resolve([event]) : new Promise(resolve => { finishClub = resolve; }));
    mocks.profile.mockImplementation(() => new Promise(resolve => { finishProfile = resolve; }));
    const updates: MemberScheduleSnapshot[] = [];
    const pending = loadMemberSchedule(ctx, scope, value => updates.push(value));
    await vi.waitFor(() => expect(updates.some(value => value.events.length === 1)).toBe(true));
    expect(updates.at(-1)?.incomplete).toBe(true); expect(updates.at(-1)?.events[0].title).toBe('Training');
    finishClub?.([]); finishProfile?.([{ name: 'Cats', sport: [] }]);
    const result = await pending;
    expect(result.incomplete).toBe(false); expect(result.events[0].clubs.name).toBe('Cats');
    expect(mocks.scopes).toHaveBeenCalledWith('events', { clubId: 'g1' });
  });
  it('retains healthy events but reports denied clubs and failed duties as incomplete', async () => {
    mocks.events.mockImplementation(async id => { if (id === 'g2') throw new Error('Access denied'); return [event]; });
    mocks.duties.mockRejectedValue(new Error('Duties unavailable'));
    const result = await loadMemberSchedule(ctx, scope);
    expect(result.events.map(row => row.id)).toEqual(['event-1']);
    expect(result.failed.sort()).toEqual(['club:g2', 'duties:g1']); expect(result.incomplete).toBe(true);
  });
  it('all failed reads throw while authorized empty clubs are complete', async () => {
    mocks.events.mockRejectedValue(new Error('Denied'));
    await expect(loadMemberSchedule(ctx, scope)).rejects.toThrow('Denied');
    mocks.events.mockResolvedValue([]);
    expect(await loadMemberSchedule(ctx, scope)).toEqual({ events: [], incomplete: false, pending: 0, failed: [] });
  });
  it('preserves team visibility, deleted/date/type filters and final exact-ID sorting', async () => {
    mocks.events.mockResolvedValue([event, event, { ...event, id: 'hidden-team', team_id: ['other-team'] },
      { ...event, id: 'deleted', deleted: true }, { ...event, id: 'old', starts_at_ms: 20000n },
      { ...event, id: 'social', event_type: 'social' }, { ...event, id: 'team', team_id: ['my-team'] }]);
    const result = await loadMemberSchedule(ctx, { ...scope, clubIds: ['g1'], filter: 'training' });
    expect(result.events.map(row => row.id)).toEqual(['event-1', 'team']);
    expect(result.events[1].teams?.name).toBe('U9');
    expect(mocks.team).toHaveBeenCalledTimes(1);
  });
  it('quietly retries a transient club-name failure instead of warning on every login', async () => {
    mocks.profile.mockRejectedValueOnce(new Error('Network connection lost')).mockResolvedValue([{ name: 'Cats', sport: [] }]);
    const result = await loadMemberSchedule(ctx, { ...scope, clubIds: ['g1'] });
    expect(result.failed).toEqual([]);
    expect(result.events[0]?.clubs.name).toBe('Cats');
  });
});
