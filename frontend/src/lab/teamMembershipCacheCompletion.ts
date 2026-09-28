import type { QueryClient } from "@tanstack/react-query";
import { membershipKeys } from "./membershipQueryKeys";

/** Reconcile the exact roster after one member's team role changes. */
export function refreshTeamRoleChange(queryClient: QueryClient, teamId: string): void {
  queryClient.invalidateQueries({ queryKey: membershipKeys.teamRoles(teamId) });
}

/** Reconcile roster, chat authorization and scopes after a full member removal. */
export function refreshRemovedTeamMember(queryClient: QueryClient, teamId: string): void {
  refreshTeamRoleChange(queryClient, teamId);
  queryClient.invalidateQueries({ queryKey: membershipKeys.teamChatMembers(teamId) });
  queryClient.invalidateQueries({ queryKey: membershipKeys.authorizedScopes() });
}

/** Reconcile the exact child roster after a child assignment is removed. */
export function refreshRemovedTeamChild(queryClient: QueryClient, teamId: string): void {
  queryClient.invalidateQueries({ queryKey: membershipKeys.teamChildren(teamId) });
}

/** Preserve the current chat-admin role/member removal cache effects. */
export function refreshChatManagedTeamMembership(
  queryClient: QueryClient,
  teamId: string,
  chatType: string,
  chatId: string,
): void {
  refreshTeamRoleChange(queryClient, teamId);
  queryClient.invalidateQueries({ queryKey: ["chat-members", chatType, chatId] });
}

/** Reconcile all affected access surfaces after atomic full-member removal. */
export function refreshChatRemovedTeamMember(
  queryClient: QueryClient,
  teamId: string,
  chatType: string,
  chatId: string,
): void {
  refreshChatManagedTeamMembership(queryClient, teamId, chatType, chatId);
  queryClient.invalidateQueries({ queryKey: membershipKeys.authorizedScopes() });
}

/** Preserve all existing cross-surface refreshes after the current user leaves. */
export function refreshAfterLeavingTeam(queryClient: QueryClient, teamId: string): void {
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
