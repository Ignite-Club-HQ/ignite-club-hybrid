import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupHoldsInvite } from './groupSessionLive';
import type { FeatureBackendContext } from './featureRouter';
const state = vi.hoisted(() => ({ join: vi.fn(), preview: vi.fn(), pending: vi.fn(), parent: vi.fn(), team: vi.fn() }));
vi.mock('./features/club', () => ({
  getLivePendingInvite: state.pending,
  getLiveParentInvite: state.parent,
  getLiveTeamInviteLinkByToken: state.team,
  getLiveShellTeamByToken: async () => null,
  resolveLiveInviteShortCode: async () => null,
}));
vi.mock('./domains', () => ({ connectLiveMiniLeagueDomain: async () => ({ actor: { get_join_link_by_token: state.join, get_player_invite_preview: state.preview } }) }));
const context = { target: { canisterIds: { mini_league_domain: 'group-b' } }, identity: {} } as unknown as FeatureBackendContext;
beforeEach(() => {
  state.join.mockReset(); state.preview.mockReset().mockResolvedValue({ Ok: [] });
  state.pending.mockReset().mockResolvedValue(null);
  state.parent.mockReset().mockRejectedValue(new Error('Load parent invite failed: Invite not found'));
  state.team.mockReset().mockResolvedValue(null);
});
describe('league join-token discovery', () => {
  it('locates legacy child-parent tokens without claiming a named league player', async () => {
    state.parent.mockResolvedValue({ id: 'inv-parent', child_id: 'child-a', club_id: 'club-b' });
    expect(await groupHoldsInvite(context, 'inv-parent')).toBe(true);
    expect(state.parent).toHaveBeenCalledWith(context, 'inv-parent');
    expect(state.preview).not.toHaveBeenCalled();
  });
  it('propagates club transport failure rather than reporting absence', async () => {
    state.pending.mockRejectedValue(new Error('Network timeout'));
    await expect(groupHoldsInvite(context, 'token')).rejects.toThrow('Network timeout');
    expect(state.parent).not.toHaveBeenCalled();
  });
  it('does not redirect a removed issuer or invalid child token to another contract', async () => {
    state.parent.mockRejectedValue(new Error('Load parent invite failed: Invite authorization changed'));
    await expect(groupHoldsInvite(context, 'token')).rejects.toThrow('authorization changed');
    expect(state.preview).not.toHaveBeenCalled();
  });
  it('does not swallow generic link authorization or transport errors', async () => {
    state.team.mockRejectedValue(new Error('Forbidden'));
    await expect(groupHoldsInvite(context, 'token')).rejects.toThrow('Forbidden');
  });
  it('recognizes a token held by the league canister', async () => {
    state.join.mockResolvedValue({ Ok: { token: 'league-token' } });
    expect(await groupHoldsInvite(context, 'league-token')).toBe(true);
    expect(state.join).toHaveBeenCalledWith('league-token');
  });
  it('recognizes a named player invite without probing generic links', async () => {
    state.preview.mockResolvedValue({ Ok: [{ token: 'named' }] });
    expect(await groupHoldsInvite(context, 'named')).toBe(true);
    expect(state.join).not.toHaveBeenCalled();
  });
  it('accepts only an explicit not-found as absence', async () => {
    state.join.mockResolvedValue({ Err: 'Join link not found' });
    expect(await groupHoldsInvite(context, 'missing')).toBe(false);
  });
  it('does not treat canister rejection as token absence', async () => {
    state.join.mockResolvedValue({ Err: 'Service unavailable' });
    await expect(groupHoldsInvite(context, 'league-token')).rejects.toThrow('Service unavailable');
  });
  it('does not probe an unconfigured league canister', async () => {
    expect(await groupHoldsInvite({ ...context, target: { ...context.target, canisterIds: {} } }, 'missing')).toBe(false);
    expect(state.join).not.toHaveBeenCalled();
  });
});