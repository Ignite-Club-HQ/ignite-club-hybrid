import { describe, it, expect, vi } from 'vitest';
const state = vi.hoisted(() => ({ readAcross: vi.fn(), grants: vi.fn() }));
vi.mock('../domains', () => ({ connectLiveClubDomain: async () => ({ actor: { my_role_grants: state.grants } }) }));
vi.mock('../generalActivation', () => ({ routingActive: async () => true }));
vi.mock('../ownerTestRouting', () => ({ readOwnerTestRoute: async () => null }));
vi.mock('../groupDispatch', () => ({ clubDispatch: { readAcross: state.readAcross } }));
import { fetchMyRoleGrantsEverywhere } from './myRoleGrants';
import { markScopedContext } from '../scopedContext';

describe('role grants inside a fan-out leg', () => {
  it('reads only that canister instead of fanning out again', async () => {
    state.grants.mockResolvedValue([{ role: 'club_admin', club: ['g2-club'], team: [] }]);
    const ctx = markScopedContext({ target: {}, identity: {} }) as never;
    expect(await fetchMyRoleGrantsEverywhere(ctx)).toEqual([{ role: 'club_admin', club: ['g2-club'], team: [] }]);
    expect(state.readAcross).not.toHaveBeenCalled();
  });
  it('still fans out for an ordinary call', async () => {
    state.readAcross.mockResolvedValue([]);
    await fetchMyRoleGrantsEverywhere({ target: {}, identity: {} } as never);
    expect(state.readAcross).toHaveBeenCalledOnce();
  });
});
