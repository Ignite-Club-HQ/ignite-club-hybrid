import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FeatureBackendContext } from '../featureRouter';
import { readMembershipDiscovery } from '../membershipDiscoveryCache';
import { clearRoleGrantsMemo } from '../roleGrantsMemo';
const actor = vi.hoisted(() => ({ accept_team_invite: vi.fn(), remove_member: vi.fn(), restore_club: vi.fn(), claim_admin_join_link: vi.fn(),
  restore_member: vi.fn(), set_own_child_team: vi.fn(), soft_delete_team: vi.fn(), restore_team: vi.fn(), delete_team_permanent: vi.fn(),
  link_guardian: vi.fn(), unlink_guardian: vi.fn(), admin_link_child_to_parent: vi.fn(), create_child_for_parent_on_team: vi.fn(),
  move_member_to_team: vi.fn(), move_child_to_team: vi.fn(), bulk_add_team_members: vi.fn(), create_child_for_parent_in_club: vi.fn(),
  delete_own_child: vi.fn(), set_own_child_guardian: vi.fn() }));
vi.mock('../domains', () => ({ connectLiveClubDomain: async () => ({ actor }), connectLiveMiniLeagueDomain: async () => ({ actor }) }));
import { acceptLiveTeamInvite, removeLiveMember } from './membership';
import { restoreLiveClub, restoreLiveMember, removeLiveMember as removeViaClub, setMyLiveChildTeam, softDeleteLiveTeam, restoreLiveTeam,
  deleteLiveTeamPermanent, linkLiveGuardian, unlinkLiveGuardian, adminLinkLiveChildToParent, createLiveChildForParentOnTeam,
  moveLiveMemberToTeam, moveLiveChildToTeam, bulkAddLiveTeamMembers, createLiveChildForParentInClub, deleteMyLiveChild,
  setMyLiveChildGuardian } from './club';
import { claimLiveAdminJoinLink } from './miniLeagues';
const ctx = {} as FeatureBackendContext;
beforeEach(() => { clearRoleGrantsMemo(); vi.clearAllMocks(); });
describe('membership mutation discovery hooks', () => {
  it.each([
    ['team invite', 'accept_team_invite', () => acceptLiveTeamInvite(ctx, 'invite-1')],
    ['member removal', 'remove_member', () => removeLiveMember(ctx, 'club-1', {} as never)],
    ['club restore', 'restore_club', () => restoreLiveClub(ctx, 'club-1')],
    ['league admin claim', 'claim_admin_join_link', () => claimLiveAdminJoinLink(ctx, 'token-1')],
    ['alternate member restore', 'restore_member', () => restoreLiveMember(ctx, 'club-1', {} as never)],
    ['alternate member removal', 'remove_member', () => removeViaClub(ctx, 'club-1', {} as never)],
    ['child team assignment', 'set_own_child_team', () => setMyLiveChildTeam(ctx, 'child-1', 'team-1', true)],
    ['child team unassignment', 'set_own_child_team', () => setMyLiveChildTeam(ctx, 'child-1', 'team-1', false)],
    ['team removal', 'soft_delete_team', () => softDeleteLiveTeam(ctx, 'team-1')],
    ['team restore', 'restore_team', () => restoreLiveTeam(ctx, 'team-1')],
    ['permanent team deletion', 'delete_team_permanent', () => deleteLiveTeamPermanent(ctx, 'team-1')],
    ['guardian link', 'link_guardian', () => linkLiveGuardian(ctx, 'child-1', {} as never)],
    ['guardian unlink', 'unlink_guardian', () => unlinkLiveGuardian(ctx, 'child-1', {} as never)],
    ['admin guardian link', 'admin_link_child_to_parent', () => adminLinkLiveChildToParent(ctx, 'child-1', {} as never)],
    ['parent child creation on team', 'create_child_for_parent_on_team', () => createLiveChildForParentOnTeam(ctx, 'club-1', 'team-1', {} as never)],
    ['member move', 'move_member_to_team', () => moveLiveMemberToTeam(ctx, 'club-1', {} as never, 'old-team', 'team-1')],
    ['child move', 'move_child_to_team', () => moveLiveChildToTeam(ctx, 'child-1', 'old-team', 'team-1')],
    ['bulk team addition', 'bulk_add_team_members', () => bulkAddLiveTeamMembers(ctx, 'club-1', 'team-1', 'player', [])],
    ['parent child creation in club', 'create_child_for_parent_in_club', () => createLiveChildForParentInClub(ctx, 'club-1', {} as never)],
    ['child deletion', 'delete_own_child', () => deleteMyLiveChild(ctx, 'child-1')],
    ['own child guardian update', 'set_own_child_guardian', () => setMyLiveChildGuardian(ctx, 'child-1', {} as never, true)],
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