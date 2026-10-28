import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({
  active: true,
  shared: { host: 'https://icp-api.io', canisterIds: { media_blob_store: 'shared-store', pii_access_control: 'shared-pii' } },
  group: { host: 'https://icp-api.io', canisterIds: { media_blob_store: 'group-store', pii_access_control: 'group-pii' } },
  readAcross: vi.fn(), read: vi.fn(), cached: vi.fn(), identity: vi.fn(), decrypt: vi.fn(), saved: vi.fn(),
}));
vi.mock('./groupActivation', () => ({ SHIPPED_GATES: {}, activationStatus: () => ({ active: state.active }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => state.active, generalRoutingStatus: async () => ({ active: state.active, missing: [] }), cachedGeneralRoutingActive: () => state.active, clearGeneralRoutingCache: () => {} }));
vi.mock('./targetRegistry', () => ({ getActiveIcpTarget: () => state.shared }));
vi.mock('./internetIdentityAuth', () => ({ getCurrentInternetIdentityConfirmed: state.identity }));
vi.mock('./groupDispatch', () => ({ clubDispatch: { readAcross: state.readAcross, read: state.read } }));
vi.mock('./piiVetKeys', () => ({ clubIdFromMediaPath: (path: string) => /^clubs\/([^/]+)\//.exec(path)?.[1] ?? null, decryptClubMediaWithSavedKey: state.saved, tryDecryptClubMedia: async () => null, prewarmClubMediaKey: () => {}, parseSharedCiphertext: () => null, tryDecryptShared: async () => null, decryptPiiValue: state.decrypt }));
vi.mock('./deviceMediaCache', () => ({ readCachedPhoto: state.cached, writeCachedPhoto: vi.fn() }));
import { clearIcpPhotoResolutionCache, parseIcpBlobUrl, resolveIcpBlobObjectUrl } from './mediaDecrypt';
describe('grouped media decryption', () => {
  afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
  beforeEach(() => {
    clearIcpPhotoResolutionCache(); vi.clearAllMocks(); localStorage.clear(); state.active = true;
    state.readAcross.mockResolvedValue([state.group]); state.decrypt.mockResolvedValue(new Uint8Array([4, 5]));
    state.read.mockImplementation(async (_feature, _club, _domain, fn) => fn({ target: state.group }));
    state.cached.mockResolvedValue(null);
    state.identity.mockResolvedValue({ getPrincipal: () => ({ toText: () => 'parent-a' }) });
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2]).buffer })));
    vi.stubGlobal('URL', URL);
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:unlocked');
  });
  it('fetches the original store while deriving the key from its own group', async () => {
    expect(await resolveIcpBlobObjectUrl('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg')).toBe('blob:unlocked');
    expect(fetch).toHaveBeenCalledWith('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg');
    expect(state.decrypt.mock.calls[0][0].target).toEqual(state.group);
    expect(state.read).toHaveBeenCalledWith('media', 'club-b', 'media_metadata', expect.any(Function));
    expect(state.readAcross).not.toHaveBeenCalled();
  });
  it('refuses a store absent from the complete group inventory', async () => {
    state.readAcross.mockResolvedValue([]);
    await expect(resolveIcpBlobObjectUrl('https://unknown-store.raw.icp0.io/clubs/club-b/photo.jpg')).rejects.toThrow('approved group inventory');
    expect(fetch).not.toHaveBeenCalled();
    expect(state.decrypt).not.toHaveBeenCalled();
  });
  it('refuses competing encryption authorities for one store', async () => {
    state.readAcross.mockResolvedValue([state.group, { ...state.group, canisterIds: { ...state.group.canisterIds, pii_access_control: 'other-pii' } }]);
    await expect(resolveIcpBlobObjectUrl('https://group-store.raw.icp0.io/avatars/photo.jpg')).rejects.toThrow('conflicting encryption authorities');
    expect(fetch).not.toHaveBeenCalled();
  });
  it('keeps configured-store validation unchanged when routing is off', () => {
    state.active = false;
    expect(parseIcpBlobUrl('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg', state.shared as never)).toBeNull();
  });
  it('public photos never wait for identity or registry reads', async () => {
    expect(await resolveIcpBlobObjectUrl('https://example.com/photo.jpg')).toBeNull();
    expect(state.identity).not.toHaveBeenCalled();
    expect(state.readAcross).not.toHaveBeenCalled();
  });
  it('a still-encrypted saved copy opens with the saved club key, skipping routing and paid unlocks', async () => {
    localStorage.setItem('ignite_icp_internet_identity_session', JSON.stringify({ principal: 'parent-a' }));
    state.cached.mockResolvedValue({ ciphertext: new Uint8Array([1]), clubId: 'club-b', piiCanisterId: 'group-pii' });
    state.saved.mockReturnValue(new Uint8Array([4]));
    expect(await resolveIcpBlobObjectUrl('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg')).toBe('blob:unlocked');
    expect(state.identity).not.toHaveBeenCalled();
    expect(state.read).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
    expect(state.saved).toHaveBeenCalledWith('group-pii', 'parent-a', 'club-b', new Uint8Array([1]));
  });
  it('a saved copy without a saved club key (removed member) re-reads with authorization', async () => {
    localStorage.setItem('ignite_icp_internet_identity_session', JSON.stringify({ principal: 'parent-a' }));
    state.cached.mockResolvedValue({ ciphertext: new Uint8Array([1]), clubId: 'club-b', piiCanisterId: 'group-pii' });
    state.saved.mockReturnValue(null);
    await resolveIcpBlobObjectUrl('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg');
    expect(state.read).toHaveBeenCalled();
  });
  it('does not unlock a club photo against another club group store', async () => {
    state.read.mockImplementation(async (_feature, _club, _domain, fn) => fn({ target: state.shared }));
    await expect(resolveIcpBlobObjectUrl('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg')).rejects.toThrow('approved group inventory');
    expect(fetch).not.toHaveBeenCalled();
    expect(state.decrypt).not.toHaveBeenCalled();
  });
  it('shares concurrent and reopened photos without another download or routing read', async () => {
    localStorage.setItem('ignite_icp_internet_identity_session', JSON.stringify({ principal: 'parent-a' }));
    const url = 'https://group-store.raw.icp0.io/clubs/club-b/photo.jpg';
    expect(await Promise.all([resolveIcpBlobObjectUrl(url), resolveIcpBlobObjectUrl(url)])).toEqual(['blob:unlocked', 'blob:unlocked']);
    expect(await resolveIcpBlobObjectUrl(url)).toBe('blob:unlocked');
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(state.read).toHaveBeenCalledTimes(1);
    expect(state.decrypt).toHaveBeenCalledTimes(1);
  });
  it('does not share photos between accounts', async () => {
    const url = 'https://group-store.raw.icp0.io/clubs/club-b/photo.jpg';
    localStorage.setItem('ignite_icp_internet_identity_session', JSON.stringify({ principal: 'parent-a' }));
    await resolveIcpBlobObjectUrl(url);
    localStorage.setItem('ignite_icp_internet_identity_session', JSON.stringify({ principal: 'parent-b' }));
    state.identity.mockResolvedValue({ getPrincipal: () => ({ toText: () => 'parent-b' }) });
    await resolveIcpBlobObjectUrl(url);
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('allows a fresh attempt after a failed photo download', async () => {
    localStorage.setItem('ignite_icp_internet_identity_session', JSON.stringify({ principal: 'parent-a' }));
    const url = 'https://group-store.raw.icp0.io/clubs/club-b/photo.jpg';
    vi.mocked(fetch).mockRejectedValueOnce(new Error('offline'));
    await expect(resolveIcpBlobObjectUrl(url)).rejects.toThrow('offline');
    await expect(resolveIcpBlobObjectUrl(url)).resolves.toBe('blob:unlocked');
    expect(fetch).toHaveBeenCalledTimes(2);
  });
  it('discards an old pending result after sign-out clears the cache', async () => {
    localStorage.setItem('ignite_icp_internet_identity_session', JSON.stringify({ principal: 'parent-a' }));
    let finish: ((bytes: Uint8Array) => void) | undefined;
    state.decrypt.mockImplementationOnce(() => new Promise<Uint8Array>(resolve => { finish = resolve; }));
    const request = resolveIcpBlobObjectUrl('https://group-store.raw.icp0.io/clubs/club-b/photo.jpg');
    await vi.waitFor(() => expect(finish).toBeDefined());
    clearIcpPhotoResolutionCache();
    finish?.(new Uint8Array([1]));
    await expect(request).rejects.toThrow('account changed');
  });
});