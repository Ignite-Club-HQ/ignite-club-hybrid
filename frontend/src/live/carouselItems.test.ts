import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ team: vi.fn(), club: vi.fn(), trial: vi.fn(), leagues: vi.fn() }));
vi.mock('./membershipRouting', () => ({ readMembershipInScope: (ctx: unknown, _scope: unknown, read: (ctx: unknown) => unknown) => read(ctx) }));
vi.mock('./contentRouting', () => ({ readContentInScope: (ctx: unknown, _feature: unknown, _scope: unknown, read: (ctx: unknown) => unknown) => read(ctx) }));
vi.mock('./features/membership', () => ({ getLiveMyRoleGrants: async () => [{ role: 'player', club: ['club-a'], team: ['team-a'] }] }));
vi.mock('./features/club', () => ({ getLiveTeam: () => mocks.team(), getLiveClubProfile: () => mocks.club(), getLiveTeamSubscription: () => mocks.trial() }));
vi.mock('./features/miniLeagues', () => ({ listMyLiveMiniLeagues: () => mocks.leagues(), listLiveMiniLeaguesByClub: async () => [], getLiveMiniLeague: vi.fn() }));
import { fetchIcpCarouselItems } from './carouselItems';
beforeEach(() => {
  vi.resetAllMocks();
  mocks.team.mockResolvedValue([{ id: 'team-a', name: 'U9', club_id: 'club-a', logo_url: [], deleted_at_ms: [], archived: false }]);
  mocks.club.mockResolvedValue([{ name: 'Cats', logo_url: [], sport: [], deleted_at_ms: [] }]);
  mocks.trial.mockResolvedValue(null); mocks.leagues.mockResolvedValue([]);
});
describe('independent carousel cards', () => {
  it('does not treat an empty optional trial date as an active trial', async () => {
    mocks.trial.mockResolvedValue({ is_pro: true, trial_ends_at_ms: [] });
    expect((await fetchIcpCarouselItems({} as never, 'club-a')).items[0]?.isOnTrial).toBe(false);
    mocks.trial.mockResolvedValue({ is_pro: true, trial_ends_at_ms: [1n] });
    expect((await fetchIcpCarouselItems({} as never, 'club-a')).items[0]?.isOnTrial).toBe(true);
  });
  it('publishes a verified team before club labels, trial and league reads finish', async () => {
    vi.useFakeTimers();
    try {
      mocks.club.mockReturnValue(new Promise(() => {})); mocks.trial.mockReturnValue(new Promise(() => {})); mocks.leagues.mockReturnValue(new Promise(() => {}));
      const progress = vi.fn();
      const pending = fetchIcpCarouselItems({} as never, 'club-a', progress);
      await vi.advanceTimersByTimeAsync(0);
      expect(progress.mock.calls[0][0]).toMatchObject([{ id: 'team-a', name: 'U9', club_id: 'club-a' }]);
      await vi.advanceTimersByTimeAsync(20_001);
      expect(await pending).toMatchObject({ items: [{ id: 'team-a' }], incomplete: true });
    } finally { vi.useRealTimers(); }
  });
  it('never publishes a team from another selected club or a deleted team', async () => {
    expect((await fetchIcpCarouselItems({} as never, 'club-b')).items).toEqual([]);
    mocks.team.mockResolvedValue([{ id: 'team-a', club_id: 'club-a', deleted_at_ms: [1n] }]);
    expect((await fetchIcpCarouselItems({} as never, 'club-a')).items).toEqual([]);
  });
  it('discards abandoned progress rather than updating a new page', async () => {
    const controller = new AbortController(); controller.abort();
    const progress = vi.fn();
    await expect(fetchIcpCarouselItems({} as never, 'club-a', progress, controller.signal)).rejects.toThrow();
    expect(progress).not.toHaveBeenCalled();
  });
});