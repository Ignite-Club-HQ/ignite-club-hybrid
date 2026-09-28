/** Canonical identities for invite reads and membership completion refreshes. */
export const membershipKeys = {
  pendingInviteToken: (token: string | undefined) => ["pending-invite-token", token] as const,
  teamInvite: (token: string | undefined) => ["team-invite", token] as const,
  pendingInvites: () => ["pending-invites-for-user"] as const,
  pendingInvitesForUser: (userId: string | undefined) => ["pending-invites-for-user", userId] as const,
  inviteRoles: (
    teamId: string | null | undefined,
    clubId: string | null | undefined,
    userId: string | undefined,
  ) => ["user-invite-roles", teamId, clubId, userId] as const,
  joinProfile: (userId: string | undefined) => ["user-profile-for-join", userId] as const,
  teamChildrenForLinking: (teamId: string | undefined | null) =>
    ["team-children-for-linking", teamId] as const,
  userRoles: () => ["user-roles"] as const,
  userRolesFor: (userId: string | undefined) => ["user-roles", userId] as const,
  teamRoles: (teamId?: string) =>
    teamId ? (["team-roles", teamId] as const) : (["team-roles"] as const),
  teamChildren: (teamId?: string) =>
    teamId ? (["team-children", teamId] as const) : (["team-children"] as const),
  teamChatMembers: (teamId: string) => ["chat-members", "team", teamId] as const,
  authorizedScopes: () => ["authorized-scopes"] as const,
  authorizedScopesFor: (userId: string | null | undefined) => ["authorized-scopes", userId] as const,
};
