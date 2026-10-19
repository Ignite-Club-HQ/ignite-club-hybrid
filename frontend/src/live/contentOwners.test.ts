import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ asset: vi.fn(), card: vi.fn(), clubs: vi.fn(), leagues: vi.fn(), news: vi.fn() }));
vi.mock('./features/media', () => ({ getLiveAsset: mocks.asset, getLiveGalleryChatCard: mocks.card }));
vi.mock('./features/membership', () => ({ listLiveMembershipClubs: mocks.clubs }));
vi.mock('./features/miniLeagues', () => ({ listMyLiveMiniLeagues: mocks.leagues }));
vi.mock('./features/club', () => ({ listLiveNewsMulti: mocks.news }));
import { lookupEntityClub } from './groupSessionLive';
describe('authorized content owners', () => {
  const context = {} as never;
  beforeEach(() => { vi.resetAllMocks(); mocks.clubs.mockResolvedValue([{ id: 'club-a' }]); mocks.leagues.mockResolvedValue([]); });
  it('uses the authorized photo record rather than the selected club', async () => {
    mocks.asset.mockResolvedValue({ club_id: 'club-b' });
    expect(await lookupEntityClub(context, 'photo', 'photo-b')).toBe('club-b');
    expect(mocks.asset).toHaveBeenCalledWith(context, 'photo-b');
  });
  it('does not invent owners for inaccessible photos or cards', async () => {
    mocks.asset.mockResolvedValue(null); mocks.card.mockResolvedValue(null);
    expect(await lookupEntityClub(context, 'photo', 'private')).toBeNull();
    expect(await lookupEntityClub(context, 'galleryCard', 'private')).toBeNull();
  });
  it('discovers articles through authorized club and league audiences', async () => {
    mocks.leagues.mockResolvedValue([{ club_id: 'club-b' }]);
    mocks.news.mockResolvedValue([{ id: 'article-b', club_id: 'club-b' }]);
    expect(await lookupEntityClub(context, 'news', 'article-b')).toBe('club-b');
    expect(mocks.news).toHaveBeenCalledWith(context, ['club-a', 'club-b']);
  });
  it('propagates discovery failures', async () => {
    mocks.asset.mockRejectedValue(new Error('offline'));
    await expect(lookupEntityClub(context, 'photo', 'photo-b')).rejects.toThrow('offline');
  });
});