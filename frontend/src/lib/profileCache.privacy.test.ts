import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/live/featureRouter', () => ({ withFeatureBackend: async (_: string, providers: any) => providers.icp({}) }));
vi.mock('@/live/features/identityAccessClient', () => ({ listLiveProfilesByIds: mocks.read }));
import { cacheProfiles, clearProfileCache, fetchProfilesWithCache, getProfileFromCache, onProfileCacheUpdate } from './profileCache';
beforeEach(() => { clearProfileCache(); vi.resetAllMocks(); });
describe('shared profile cache privacy', () => {
  it('settles old requests on clear and cannot repopulate names from late replies', async () => {
    let release: (rows: unknown) => void = () => {};
    mocks.read.mockImplementationOnce(() => new Promise(resolve => { release = resolve; }));
    const notified = vi.fn(); const unsubscribe = onProfileCacheUpdate(notified);
    try {
      const pending = fetchProfilesWithCache(['person']);
      await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
      clearProfileCache();
      expect(await pending).toEqual(new Map());
      release([{ account_id: 'person', display_name: 'Previous account', avatar_ref: [] }]);
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(getProfileFromCache('person')).toBeNull();
      expect(notified).not.toHaveBeenCalled();
    } finally { unsubscribe(); }
  });
  it('never asks the generic reader to decrypt private references', async () => {
    mocks.read.mockResolvedValue([{ account_id: 'person', display_name: null, avatar_ref: [] }]);
    await fetchProfilesWithCache(['person']);
    expect(mocks.read).toHaveBeenCalledWith({}, ['person'], { hydratePrivateNames: false });
    expect(getProfileFromCache('person')?.display_name).toBeNull();
  });
  it('does not merge captured cached labels after an account switch', async () => {
    cacheProfiles([{ id: 'known', display_name: 'Old known name' }]);
    mocks.read.mockImplementation(() => new Promise(() => {}));
    const pending = fetchProfilesWithCache(['known', 'missing']);
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalled());
    clearProfileCache();
    expect(await pending).toEqual(new Map());
  });
  it('late failed batches do not delete replacement requests or use new-account fallbacks', async () => {
    let rejectOld: (error: Error) => void = () => {};
    mocks.read.mockImplementationOnce(() => new Promise((_, reject) => { rejectOld = reject; }))
      .mockResolvedValueOnce([{ account_id: 'person', display_name: 'Current', avatar_ref: [] }]);
    const old = fetchProfilesWithCache(['person']);
    await vi.waitFor(() => expect(mocks.read).toHaveBeenCalledOnce());
    clearProfileCache();
    const current = await fetchProfilesWithCache(['person']);
    rejectOld(new Error('Late failure'));
    expect(await old).toEqual(new Map());
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(current.get('person')?.display_name).toBe('Current');
    expect(getProfileFromCache('person')?.display_name).toBe('Current');
  });
});