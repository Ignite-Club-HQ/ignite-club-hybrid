/**
 * Converts a raw Supabase/Postgrest read error into a user-friendly Error.
 *
 * Read-model queries must never fail open (returning `[]`, `0` or `false` on a
 * permission/network fault), but the raw Postgrest text ("permission denied for
 * relation user_roles") is meaningless to a club admin on a phone. This wraps
 * the failure in a plain-English message while preserving the original error as
 * `cause` (and `technicalMessage`) for logs and debugging.
 */
export class FriendlyQueryError extends Error {
  readonly technicalMessage: string;

  constructor(message: string, technicalMessage: string, cause?: unknown) {
    super(message);
    this.name = "FriendlyQueryError";
    this.technicalMessage = technicalMessage;
    if (cause !== undefined) {
      (this as { cause?: unknown }).cause = cause;
    }
  }
}

function rawMessage(error: unknown): string {
  return String(
    (error as { message?: string })?.message ||
      (error as { details?: string })?.details ||
      (error as { hint?: string })?.hint ||
      error ||
      "",
  );
}

/**
 * @param error   The raw error thrown by Supabase.
 * @param subject What the user was trying to see, lowercase noun phrase.
 *                e.g. "the member list", "this club's subscription".
 */
export function friendlyQueryError(error: unknown, subject: string): FriendlyQueryError {
  const raw = rawMessage(error);
  const code = (error as { code?: string })?.code ?? "";

  const isPermission =
    code === "42501" ||
    code === "PGRST301" ||
    /permission denied/i.test(raw) ||
    /row-level security/i.test(raw) ||
    /\bJWT\b/i.test(raw);

  const isOffline =
    /failed to fetch/i.test(raw) ||
    /network ?error/i.test(raw) ||
    /load failed/i.test(raw) ||
    /aborted/i.test(raw) ||
    /timeout/i.test(raw);

  let message: string;
  if (isOffline) {
    message = `We couldn't load ${subject} — you appear to be offline. Check your connection and try again.`;
  } else if (isPermission) {
    message = `We couldn't load ${subject} because you don't have access, or your session has expired. Try signing out and back in.`;
  } else {
    message = `We couldn't load ${subject} right now. Please try again in a moment.`;
  }

  return new FriendlyQueryError(message, raw, error);
}

/** Best-effort friendly text for any error object surfaced by a query. */
export function friendlyQueryErrorMessage(error: unknown, subject: string): string {
  if (error instanceof FriendlyQueryError) return error.message;
  return friendlyQueryError(error, subject).message;
}
