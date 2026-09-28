import { supabase } from "@/integrations/supabase/client";

export type TeamInviteRoute =
  | { kind: "navigate"; to: string }
  | { kind: "unavailable" };

/**
 * Resolve the destination for a `team_invite` bell notification.
 *
 * `related_id` can point at either `team_invites` (shareable team links) or
 * `pending_invites` (all parent / second-parent invites). Looking in only one
 * table used to drop the user on /notifications instead of the accept screen.
 *
 * Order:
 *  1. team_invites by id → /join/<invite_token>
 *  2. pending_invites by id → /join/p/<token> (team) or /join-club/<token> (club-only)
 *     Already accepted / revoked invites resolve to the joined team/club, or
 *     "unavailable" when there is nothing to open.
 *  3. Nothing found → "unavailable"
 */
export async function resolveTeamInviteRoute(relatedId: string | null | undefined): Promise<TeamInviteRoute> {
  if (!relatedId) return { kind: "unavailable" };

  const { data: teamInvite } = await supabase
    .from("team_invites")
    .select("token")
    .eq("id", relatedId)
    .maybeSingle();

  if (teamInvite?.token) {
    return { kind: "navigate", to: `/join/${teamInvite.token}` };
  }

  const { data: pending } = await supabase
    .from("pending_invites")
    .select("invite_token, team_id, club_id, status, metadata")
    .eq("id", relatedId)
    .maybeSingle();

  if (!pending) return { kind: "unavailable" };

  const meta = pending.metadata as { mini_league_id?: string } | null;
  const isPending = pending.status === "pending" || pending.status === null;

  if (isPending && pending.invite_token) {
    if (pending.team_id) {
      return { kind: "navigate", to: `/join/p/${pending.invite_token}` };
    }
    return { kind: "navigate", to: `/join-club/${pending.invite_token}` };
  }

  // Already accepted / revoked — send them to what they joined, if anything.
  if (meta?.mini_league_id) {
    return { kind: "navigate", to: `/mini-leagues/${meta.mini_league_id}` };
  }
  if (pending.team_id) {
    return { kind: "navigate", to: `/teams/${pending.team_id}` };
  }
  if (pending.club_id) {
    return { kind: "navigate", to: `/clubs/${pending.club_id}` };
  }
  return { kind: "unavailable" };
}
