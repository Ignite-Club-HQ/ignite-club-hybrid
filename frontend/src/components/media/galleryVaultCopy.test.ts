import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ allowance: vi.fn(), existing: vi.fn(), save: vi.fn(), upload: vi.fn() }));
vi.mock('@/live/domains', () => ({ connectLiveClubDomain: async () => ({ actor: { get_media_allowance: mocks.allowance } }),
  connectLiveVaultDomain: async () => ({ actor: { get_gallery_copy: mocks.existing, register_gallery_copy: mocks.save } }) }));
vi.mock('@/live/mediaUpload', () => ({ tryUploadMediaToBlobStore: mocks.upload }));
import { copyGalleryAssetToVault } from './galleryVaultCopy';
import type { FeatureBackendContext } from '@/live/featureRouter';
const ctx = {} as FeatureBackendContext;
const input = { assetId: 'photo-1', clubId: 'club-1', teamId: 'team-1', file: new Blob(['private photo'], { type: 'image/jpeg' }), name: 'photo.jpg' };
beforeEach(() => { vi.clearAllMocks(); mocks.allowance.mockResolvedValue({ Ok: { premium: true } }); mocks.existing.mockResolvedValue({ Ok: [] });
  mocks.upload.mockResolvedValue({ url: 'https://store.raw.icp0.io/private', blobRef: { canister: 'store', path: 'private', content_hash: 'hash' } });
  mocks.save.mockResolvedValue({ Ok: { id: 'vault-copy' } }); });
describe('private gallery Vault copies', () => {
  it('uploads distinct per-file encrypted bytes under the exact team scope', async () => {
    expect(await copyGalleryAssetToVault(ctx, input)).toEqual({ id: 'vault-copy' });
    expect(mocks.allowance).toHaveBeenCalledWith('club-1', ['team-1']);
    expect(mocks.upload).toHaveBeenCalledWith(expect.objectContaining({ context: ctx, lock: 'own', file: input.file,
      storagePath: expect.stringMatching(/^clubs\/club-1\/vault\/teams\/team-1\/gallery-/) }));
    expect(mocks.save.mock.calls[0]?.[0]).toBe('photo-1');
  });
  it('does not create a copy for a Free scope', async () => {
    mocks.allowance.mockResolvedValue({ Ok: { premium: false } });
    expect(await copyGalleryAssetToVault(ctx, input)).toBeNull(); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('reuses the acknowledged source copy without reuploading', async () => {
    mocks.existing.mockResolvedValue({ Ok: [{ id: 'existing' }] });
    expect(await copyGalleryAssetToVault(ctx, input)).toEqual({ id: 'existing' }); expect(mocks.upload).not.toHaveBeenCalled();
  });
  it('preserves unknown registration failures instead of reporting success', async () => {
    mocks.save.mockRejectedValue(new Error('lost reply'));
    await expect(copyGalleryAssetToVault(ctx, input)).rejects.toThrow('lost reply'); expect(mocks.save).toHaveBeenCalledTimes(1);
  });
});
