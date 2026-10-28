import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ connect: vi.fn() }));
vi.mock('./domains', () => ({ connectLivePiiAccessControl: mocks.connect }));
vi.mock('./deviceMediaCache', () => ({ clearDeviceMediaCaches: vi.fn(), clearDeviceCachedPhotos: vi.fn(), clearStoredDeviceKeys: vi.fn(), forgetStoredClubKey: vi.fn(), loadStoredClubKey: () => null, storeClubKey: vi.fn() }));
import { clearPiiVetKeyCache, isClubMediaLockSupported } from './piiVetKeys';
describe('group-scoped encryption capability cache', () => {
  beforeEach(() => { clearPiiVetKeyCache(); mocks.connect.mockReset(); });
  it('does not reuse one group’s key support result for another group', async () => {
    mocks.connect.mockImplementation(async target => ({ actor: { club_media_lock_version: async () => { if (target.canisterIds.pii_access_control === 'old-pii') throw new Error('unsupported'); return 1n; } } }));
    const context = (id: string) => ({ target: { host: 'https://icp-api.io', canisterIds: { pii_access_control: id } }, identity: {} }) as never;
    expect(await isClubMediaLockSupported(context('old-pii'))).toBe(false);
    expect(await isClubMediaLockSupported(context('new-pii'))).toBe(true);
    expect(await isClubMediaLockSupported(context('new-pii'))).toBe(true);
    expect(mocks.connect).toHaveBeenCalledTimes(2);
  });
});