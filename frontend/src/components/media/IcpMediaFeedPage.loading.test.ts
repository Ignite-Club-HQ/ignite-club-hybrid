import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from '@/live/featureRouter';
const mocks = vi.hoisted(() => ({ assets: vi.fn(), teams: vi.fn(), comments: vi.fn(), reactions: vi.fn() }));
vi.mock('@/live/contentRouting', () => ({ readContentInScope: async (ctx: unknown, _feature: unknown, _scope: unknown, read: (ctx: unknown) => Promise<unknown>) => read(ctx) }));
vi.mock('@/live/crossGroupClubs', () => ({ readClubsInOwnGroups: async () => ({ values: [{ id: 'club-1', name: 'Cats', sport: [], deleted_at_ms: [] }], failed: 0 }) }));
vi.mock('@/live/groupDispatch', () => ({ clubDispatch: { memberClubIds: async () => ['club-1'] } }));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: async () => [{ club: ['club-1'], team: [] }] }));
vi.mock('@/live/features/club', () => ({ listLiveTeams: (...args: unknown[]) => mocks.teams(...args), getLiveTeam: async () => [] }));
vi.mock('@/live/features/miniLeagues', () => ({ listLiveMiniLeaguesByClub: async () => [] }));
vi.mock('@/live/features/competitions', () => ({ listLiveCompetitions: async () => [] }));
vi.mock('@/live/features/media', () => ({
  listLiveAssets: (...args: unknown[]) => mocks.assets(...args),
  listLiveComments: (...args: unknown[]) => mocks.comments(...args), listLiveReactions: (...args: unknown[]) => mocks.reactions(...args),
  liveAssetSource: () => ({ kind: 'icp-blob', url: 'https://photos.example/file' }),
  addLiveComment: vi.fn(), addLiveReaction: vi.fn(), deleteLiveAsset: vi.fn(), removeLiveReaction: vi.fn(),
}));
import { loadLiveMediaFeed } from './IcpMediaFeedPage';
const ctx = {} as FeatureBackendContext;
const photo = { id: 'photo-1', club_id: 'club-1', owner: { toText: () => 'uploader' }, kind: 'photo', mime: 'image/jpeg',
  created_at_ms: 10n, team_id: [], mini_league_id: [], competition_id: [], caption: [], album_id: [], blob_ref: [], deleted: false };
beforeEach(() => { vi.clearAllMocks(); mocks.assets.mockResolvedValue([photo, photo]); mocks.teams.mockResolvedValue([]); });
describe('media loading stages', () => {
  it('publishes deduplicated photos before delayed filter metadata and never reads comments as a feed prerequisite', async () => {
    let complete: ((value: unknown[]) => void) | undefined;
    mocks.teams.mockImplementation(() => new Promise(resolve => { complete = resolve; }));
    const progress = vi.fn();
    let done = false;
    const pending = loadLiveMediaFeed(ctx, progress).then(value => { done = true; return value; });
    await vi.waitFor(() => expect(progress).toHaveBeenCalled());
    const partial = progress.mock.calls[0][0];
    expect(partial.posts[0].assets.map((asset: { id: string }) => asset.id)).toEqual(['photo-1']);
    expect(partial.incomplete).toBe(true);
    expect(done).toBe(false);
    expect(mocks.comments).not.toHaveBeenCalled(); expect(mocks.reactions).not.toHaveBeenCalled();
    complete?.([]);
    expect((await pending).incomplete).toBe(false);
  });
  it('retains already loaded photos when ancillary metadata fails without claiming completeness', async () => {
    mocks.teams.mockRejectedValue(new Error('Metadata unavailable'));
    const progress = vi.fn();
    await expect(loadLiveMediaFeed(ctx, progress)).rejects.toThrow('Metadata unavailable');
    expect(progress.mock.calls[0][0].posts[0].assets[0].id).toBe('photo-1');
    expect(progress.mock.calls[0][0].incomplete).toBe(true);
  });
});