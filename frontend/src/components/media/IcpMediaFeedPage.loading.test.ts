import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from '@/live/featureRouter';
const mocks = vi.hoisted(() => ({ assets: vi.fn(), teams: vi.fn(), comments: vi.fn(), reactions: vi.fn(), profiles: vi.fn(), memberIds: vi.fn() }));
vi.mock('@/live/contentRouting', () => ({ readContentInScope: async (ctx: unknown, _feature: unknown, _scope: unknown, read: (ctx: unknown) => Promise<unknown>) => read(ctx) }));
vi.mock('@/live/crossGroupClubs', () => ({ readClubsInOwnGroups: (...args: unknown[]) => mocks.profiles(...args) }));
vi.mock('@/live/groupDispatch', () => ({ clubDispatch: { memberClubIds: () => mocks.memberIds() } }));
vi.mock('@/live/features/membership', () => ({ getLiveMyRoleGrants: async () => [{ club: ['club-1'], team: [] }] }));
vi.mock('@/live/features/club', () => ({ listLiveTeams: (...args: unknown[]) => mocks.teams(...args), getLiveTeam: async () => [] }));
vi.mock('@/live/features/miniLeagues', () => ({ listLiveMiniLeaguesByClub: async () => [] }));
vi.mock('@/live/features/competitions', () => ({ listLiveCompetitions: async () => [] }));
vi.mock('@/live/features/media', () => ({
  listLiveAssetsPage: async (...args: unknown[]) => {
    const value = await mocks.assets(...args.slice(0, 2));
    return Array.isArray(value) ? { assets: value, next: null, bounded: false } : value;
  },
  listLiveComments: (...args: unknown[]) => mocks.comments(...args), listLiveReactions: (...args: unknown[]) => mocks.reactions(...args),
  liveAssetSource: () => ({ kind: 'icp-blob', url: 'https://photos.example/file' }),
  addLiveComment: vi.fn(), addLiveReaction: vi.fn(), deleteLiveAsset: vi.fn(), removeLiveReaction: vi.fn(),
}));
import { loadLiveMediaFeed, type MediaFeedContinuation } from './IcpMediaFeedPage';
import { retainMediaFeed } from './retainMediaFeed';
const ctx = {} as FeatureBackendContext;
const photo = { id: 'photo-1', club_id: 'club-1', owner: { toText: () => 'uploader' }, kind: 'photo', mime: 'image/jpeg',
  created_at_ms: 10n, team_id: [], mini_league_id: [], competition_id: [], caption: [], album_id: [], blob_ref: [], deleted: false };
const club = { id: 'club-1', name: 'Cats', sport: [], deleted_at_ms: [] };
beforeEach(() => {
  vi.clearAllMocks(); mocks.assets.mockResolvedValue([photo, photo]); mocks.teams.mockResolvedValue([]);
  mocks.memberIds.mockResolvedValue(['club-1']); mocks.profiles.mockResolvedValue({ values: [club], failed: 0 });
});
describe('media loading stages', () => {
  it('keeps visible gallery photos throughout a second-source refresh', async () => {
    const cached = await loadLiveMediaFeed(ctx);
    mocks.memberIds.mockResolvedValue(['club-1', 'club-2']);
    let finish: ((value: unknown) => void) | undefined;
    mocks.profiles.mockImplementation((_ctx, ids: string[]) => ids[0] === 'club-1'
      ? new Promise(resolve => { finish = resolve; })
      : Promise.resolve({ values: [{ ...club, id: 'club-2' }], failed: 0 }));
    mocks.assets.mockImplementation((_ctx, id) => Promise.resolve(id === 'club-1' ? [photo] : []));
    let displayed = cached;
    const snapshots: string[][] = [];
    const pending = loadLiveMediaFeed(ctx, next => {
      displayed = retainMediaFeed(displayed, next);
      snapshots.push(displayed.posts.flatMap(post => post.assets.map(asset => asset.id)));
    });
    await vi.waitFor(() => expect(snapshots.length).toBeGreaterThan(0));
    expect(snapshots.every(ids => ids.includes('photo-1'))).toBe(true);
    finish?.({ values: [club], failed: 0 });
    displayed = retainMediaFeed(displayed, await pending);
    expect(displayed.posts[0].assets[0].id).toBe('photo-1');
    expect(snapshots.every(ids => ids.includes('photo-1'))).toBe(true);
  });
  it('loads one page per club, then merges split albums only on explicit continuation', async () => {
    const cursor = { club_id: 'club-1', revision: 1n, before: 'photo-1' };
    mocks.assets.mockResolvedValueOnce({ assets: [{ ...photo, album_id: ['album'] }], next: cursor, bounded: true })
      .mockResolvedValueOnce({ assets: [{ ...photo, id: 'photo-2', created_at_ms: 9n, album_id: ['album'] }], next: null, bounded: true });
    const continuation: MediaFeedContinuation = {};
    const first = await loadLiveMediaFeed(ctx, undefined, continuation);
    expect(mocks.assets).toHaveBeenCalledTimes(1);
    expect(first.hasMore).toBe(true); expect(first.incomplete).toBe(true);
    expect(first.posts).toHaveLength(1);
    const last = await continuation.loadMore?.();
    expect(mocks.assets).toHaveBeenCalledTimes(2);
    expect(last?.posts).toHaveLength(1);
    expect(last?.posts[0].assets.map(a => a.id)).toEqual(['photo-2', 'photo-1']);
    expect(last?.hasMore).toBe(false); expect(last?.incomplete).toBe(false);
  });
  it('keeps acknowledged earlier pages when a continuation is rejected, without claiming completeness', async () => {
    mocks.assets.mockResolvedValueOnce({ assets: [photo], next: { club_id: 'club-1', revision: 1n, before: 'key' }, bounded: true })
      .mockRejectedValueOnce(Error('Media page revision changed'));
    const continuation: MediaFeedContinuation = {};
    await loadLiveMediaFeed(ctx, undefined, continuation);
    const last = await continuation.loadMore?.();
    expect(last?.posts[0].assets[0].id).toBe('photo-1');
    expect(last?.sources).toEqual([{ clubId: 'club-1', state: 'failed' }]);
    expect(last?.incomplete).toBe(true);
  });
  it('coalesces overlapping continuation clicks and stops cancelled requests from reading more pages', async () => {
    const abort = new AbortController();
    const continuation: MediaFeedContinuation = {};
    mocks.assets.mockResolvedValueOnce({ assets: [photo], next: { club_id: 'club-1', revision: 1n, before: 'key' }, bounded: true });
    await loadLiveMediaFeed(ctx, undefined, continuation, abort.signal);
    let finish: ((value: unknown) => void) | undefined;
    mocks.assets.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    const first = continuation.loadMore?.(); const second = continuation.loadMore?.();
    expect(first).toBe(second);
    await vi.waitFor(() => expect(mocks.assets).toHaveBeenCalledTimes(2));
    abort.abort(); finish?.({ assets: [{ ...photo, id: 'late' }], next: null, bounded: true });
    const last = await first;
    expect(last?.posts.flatMap(post => post.assets.map(a => a.id))).toEqual(['photo-1']);
  });
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
  it('starts a ready club gallery while the other owning-group profile is still pending', async () => {
    mocks.memberIds.mockResolvedValue(['club-1', 'club-2']);
    let finish: ((value: unknown) => void) | undefined;
    mocks.profiles.mockImplementation((_ctx, ids: string[]) => ids[0] === 'club-1'
      ? Promise.resolve({ values: [club], failed: 0 })
      : new Promise(resolve => { finish = resolve; }));
    mocks.assets.mockImplementation((_ctx, id) => Promise.resolve(id === 'club-1' ? [photo] : []));
    const updates: Awaited<ReturnType<typeof loadLiveMediaFeed>>[] = [];
    let done = false;
    const pending = loadLiveMediaFeed(ctx, value => updates.push(value)).then(value => { done = true; return value; });
    await vi.waitFor(() => expect(updates.some(value => value.posts.length === 1)).toBe(true));
    expect(done).toBe(false);
    expect(mocks.assets).toHaveBeenCalledWith(ctx, 'club-1');
    expect(mocks.assets).not.toHaveBeenCalledWith(ctx, 'club-2');
    expect(updates.at(-1)?.incomplete).toBe(true);
    finish?.({ values: [{ ...club, id: 'club-2' }], failed: 0 });
    expect((await pending).incomplete).toBe(false);
  });
  it('never reads a denied club gallery and retains another club without claiming completeness', async () => {
    mocks.memberIds.mockResolvedValue(['club-1', 'club-2']);
    mocks.profiles.mockImplementation(async (_ctx, ids: string[]) => {
      if (ids[0] === 'club-2') throw new Error('Club access denied');
      return { values: [club], failed: 0 };
    });
    const feed = await loadLiveMediaFeed(ctx);
    expect(feed.posts.map(post => post.representativeAssetId)).toEqual(['photo-1']);
    expect(feed.sources).toContainEqual({ clubId: 'club-2', state: 'denied' });
    expect(feed.incomplete).toBe(true);
    expect(mocks.assets).not.toHaveBeenCalledWith(ctx, 'club-2');
  });
  it('does not read photos or offer uploads for a removed club', async () => {
    mocks.profiles.mockResolvedValue({ values: [], failed: 0 });
    const feed = await loadLiveMediaFeed(ctx);
    expect(feed.posts).toEqual([]); expect(feed.options.clubs).toEqual([]);
    expect(feed.incomplete).toBe(false); expect(mocks.assets).not.toHaveBeenCalled();
  });
});