import { supabase } from "@/integrations/supabase/client";

/**
 * Transactional acceptance of a parent invitation that carries child metadata.
 *
 * The old client-side flow created the parent role, then created children /
 * guardian links / team assignments in separate requests, logging failures and
 * continuing. That produced partial memberships: the invite was consumed, the
 * parent had a role, but the child was missing or unassigned — so the parent
 * could never RSVP.
 *
 * Everything now runs inside one SECURITY DEFINER RPC so child creation,
 * guardian linking, team assignment, the parent role and the invitation
 * acceptance either all succeed or all roll back (leaving the invite pending
 * for a retry).
 */

export interface AcceptParentInviteResult {
  childIds: string[];
  alreadyAccepted: boolean;
  teamId: string | null;
  clubId: string | null;
}

/** Errors the RPC raises when the invite simply isn't a child-carrying parent invite. */
const NOT_APPLICABLE = new Set([
  "not_a_child_parent_invite",
  "invalid_role_for_parent_accept",
  "reusable_join_link_not_supported",
]);

export const isNotChildParentInviteError = (error: unknown): boolean => {
  const message = (error as { message?: string } | null)?.message ?? "";
  return [...NOT_APPLICABLE].some((code) => message.includes(code));
};

/** Maps raw Postgres error codes to a message a parent can act on. */
export function getParentInviteErrorMessage(error: unknown): string {
  const raw = (error as { message?: string } | null)?.message ?? "";

  if (raw.includes("invite_not_for_this_user")) {
    return "This invitation was sent to a different email address. Please sign in with the invited email, or ask your admin to resend the invite.";
  }
  if (raw.includes("invite_not_pending")) {
    return "This invitation has already been used.";
  }
  if (raw.includes("invite_not_found")) {
    return "We couldn't find that invitation. Please ask your admin for a new link.";
  }
  if (raw.includes("referenced_child_out_of_scope") || raw.includes("referenced_child_not_found")) {
    return "The child on this invitation no longer matches this team. Please ask your admin to resend the invite.";
  }
  if (raw.includes("invalid_child_name") || raw.includes("invalid_child_year_of_birth")) {
    return "This invitation has incomplete child details. Please ask your admin to resend the invite.";
  }
  if (raw.includes("child_team_assignment_failed") || raw.includes("child_create_failed")) {
    return "We couldn't add your child to the team. Nothing was saved — please try again.";
  }
  if (raw.includes("not_authenticated")) {
    return "Please sign in again and reopen your invitation link.";
  }

  return "We couldn't finish accepting your invitation. Nothing was saved — please try again.";
}

export async function acceptParentTeamInvite(params: {
  inviteId?: string | null;
  inviteToken?: string | null;
}): Promise<AcceptParentInviteResult> {
  const { data, error } = await supabase.rpc("accept_parent_team_invite" as any, {
    _invite_id: params.inviteId ?? null,
    _invite_token: params.inviteToken ?? null,
  });

  if (error) {
    // Diagnostic context only — no names, emails or child details.
    console.error("[acceptParentTeamInvite] failed", {
      code: (error as any)?.code,
      message: error.message,
      hasInviteId: !!params.inviteId,
      hasInviteToken: !!params.inviteToken,
    });
    throw error;
  }

  const payload = (data ?? {}) as {
    child_ids?: string[];
    already_accepted?: boolean;
    team_id?: string | null;
    club_id?: string | null;
  };

  return {
    childIds: Array.isArray(payload.child_ids) ? payload.child_ids : [],
    alreadyAccepted: !!payload.already_accepted,
    teamId: payload.team_id ?? null,
    clubId: payload.club_id ?? null,
  };
}

/**
 * Idempotent safety net for invites the backend triggers already flipped to
 * `accepted`. In that race the frontend accept flow never runs, so the invited
 * children were never created. This RPC materialises them (children, guardian
 * links, team assignments) and is safe to call repeatedly.
 */
export async function provisionInviteChildren(params: {
  inviteId: string;
  guardianId: string;
}): Promise<string[]> {
  // The RPC verifies auth.uid(), guardianId and invite ownership before writing.
  const { data, error } = await supabase.rpc("provision_invite_children" as any, {
    _invite_id: params.inviteId,
    _guardian_id: params.guardianId,
  });


  if (error) {
    console.error("[provisionInviteChildren] failed", {
      code: (error as any)?.code,
      message: error.message,
    });
    throw error;
  }

  const payload = (data ?? {}) as { child_ids?: string[] };
  return Array.isArray(payload.child_ids) ? payload.child_ids : [];
}
