import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from './featureRouter';
const mocks = vi.hoisted(() => ({ events: vi.fn(), duties: vi.fn(), profile: vi.fn(), team: vi.fn(), scopes: vi.fn() }));
vi.mock('./contentRouting', () => ({ readContentInScope: (ctx: unknown, feature: unknown, scope: unknown, read: (ctx: unknown) => unknown) => {
  mocks.scopes(feature, scope); return read(ctx);
} }));
vi.mock('./membershipRouting', () => ({ readMembershipInScope: (ctx: unknown, _scope: unknown, read: (ctx: unknown) => unknown) => read(ctx) }));
vi.mock('./features/events', () => ({ listLiveEvents: (_ctx: unknown, id: string) => mocks.events(id), listLiveEventDutyTeams: (_ctx: unknown, ids: string[]) => mocks.duties(ids) }));
vi.mock('./features/club', () => ({ getLiveClubProfile: (_ctx: unknown, id: string) => mocks.profile(id), getLiveTeam: (_ctx: unknown, id: string) => mocks.team(id) }));
import { loadMemberSchedule, type MemberScheduleSnapshot } from './scheduleMembers';
const ctx = {} as FeatureBackendContext;
const scope = { clubIds: ['g1', 'g2'], teamIds: ['my-team'], adminClubIds: [], selectedTeamId: null, filter: 'all', fromMs: 0, toMs: 10000 };
const event = { id: 'event-1', title: 'Training', event_type: 'training', starts_at_ms: 5000n, ends_at_ms: 6000n,
  updated_at_ms: 5000n, deleted: false, club_id: 'g1', team_id: [], address: [], location: [], mini_league_id: [],
  cancelled: false, series_id: [], opponent: [], description: '' };
beforeEach(() => {
  vi.clearAllMocks(); mocks.events.mockImplementation(async id => id === 'g1' ? [event] : []);
  mocks.profile.mockResolvedValue([{ name: 'Cats', sport: [] }]); mocks.team.mockResolvedValue([{ name: 'U9' }]); mocks.duties.mockResolvedValue([]);
});
describe('progressive member schedule', () => {
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
});