import { describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ readAcross: vi.fn(), readMemberGroups: vi.fn(), grants: vi.fn() }));
vi.mock('./domains', () => ({ connectLiveClubDomain: async () => ({ actor: { my_role_grants: state.grants } }) }));
vi.mock('./generalActivation', () => ({ routingActive: async () => true }));
vi.mock('./ownerTestRouting', () => ({ readOwnerTestRoute: async () => null, readOwnerTestRouteCached: async () => null }));
vi.mock('./groupDispatch', () => ({ clubDispatch: { readAcross: state.readAcross, readMemberGroups: state.readMemberGroups } }));
import { fetchMyRoleGrantsEverywhere } from './features/myRoleGrants';
import { markScopedContext } from './scopedContext';

describe('role grants inside a fan-out leg', () => {
  it('reads only that canister instead of fanning out again', async () => {
    state.grants.mockResolvedValue([{ role: 'club_admin', club: ['g2-club'], team: [] }]);
    const ctx = markScopedContext({ target: {}, identity: {} }) as never;
    expect(await fetchMyRoleGrantsEverywhere(ctx)).toEqual([{ role: 'club_admin', club: ['g2-club'], team: [] }]);
    expect(state.readAcross).not.toHaveBeenCalled();
  });
  it('ordinary calls fetch roles only from verified member groups', async () => {
    const grants = [{ role: 'club_admin', club: ['g1-club'], team: [] }, { role: 'coach', club: ['g2-club'], team: ['u9'] }];
    state.readMemberGroups.mockResolvedValue(grants);
    expect(await fetchMyRoleGrantsEverywhere({ target: {}, identity: {} } as never)).toEqual(grants);
    expect(state.readMemberGroups).toHaveBeenCalledWith('membership', 'club_domain', expect.any(Function), expect.any(Function));
    expect(state.readAcross).not.toHaveBeenCalled();
  });
  it('a failed member-source read never becomes an empty complete inventory', async () => {
    state.readMemberGroups.mockRejectedValueOnce(new Error('Member source unavailable'));
    const ctx = { target: {}, identity: { getPrincipal: () => ({ toText: () => 'other-person' }) } } as never;
    await expect(fetchMyRoleGrantsEverywhere(ctx)).rejects.toThrow('Member source unavailable');
    expect(state.readAcross).not.toHaveBeenCalled();
  });
});
