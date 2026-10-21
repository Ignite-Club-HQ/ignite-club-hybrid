import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  active: true,
  shared: { host: 'https://icp-api.io', canisterIds: { media_blob_store: 'shared-store', pii_access_control: 'shared-pii' } },
  group: { host: 'https://icp-api.io', canisterIds: { media_blob_store: 'group-store', pii_access_control: 'group-pii' } },
  readAcross: vi.fn(), decrypt: vi.fn(),
}));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: state.active }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => state.active, generalRoutingStatus: async () => ({ active: state.active, missing: [] }), cachedGeneralRoutingActive: () => state.active, clearGeneralRoutingCache: () => {} }));
vi.mock('./targetRegistry', () => ({ getActiveIcpTarget: () => state.shared }));
vi.mock('./internetIdentityAuth', () => ({ getCurrentInternetIdentityConfirmed: async () => ({ getPrincipal: () => ({ toText: () => 'parent-a' }) }) }));
vi.mock('./groupDispatch', () => ({ clubDispatch: { readAcross: state.readAcross } }));
vi.mock('./piiVetKeys', () => ({ clubIdFromMediaPath: () => 'club-b', tryDecryptClubMedia: async () => null, decryptPiiValue: state.decrypt }));
vi.mock('./deviceMediaCache', () => ({ readCachedPhoto: async () => null, writeCachedPhoto: vi.fn() }));
import { parseIcpBlobUrl, resolveIcpBlobObjectUrl } from './mediaDecrypt';
describe('grouped media decryption', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    vi.clearAllMocks(); localStorage.clear(); state.active = true;
    state.readAcross.mockResolvedValue([state.group]); state.decrypt.mockResolvedValue(new Uint8Array([4, 5]));
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer })));
    vi.stubGlobal('URL', URL);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unlocked');
  });
  it('fetches the original store while deriving the key from its own group', async () => {
    expect(await resolveIcpBlobObjectUrl('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg')).toBe('blob:unlocked');
    expect(fetch).toHaveBeenCalledWith('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg');
    expect(state.decrypt.mock.calls[0][0].target).toEqual(state.group);
  });
  it('refuses a store absent from the complete group inventory', async () => {
    state.readAcross.mockResolvedValue([]);
    await expect(resolveIcpBlobObjectUrl('https://unknown-store.raw.icp0.io/clubs/club-b/photo.jpg')).rejects.toThrow('approved group inventory');
    expect(fetch).not.toHaveBeenCalled();
    expect(state.decrypt).not.toHaveBeenCalled();
  });
  it('refuses competing encryption authorities for one store', async () => {
    state.readAcross.mockResolvedValue([state.group, { ...state.group, canisterIds: { ...state.group.canisterIds, pii_access_control: 'other-pii' } }]);
    await expect(resolveIcpBlobObjectUrl('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg')).rejects.toThrow('conflicting encryption authorities');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps configured-store validation unchanged when routing is off', () => {
    state.active = false;
    expect(parseIcpBlobUrl('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg', state.shared as never)).toBeNull();
  });
});