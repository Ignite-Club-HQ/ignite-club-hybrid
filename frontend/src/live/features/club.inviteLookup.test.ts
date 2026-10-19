import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from '../featureRouter';
const state = vi.hoisted(() => ({ preview: vi.fn() }));
vi.mock('../domains', () => ({ connectLiveClubDomain: async () => ({ actor: { get_pending_invite: state.preview } }) }));
import { getLivePendingInvite } from './club';
const ctx = {} as FeatureBackendContext;
beforeEach(() => { state.preview.mockReset(); });
describe('pending email invitation discovery', () => {
  it('returns the actual pending invitation', async () => {
    const invite = { id: 'pinv-a', club_id: 'club-b' };
    state.preview.mockResolvedValue({ Ok: invite });
    expect(await getLivePendingInvite(ctx, 'pinv-a')).toEqual(invite);
  });
  it.each(['Invite not found', 'Invite revoked'])('treats %s as explicit absence', async Err => {
    state.preview.mockResolvedValue({ Err });
    expect(await getLivePendingInvite(ctx, 'pinv-a')).toBeNull();
  });
  it('does not turn a failed canister call into absence', async () => {
    state.preview.mockImplementation(() => { throw new Error('Connection lost'); });
    await expect(getLivePendingInvite(ctx, 'pinv-a')).rejects.toThrow('Connection lost');
  });
  it('does not turn an authorization error into absence', async () => {
    state.preview.mockResolvedValue({ Err: 'Forbidden' });
    await expect(getLivePendingInvite(ctx, 'pinv-a')).rejects.toThrow('Forbidden');
  });
});