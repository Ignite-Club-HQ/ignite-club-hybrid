export function selectNewInviteRoles<T extends string>(
  selectedRoles: readonly T[],
  existingRoles: readonly T[],
): T[] {
  return selectedRoles.filter((role) => !existingRoles.includes(role));
}

export function validateReusableTeamInvite(input: {
  expiresAt?: string | null;
  maxUses?: number | null;
  usesCount: number;
  now?: Date;
}): void {
  if (input.expiresAt && new Date(input.expiresAt) < (input.now ?? new Date())) {
    throw new Error("This invite link has expired");
  }
  if (input.maxUses && input.usesCount >= input.maxUses) {
    throw new Error("This invite link has reached its usage limit");
  }
}

export type JoinCompletionStep = "joined" | "add-child";

export type InviteAuthMode = "signin" | "signup";

export function resolveLoggedOutInviteAuthMode(input: {
  isPendingInvite: boolean;
  invitedUserId?: string | null;
}): InviteAuthMode {
  return input.isPendingInvite && Boolean(input.invitedUserId) ? "signin" : "signup";
}

/**
 * Preserve the existing direct-join UI decision after a committed role grant.
 * The photo-consent continuation historically only opens the child step for a
 * regular team invite; callers make that distinction explicit.
 */
export function resolveInviteJoinCompletion(input: {
  isPendingInvite: boolean;
  addedRoles: readonly string[];
  regularInviteHasMetadata: boolean;
  pendingInviteKind?: string | null;
  completedAfterPhotoConsent?: boolean;
}): JoinCompletionStep {
  const addedParent = input.addedRoles.includes("parent");
  if (!addedParent) return "joined";
  if (!input.isPendingInvite && !input.regularInviteHasMetadata) return "add-child";
  if (
    !input.completedAfterPhotoConsent &&
    input.isPendingInvite &&
    input.pendingInviteKind === "mini_league_parent_join_link"
  ) {
    return "add-child";
  }
  return "joined";
}
