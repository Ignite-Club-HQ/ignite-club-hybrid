import { beforeEach, describe, expect, it, vi } from 'vitest';
import { groupHoldsInvite } from './groupSessionLive';
import type { FeatureBackendContext } from './featureRouter';
const state = vi.hoisted(() => ({ join: vi.fn(), preview: vi.fn() }));
vi.mock('./features/club', () => ({
  getLivePendingInvite: async () => null,
  getLiveTeamInviteLinkByToken: async () => null,
  getLiveShellTeamByToken: async () => null,
  resolveLiveInviteShortCode: async () => null,
}));
vi.mock('./domains', () => ({ connectLiveMiniLeagueDomain: async () => ({ actor: { get_join_link_by_token: state.join, get_player_invite_preview: state.preview } }) }));
const context = { target: { canisterIds: { mini_league_domain: 'group-b' } }, identity: {} } as unknown as FeatureBackendContext;
beforeEach(() => { state.join.mockReset(); state.preview.mockReset().mockResolvedValue({ Ok: [] }); });
describe('league join-token discovery', () => {
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