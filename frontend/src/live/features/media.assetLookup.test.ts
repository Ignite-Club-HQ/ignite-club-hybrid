import { beforeEach, describe, expect, it, vi } from 'vitest';
const state = vi.hoisted(() => ({ getAsset: vi.fn() }));
vi.mock('../domains', () => ({ connectLiveMediaMetadata: async () => ({ actor: { get_asset: state.getAsset } }) }));
import { getLiveAsset } from './media';
import { lookupEntityClub } from '../groupSessionLive';

describe('photo discovery across groups', () => {
  beforeEach(() => vi.resetAllMocks());
  it('treats an empty optional in the other group as no owner, not a page error', async () => {
    state.getAsset.mockResolvedValue([]);
    expect(await getLiveAsset({} as never, 'group1-photo')).toBeNull();
    expect(await lookupEntityClub({} as never, 'photo', 'group1-photo')).toBeNull();
  });
  it('returns the owning club when the group contains the photo', async () => {
    state.getAsset.mockResolvedValue([{ id: 'photo', club_id: 'giddy-goat' }]);
    expect(await lookupEntityClub({} as never, 'photo', 'photo')).toBe('giddy-goat');
  });
  it('does not conceal network or authorization rejections as an absent photo', async () => {
    state.getAsset.mockRejectedValue(new Error('Account admission denied'));
    await expect(lookupEntityClub({} as never, 'photo', 'photo')).rejects.toThrow('Account admission denied');
  });
});