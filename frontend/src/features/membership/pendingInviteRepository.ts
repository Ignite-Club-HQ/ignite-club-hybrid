export async function fetchPendingInvitesForUser(client: any, userId: string) {
  const { data, error } = await client
    .from("pending_invites")
    .select(`
      id,
      role,
      invite_token,
      team_id,
      club_id,
      invited_label,
      metadata,
      teams:team_id (
        name,
        club_id,
        clubs:club_id (
          name
        )
      ),
      clubs:club_id (
        name
      )
    `)
    .eq("invited_user_id", userId)
    .eq("status", "pending")
    .limit(10);

  if (error) return [];
  return data ?? [];
}

export function refreshAcceptedInviteMembership(queryClient: any): void {
  queryClient.invalidateQueries({ queryKey: membershipKeys.userRoles() });
  queryClient.invalidateQueries({ queryKey: membershipKeys.pendingInvites() });
}
import { membershipKeys } from "./membershipQueryKeys";
