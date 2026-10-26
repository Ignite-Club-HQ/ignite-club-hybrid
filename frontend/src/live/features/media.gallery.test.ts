import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from '../featureRouter';
const mocks = vi.hoisted(() => ({ card: vi.fn(), send: vi.fn(), absent: vi.fn(), ensure: vi.fn(), views: vi.fn(), counts: vi.fn(), scope: vi.fn() }));
vi.mock('../domains', () => ({ connectLiveMediaMetadata: async () => ({ actor: { save_gallery_chat_card: mocks.card,
  record_gallery_view: mocks.views, read_gallery_view_counts: mocks.counts } }) }));
vi.mock('./messaging', () => ({ sendLiveMessage: mocks.send, isLiveConversationAbsent: mocks.absent, ensureLiveClubConversations: mocks.ensure }));
vi.mock('../contentRouting', () => ({ readContentInScope: async (ctx: unknown, feature: string, scope: unknown, call: (ctx: unknown) => unknown) => {
  mocks.scope(feature, scope); return call(ctx);
} }));
import { publishLiveGalleryChatCard, recordLiveGalleryView, readLiveGalleryViewCounts } from './media';
const ctx = {} as FeatureBackendContext;
beforeEach(() => { vi.clearAllMocks(); mocks.card.mockResolvedValue({ Ok: { id: 'card-1' } }); mocks.send.mockResolvedValue({ id: 'message-1' });
  mocks.absent.mockReset().mockResolvedValue(false); mocks.ensure.mockReset().mockResolvedValue(1);
  mocks.views.mockResolvedValue({ Ok: 3n }); mocks.counts.mockResolvedValue({ Ok: [['photo-1', 3n]] }); });
describe('ICP gallery publication and views', () => {
  it('posts the validated card token to its owning club/team with one stable receipt', async () => {
    await publishLiveGalleryChatCard(ctx, { clubId: 'club-1', teamId: 'team-1', assetIds: ['photo-1', 'photo-2'], heroUrl: 'https://store/photo', receipt: 'gallery-album' });
    expect(mocks.card).toHaveBeenCalledWith([], 'club-1', 'team-1', [], 'gallery-album', ['photo-1'], ['https://store/photo'], 2, ['photo-1', 'photo-2'], false, false);
    expect(mocks.scope).toHaveBeenCalledWith('messaging', { clubId: 'club-1' });
    expect(mocks.send).toHaveBeenCalledWith(ctx, 'team-1', '[gallery:card-1]', 'gallery-album');
    expect(mocks.ensure).not.toHaveBeenCalled();
    expect(mocks.scope).toHaveBeenLastCalledWith('messaging', expect.objectContaining({ clubId: 'club-1', attempts: 1, writeKey: expect.any(String) }));
  });
  it('prepares a confirmed missing team chat at its club authority before one send', async () => {
    mocks.absent.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    await publishLiveGalleryChatCard(ctx, { clubId: 'club-2', teamId: 'team-2', assetIds: ['photo-2'], heroUrl: '', receipt: 'gallery-2' });
    expect(mocks.ensure).toHaveBeenCalledExactlyOnceWith(ctx, 'club-2');
    expect(mocks.scope).toHaveBeenCalledWith('membership', expect.objectContaining({ clubId: 'club-2', attempts: 1 }));
    expect(mocks.absent).toHaveBeenCalledTimes(2);
    expect(mocks.send).toHaveBeenCalledExactlyOnceWith(ctx, 'team-2', '[gallery:card-1]', 'gallery-2');
    expect(mocks.absent.mock.invocationCallOrder[1]).toBeLessThan(mocks.send.mock.invocationCallOrder[0]);
  });
  it.each(['Access forbidden', 'Remote call failed'])('does not repair or send after a failed presence read: %s', async reason => {
    mocks.absent.mockRejectedValueOnce(new Error(reason));
    await expect(publishLiveGalleryChatCard(ctx, { clubId: 'club-1', teamId: 'team-1', assetIds: ['photo-1'], heroUrl: '', receipt: 'r' })).rejects.toThrow(reason);
    expect(mocks.ensure).not.toHaveBeenCalled(); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('does not send if provisioning leaves the team chat absent', async () => {
    mocks.absent.mockResolvedValue(true);
    await expect(publishLiveGalleryChatCard(ctx, { clubId: 'club-1', teamId: 'team-1', assetIds: ['photo-1'], heroUrl: '', receipt: 'r' })).rejects.toThrow('Team chat could not be prepared');
    expect(mocks.ensure).toHaveBeenCalledTimes(1); expect(mocks.send).not.toHaveBeenCalled();
  });
  it('does not replay an unknown send or recreate the confirmed gallery card', async () => {
    mocks.send.mockRejectedValueOnce(new Error('Write outcome uncertain'));
    await expect(publishLiveGalleryChatCard(ctx, { clubId: 'club-1', teamId: 'team-1', assetIds: ['photo-1'], heroUrl: '', receipt: 'r' })).rejects.toThrow('Write outcome uncertain');
    expect(mocks.card).toHaveBeenCalledTimes(1); expect(mocks.send).toHaveBeenCalledTimes(1); expect(mocks.ensure).not.toHaveBeenCalled();
  });
  it('does not publish a chat token when the card is denied', async () => {
    mocks.card.mockResolvedValue({ Err: 'Asset access required' });
    await expect(publishLiveGalleryChatCard(ctx, { clubId: 'club-1', teamId: 'team-1', assetIds: ['foreign'], heroUrl: '', receipt: 'receipt' })).rejects.toThrow('Asset access required');
    expect(mocks.send).not.toHaveBeenCalled();
  });
  it('reads and records view counts only through media authority', async () => {
    expect(await recordLiveGalleryView(ctx, 'photo-1')).toBe(3n);
    expect(await readLiveGalleryViewCounts(ctx, ['photo-1'])).toEqual([['photo-1', 3n]]);
    expect(mocks.views).toHaveBeenCalledWith('photo-1'); expect(mocks.counts).toHaveBeenCalledWith(['photo-1']);
  });
});
