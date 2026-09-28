import { supabase } from "@/integrations/supabase/client";

/**
 * Single authoritative path for the "second parent / guardian" side of a team
 * invitation.
 *
 * Production incident: an admin added an existing parent + child, entered a
 * second parent, and the UI reported success — but no `pending_invites` row and
 * no email were ever created. The second-parent branch was duplicated across
 * four call sites (existing-user add, new-member invite, bulk existing-user,
 * bulk new-invitee), each behaving differently, and every `insert()` error was
 * swallowed. The bulk new-invitee path didn't even create a row: it wrote inert
 * `second_guardian_*` metadata onto the primary invite that nothing consumes.
 *
 * Rules enforced here:
 *  - A second-parent name without a valid email is a *validation error*, never a
 *    silent skip (callers must block submission using `secondParentValidationError`).
 *  - Every database write is awaited and its error inspected; failures throw
 *    `SecondParentError` so the caller can report partial success.
 *  - Emails are only sent by the caller when `status === "invited"`, i.e. the
 *    `pending_invites` row was actually created.
 *  - All children are linked, not just the first one.
 *  - Writes stay scoped to the selected club/team and always carry
 *    `invited_by_user_id` from the authenticated user (no service role, no RLS bypass).
 */

export interface SecondParentProfile {
  id: string;
  display_name: string | null;
  avatar_url?: string | null;
}

export interface SecondParentChildMeta {
  name: string;
  yearOfBirth?: number | null;
  existingChildId?: string | null;
}

export type SecondParentStatus = "added" | "invited" | "skipped";

export interface SecondParentResult {
  status: SecondParentStatus;
  /** Display name / email used for messaging. */
  label: string | null;
  inviteId?: string;
  inviteToken?: string;
  inviteLink?: string;
  email?: string;
}

export class SecondParentError extends Error {
  readonly label: string | null;
  readonly technicalMessage: string;

  constructor(message: string, label: string | null, cause?: unknown) {
    super(message);
    this.name = "SecondParentError";
    this.label = label;
    this.technicalMessage = String(
      (cause as { message?: string })?.message ?? cause ?? message,
    );
    if (cause !== undefined) (this as { cause?: unknown }).cause = cause;
  }
}

export const SECOND_PARENT_EMAIL_REQUIRED = "Enter a valid email for the second parent.";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidSecondParentEmail(email: string | null | undefined): boolean {
  const value = (email ?? "").trim();
  return value.length > 0 && value.length <= 254 && EMAIL_RE.test(value);
}

export function normalizeEmail(email: string | null | undefined): string {
  return (email ?? "").trim().toLowerCase();
}

/**
 * Returns an inline validation message when second-parent details are partially
 * entered, or `null` when the state is valid (either fully absent, an existing
 * profile, or a name + valid email).
 */
export function secondParentValidationError(input: {
  role: string;
  name?: string | null;
  email?: string | null;
  selectedProfile?: SecondParentProfile | null;
}): string | null {
  if (input.role !== "parent") return null;
  if (input.selectedProfile) return null;
  const name = (input.name ?? "").trim();
  if (!name) return null;
  return isValidSecondParentEmail(input.email) ? null : SECOND_PARENT_EMAIL_REQUIRED;
}

const isDuplicate = (error: { code?: string | null; message?: string | null } | null | undefined) => {
  const message = error?.message?.toLowerCase() || "";
  return (
    error?.code === "23505" ||
    message.includes("duplicate") ||
    message.includes("unique constraint")
  );
};

export interface EnsureSecondParentParams {
  role: string;
  selectedProfile?: SecondParentProfile | null;
  name?: string | null;
  email?: string | null;
  teamId: string;
  clubId: string;
  teamName?: string;
  /** Child ids already materialised in the database (existing-user flows). */
  childIds?: string[];
  /** Child metadata carried on the invite (new-invitee flows). */
  childrenMetadata?: SecondParentChildMeta[] | null;
  /**
   * True when the form has at least one child for a parent add. Guarantees the
   * invite row carries `metadata.children` so reminder emails and the
   * child-provisioning path on accept have something to work with.
   */
  expectChildren?: boolean;
  /** Authenticated user performing the add. */
  invitedByUserId: string;
  /** Primary invite token, so the household stays linked. */
  linkedInviteToken?: string | null;
  /** Origin used to build the shareable invite link. */
  origin?: string;
}

type ChildMetaRow = { name: string; yearOfBirth: number | null; existingChildId: string | null };

function buildChildrenMetadata(
  childrenMetadata: SecondParentChildMeta[],
  childIds: string[],
): ChildMetaRow[] {
  if (childrenMetadata.length > 0) {
    return childrenMetadata.map((c) => ({
      name: c.name.trim(),
      yearOfBirth: c.yearOfBirth ?? null,
      existingChildId: c.existingChildId ?? null,
    }));
  }
  return childIds.map((id) => ({ name: "", yearOfBirth: null, existingChildId: id }));
}

/** Best-effort email lookup for an existing profile (used to make the invite resendable). */
async function lookupProfileEmail(userId: string): Promise<string | null> {
  try {
    const { data } = await supabase.rpc("admin_get_user_emails" as never, {
      user_ids: [userId],
    } as never);
    const row = (data as { id: string; email: string }[] | null)?.find((r) => r.id === userId);
    return row?.email ? normalizeEmail(row.email) : null;
  } catch {
    return null;
  }
}

/**
 * Creates (or refreshes) the `pending_invites` row for a second parent so every
 * added parent is visible in PendingInvitesList and reachable by
 * resend / Resend All / send-invite-reminders. Throws on failure — a link is
 * never minted for a row that doesn't exist.
 */
async function upsertSecondParentInvite(args: {
  teamId: string;
  clubId: string;
  invitedByUserId: string;
  invitedUserId: string | null;
  invitedEmail: string | null;
  invitedLabel: string | null;
  label: string | null;
  metadata: Record<string, unknown>;
}): Promise<{ id: string; token: string }> {
  const { teamId, clubId, invitedUserId, invitedEmail } = args;

  let existingQuery = supabase
    .from("pending_invites")
    .select("id, invite_token")
    .eq("team_id", teamId)
    .eq("role", "parent" as never)
    .eq("status", "pending");
  existingQuery = invitedUserId
    ? existingQuery.eq("invited_user_id", invitedUserId)
    : existingQuery.eq("invited_email", invitedEmail ?? "");

  const { data: existing } = await existingQuery.limit(1).maybeSingle();

  if (existing?.id && existing.invite_token) {
    const { error: updateError } = await supabase
      .from("pending_invites")
      .update({
        invited_label: args.invitedLabel,
        invited_email: invitedEmail,
        metadata: args.metadata,
      } as never)
      .eq("id", existing.id);
    if (updateError) {
      throw new SecondParentError(
        `${args.label ?? "The second parent"}'s invitation could not be updated.`,
        args.label,
        updateError,
      );
    }
    return { id: existing.id, token: existing.invite_token };
  }

  const inviteToken = crypto.randomUUID();
  const { data: created, error: inviteError } = await supabase
    .from("pending_invites")
    .insert({
      team_id: teamId,
      club_id: clubId,
      role: "parent" as never,
      status: "pending",
      invited_user_id: invitedUserId,
      invited_by_user_id: args.invitedByUserId,
      invited_label: args.invitedLabel,
      invited_email: invitedEmail,
      invite_token: inviteToken,
      metadata: args.metadata,
    } as never)
    .select("id, invite_token")
    .single();

  if (inviteError || !created?.id || !created?.invite_token) {
    throw new SecondParentError(
      `${args.label ?? "The second parent"}'s invitation could not be created.`,
      args.label,
      inviteError ?? new Error("invite_row_not_readable"),
    );
  }

  return { id: created.id, token: created.invite_token };
}

export async function ensureSecondParent(
  params: EnsureSecondParentParams,
): Promise<SecondParentResult> {
  const {
    role,
    selectedProfile,
    teamId,
    clubId,
    teamName,
    invitedByUserId,
    linkedInviteToken,
  } = params;

  if (role !== "parent") return { status: "skipped", label: null };

  const name = (params.name ?? "").trim();
  const email = normalizeEmail(params.email);
  const childIds = (params.childIds ?? []).filter(Boolean);
  const childrenMetadata = (params.childrenMetadata ?? []).filter((c) => !!c?.name);
  const origin = params.origin ?? (typeof window !== "undefined" ? window.location.origin : "");

  // --- Existing profile: grant access now, but still create a real invite ----
  if (selectedProfile) {
    const label = selectedProfile.display_name || "Second parent";

    const { error: roleErr } = await supabase.from("user_roles").insert({
      user_id: selectedProfile.id,
      team_id: teamId,
      club_id: clubId,
      role: "parent" as never,
    });
    if (roleErr && !isDuplicate(roleErr)) {
      throw new SecondParentError(
        `We couldn't add ${label} as a second parent.`,
        label,
        roleErr,
      );
    }

    for (const childId of childIds) {
      const { error: guardianErr } = await supabase.from("child_guardians").insert({
        child_id: childId,
        guardian_id: selectedProfile.id,
      });
      if (guardianErr && !isDuplicate(guardianErr)) {
        throw new SecondParentError(
          `We couldn't link ${label} to the child record.`,
          label,
          guardianErr,
        );
      }
    }

    const metadataChildren = buildChildrenMetadata(childrenMetadata, childIds);
    if (params.expectChildren && metadataChildren.length === 0) {
      throw new SecondParentError(
        `We couldn't attach the children to ${label}'s invitation. Please retry.`,
        label,
        new Error("missing_children_metadata"),
      );
    }

    const inviteEmail =
      (params.email ? email : null) || (await lookupProfileEmail(selectedProfile.id));

    const invite = await upsertSecondParentInvite({
      teamId,
      clubId,
      invitedByUserId,
      invitedUserId: selectedProfile.id,
      invitedEmail: inviteEmail,
      invitedLabel: selectedProfile.display_name ?? null,
      label,
      metadata: {
        ...(metadataChildren.length > 0 ? { children: metadataChildren } : {}),
        ...(childIds.length > 0
          ? { guardian_child_ids: childIds, guardian_child_id: childIds[0] }
          : {}),
        guardian_all_team_ids: [teamId],
        invited_by_parent: true,
        second_parent: true,
        second_parent_of_existing_user: true,
        ...(linkedInviteToken ? { linked_invite_token: linkedInviteToken } : {}),
      },
    });

    // Notification is best-effort — the membership is already committed.
    await supabase
      .from("notifications")
      .insert({
        user_id: selectedProfile.id,
        type: "membership",
        message: `You have been added to ${teamName ?? "the team"} as Parent`,
        related_id: teamId,
      })
      .then(({ error }) => {
        if (error) console.error("[secondParent] notification failed", error.message);
      });

    return {
      status: "added",
      label,
      inviteId: invite.id,
      inviteToken: invite.token,
      inviteLink: `${origin}/join/p/${invite.token}`,
      email: inviteEmail ?? undefined,
    };
  }

  // --- Nothing entered -------------------------------------------------------
  if (!name && !email) return { status: "skipped", label: null };

  // --- Partially entered: never silently discarded ---------------------------
  if (!isValidSecondParentEmail(email)) {
    throw new SecondParentError(SECOND_PARENT_EMAIL_REQUIRED, name || null);
  }

  const label = name || email;

  const metadataChildren = buildChildrenMetadata(childrenMetadata, childIds);
  if (params.expectChildren && metadataChildren.length === 0) {
    throw new SecondParentError(
      `We couldn't attach the children to ${label}'s invitation. Please retry.`,
      label,
      new Error("missing_children_metadata"),
    );
  }

  const invite = await upsertSecondParentInvite({
    teamId,
    clubId,
    invitedByUserId,
    invitedUserId: null,
    invitedEmail: email,
    invitedLabel: name || null,
    label,
    metadata: {
      ...(metadataChildren.length > 0 ? { children: metadataChildren } : {}),
      ...(childIds.length > 0 ? { guardian_child_ids: childIds, guardian_child_id: childIds[0] } : {}),
      guardian_all_team_ids: [teamId],
      invited_by_parent: true,
      second_parent: true,
      ...(linkedInviteToken ? { linked_invite_token: linkedInviteToken } : {}),
    },
  });

  return {
    status: "invited",
    label,
    inviteId: invite.id,
    inviteToken: invite.token,
    inviteLink: `${origin}/join/p/${invite.token}`,
    email,
  };
}


/** Partial-success copy shown when the primary add worked but the second parent didn't. */
export function secondParentPartialFailureMessage(
  primarySummary: string,
  secondParentLabel: string | null,
): string {
  const who = secondParentLabel || "the second parent";
  return `${primarySummary}, but ${who}'s invitation could not be created. Please retry the second-parent invitation.`;
}
