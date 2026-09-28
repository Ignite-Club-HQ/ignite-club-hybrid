/** Canonical identities for invite reads and membership completion refreshes. */
export const membershipKeys = {
  pendingInviteToken: (token: string) => ["pending-invite-token", token] as const,
  teamInvite: (token: string) => ["team-invite", token] as const,
  pendingInvites: () => ["pending-invites-for-user"] as const,
  pendingInvitesForUser: (userId: string) => ["pending-invites-for-user", userId] as const,
  inviteRoles: (
    teamId: string | null | undefined,
    clubId: string | null | undefined,
    userId: string,
  ) => ["user-invite-roles", teamId, clubId, userId] as const,
  joinProfile: (userId: string) => ["user-profile-for-join", userId] as const,
  teamChildrenForLinking: (teamId: string) => ["team-children-for-linking", teamId] as const,
  userRoles: () => ["user-roles"] as const,
  teamRoles: (teamId?: string) =>
    teamId ? (["team-roles", teamId] as const) : (["team-roles"] as const),
  teamChildren: (teamId?: string) =>
    teamId ? (["team-children", teamId] as const) : (["team-children"] as const),
  teamChatMembers: (teamId: string) => ["chat-members", "team", teamId] as const,
  authorizedScopes: () => ["authorized-scopes"] as const,
};
