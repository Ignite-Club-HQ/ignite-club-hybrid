import { describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ fetch: vi.fn() }));
vi.mock('@/lib/profileCache', () => ({ fetchProfilesWithCache: mocks.fetch }));
import { roleMemberProfiles } from './roleMemberProfiles';

describe('role member display profiles', () => {
  it('looks up normalized accounts together while preserving grant identities', async () => {
    mocks.fetch.mockResolvedValue(new Map([['abc-aa', { display_name: 'Paul Cranwell', avatar_url: 'avatar' }]]));
    const profiles = await roleMemberProfiles(['principal:abc-aa', 'principal:abc-aa']);
    expect(mocks.fetch).toHaveBeenCalledWith(['abc-aa']);
    expect(profiles.get('principal:abc-aa')).toEqual({ id: 'principal:abc-aa', display_name: 'Paul Cranwell', avatar_url: 'avatar' });
  });
  it('uses a neutral member label when a profile has not been supplied', async () => {
    mocks.fetch.mockResolvedValue(new Map());
    expect((await roleMemberProfiles(['principal:missing-aa'])).get('principal:missing-aa')?.display_name).toBe('Member');
  });
});