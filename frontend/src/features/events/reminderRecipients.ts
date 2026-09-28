/**
 * Guardian resolution for individual RSVP reminders.
 *
 * Both guardian reads (`child_guardians` and `children.parent_id`) are
 * authoritative: if either fails we must fail closed — no notification rows,
 * no push, and a destructive error toast. "No linked parents" may only be
 * reported when both reads succeeded and genuinely returned nothing.
 */

export type SupabaseReadError = { message?: string | null } | null | undefined;

export type GuardianResolution =
  | { status: "ok"; recipientIds: string[] }
  | { status: "error"; message: string };

const GUARDIAN_LOOKUP_ERROR =
  "Couldn't check who to remind. Please check your connection and try again.";

/** Remove null/empty values and duplicates, preserving first-seen order. */
export function normalizeRecipientIds(ids: (string | null | undefined)[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of ids) {
    const id = typeof raw === "string" ? raw.trim() : "";
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
}

/**
 * Combine the supplied userId (when present) with the child's primary parent
 * and additional guardians. Errors from either read fail closed.
 */
export function resolveReminderRecipients(input: {
  userId?: string | null;
  guardians?: { guardian_id: string | null }[] | null;
  guardiansError?: SupabaseReadError;
  child?: { parent_id: string | null } | null;
  childError?: SupabaseReadError;
}): GuardianResolution {
  if (input.guardiansError || input.childError) {
    return { status: "error", message: GUARDIAN_LOOKUP_ERROR };
  }

  const recipientIds = normalizeRecipientIds([
    input.userId,
    input.child?.parent_id ?? null,
    ...(input.guardians || []).map((g) => g?.guardian_id ?? null),
  ]);

  return { status: "ok", recipientIds };
}

/**
 * Apply the 24h reminder cooldown. A failed cooldown read fails closed.
 */
export function applyReminderCooldown(input: {
  recipientIds: string[];
  recentlyRemindedRows?: { user_id: string | null }[] | null;
  cooldownError?: SupabaseReadError;
}): GuardianResolution {
  if (input.cooldownError) {
    return { status: "error", message: GUARDIAN_LOOKUP_ERROR };
  }
  const alreadyReminded = new Set(
    normalizeRecipientIds((input.recentlyRemindedRows || []).map((r) => r?.user_id ?? null)),
  );
  return {
    status: "ok",
    recipientIds: input.recipientIds.filter((id) => !alreadyReminded.has(id)),
  };
}

export const REMINDER_LOOKUP_ERROR_MESSAGE = GUARDIAN_LOOKUP_ERROR;
