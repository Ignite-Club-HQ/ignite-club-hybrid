import { membershipKeys } from "./membershipQueryKeys";

export function refreshTeamRoleChange(queryClient: any, teamId: string): void {
  queryClient.invalidateQueries({ queryKey: membershipKeys.teamRoles(teamId) });
}

export function refreshRemovedTeamMember(queryClient: any, teamId: string): void {
  refreshTeamRoleChange(queryClient, teamId);
  queryClient.invalidateQueries({ queryKey: membershipKeys.teamChatMembers(teamId) });
  queryClient.invalidateQueries({ queryKey: membershipKeys.authorizedScopes() });
}

export function refreshRemovedTeamChild(queryClient: any, teamId: string): void {
  queryClient.invalidateQueries({ queryKey: membershipKeys.teamChildren(teamId) });
}

/** Preserve the current chat-admin role/member removal cache effects. */
export function refreshChatManagedTeamMembership(
  queryClient: any,
  teamId: string,
  chatType: string,
  chatId: string,
): void {
  refreshTeamRoleChange(queryClient, teamId);
  queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
}

/** Reconcile all affected access surfaces after atomic full-member removal. */
export function refreshChatRemovedTeamMember(
  queryClient: any,
  teamId: string,
  chatType: string,
  chatId: string,
): void {
  refreshChatManagedTeamMembership(queryClient, teamId, chatType, chatId);
  queryClient.invalidateQueries({ queryKey: membershipKeys.authorizedScopes() });
}

/** Preserve all existing cross-surface refreshes after the current user leaves. */
export function refreshAfterLeavingTeam(queryClient: any, teamId: string): void {
  refreshTeamRoleChange(queryClient, teamId);
  for (const queryKey of [
    membershipKeys.userRoles(),
    ["user-memberships-for-events"] as const,
    ["user-memberships-and-events"] as const,
    ["user-clubs-for-filter"] as const,
    ["user-teams-for-filter"] as const,
    ["events"] as const,
    ["user-rsvps-home"] as const,
  ]) {
    queryClient.invalidateQueries({ queryKey });
  }
}
