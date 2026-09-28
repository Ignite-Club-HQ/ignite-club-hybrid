import { QueryClient } from '@tanstack/react-query';
import { expect, test, vi } from 'vitest';
import { membershipKeys } from '../src/lab/membershipQueryKeys';
import {
  refreshAfterLeavingTeam,
  refreshChatManagedTeamMembership,
  refreshChatRemovedTeamMember,
  refreshRemovedTeamChild,
  refreshRemovedTeamMember,
  refreshTeamRoleChange,
} from '../src/lab/teamMembershipCacheCompletion';

// Both modules are pure/provider-neutral: membershipKeys only computes cache
// keys and the refresh helpers only invalidate an in-memory React Query
// cache. Neither talks to Supabase or ICP, so these tests exercise the
// contract directly rather than through backend routing.

test('membershipKeys preserves invite token identities', () => {
  expect(membershipKeys.pendingInviteToken('token-1')).toEqual(['pending-invite-token', 'token-1']);
  expect(membershipKeys.teamInvite('token-1')).toEqual(['team-invite', 'token-1']);
});

test('membershipKeys preserves user and destination invite identities', () => {
  expect(membershipKeys.pendingInvitesForUser('user-1')).toEqual(['pending-invites-for-user', 'user-1']);
  expect(membershipKeys.inviteRoles('team-1', 'club-1', 'user-1')).toEqual([
    'user-invite-roles', 'team-1', 'club-1', 'user-1',
  ]);
  expect(membershipKeys.joinProfile('user-1')).toEqual(['user-profile-for-join', 'user-1']);
  expect(membershipKeys.teamChildrenForLinking('team-1')).toEqual(['team-children-for-linking', 'team-1']);
  expect(membershipKeys.userRolesFor('user-1')).toEqual(['user-roles', 'user-1']);
});

test('membershipKeys retains intentional prefixes for post-accept refresh', () => {
  expect(membershipKeys.userRoles()).toEqual(['user-roles']);
  expect(membershipKeys.pendingInvites()).toEqual(['pending-invites-for-user']);
});

test('membershipKeys preserves exact team administration identities', () => {
  expect(membershipKeys.teamRoles('team-1')).toEqual(['team-roles', 'team-1']);
  expect(membershipKeys.teamRoles()).toEqual(['team-roles']);
  expect(membershipKeys.teamChildren('team-1')).toEqual(['team-children', 'team-1']);
  expect(membershipKeys.teamChildren()).toEqual(['team-children']);
  expect(membershipKeys.teamChatMembers('team-1')).toEqual(['chat-members', 'team', 'team-1']);
  expect(membershipKeys.authorizedScopes()).toEqual(['authorized-scopes']);
  expect(membershipKeys.authorizedScopesFor('user-1')).toEqual(['authorized-scopes', 'user-1']);
});

function spiedClient() {
  const queryClient = new QueryClient();
  const invalidate = vi.spyOn(queryClient, 'invalidateQueries').mockResolvedValue(undefined);
  return { queryClient, invalidate };
}

test('refreshes only the exact roster after one role changes', () => {
  const { queryClient, invalidate } = spiedClient();
  refreshTeamRoleChange(queryClient, 'team-1');
  expect(invalidate.mock.calls).toEqual([[{ queryKey: ['team-roles', 'team-1'] }]]);
});

test('refreshes roster, chat authorization and scopes after full member removal', () => {
  const { queryClient, invalidate } = spiedClient();
  refreshRemovedTeamMember(queryClient, 'team-1');
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: ['team-roles', 'team-1'] }],
    [{ queryKey: ['chat-members', 'team', 'team-1'] }],
    [{ queryKey: ['authorized-scopes'] }],
  ]);
});

test('refreshes only the exact child roster after child assignment removal', () => {
  const { queryClient, invalidate } = spiedClient();
  refreshRemovedTeamChild(queryClient, 'team-1');
  expect(invalidate).toHaveBeenCalledWith({ queryKey: ['team-children', 'team-1'] });
});

test('preserves chat-context refresh after a chat-managed team role change', () => {
  const { queryClient, invalidate } = spiedClient();
  refreshChatManagedTeamMembership(queryClient, 'team-1', 'group', 'chat-1');
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: ['team-roles', 'team-1'] }],
    [{ queryKey: ['chat-members', 'group', 'chat-1'] }],
  ]);
});

test('also refreshes authorization after atomic chat member removal', () => {
  const { queryClient, invalidate } = spiedClient();
  refreshChatRemovedTeamMember(queryClient, 'team-1', 'team', 'team-1');
  expect(invalidate.mock.calls).toEqual([
    [{ queryKey: ['team-roles', 'team-1'] }],
    [{ queryKey: ['chat-members', 'team', 'team-1'] }],
    [{ queryKey: ['authorized-scopes'] }],
  ]);
});

test('preserves every existing membership/event surface after self-leave', () => {
  const { queryClient, invalidate } = spiedClient();
  refreshAfterLeavingTeam(queryClient, 'team-1');
  expect(invalidate.mock.calls.map(([arg]) => arg.queryKey)).toEqual([
    ['team-roles', 'team-1'],
    ['user-roles'],
    ['user-memberships-for-events'],
    ['user-memberships-and-events'],
    ['user-clubs-for-filter'],
    ['user-teams-for-filter'],
    ['events'],
    ['user-rsvps-home'],
  ]);
});
