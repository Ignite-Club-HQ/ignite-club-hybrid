import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from '../featureRouter';
import { readMembershipDiscovery } from '../membershipDiscoveryCache';
import { clearRoleGrantsMemo } from '../roleGrantsMemo';
const actor = vi.hoisted(() => ({ accept_team_invite: vi.fn(), remove_member: vi.fn(), restore_club: vi.fn(), claim_admin_join_link: vi.fn() }));
vi.mock('../domains', () => ({ connectLiveClubDomain: async () => ({ actor }), connectLiveMiniLeagueDomain: async () => ({ actor }) }));
import { acceptLiveTeamInvite, removeLiveMember } from './membership';
import { restoreLiveClub } from './club';
import { claimLiveAdminJoinLink } from './miniLeagues';
const ctx = {} as FeatureBackendContext;
beforeEach(() => { clearRoleGrantsMemo(); vi.clearAllMocks(); });
describe('membership mutation discovery hooks', () => {
  it.each([
    ['team invite', 'accept_team_invite', () => acceptLiveTeamInvite(ctx, 'invite-1')],
    ['member removal', 'remove_member', () => removeLiveMember(ctx, 'club-1', {} as never)],
    ['club restore', 'restore_club', () => restoreLiveClub(ctx, 'club-1')],
    ['league admin claim', 'claim_admin_join_link', () => claimLiveAdminJoinLink(ctx, 'token-1')],
  ] as const)('refreshes saved discovery after acknowledged %s and preserves it on refusal', async (_name, method, write) => {
    const read = vi.fn(async () => ['before']);
    await readMembershipDiscovery('source', read);
    actor[method].mockResolvedValue({ Err: 'Forbidden' });
    await expect(write()).rejects.toThrow('Forbidden');
    await readMembershipDiscovery('source', read);
    expect(read).toHaveBeenCalledTimes(1);
    actor[method].mockResolvedValue({ Ok: 'receipt-1' });
    expect(await write()).toBe('receipt-1');
    read.mockResolvedValue(['after']);
    expect(await readMembershipDiscovery('source', read)).toEqual(['after']);
    expect(read).toHaveBeenCalledTimes(2);
  });
});