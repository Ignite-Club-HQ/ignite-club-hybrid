/**
 * Shared session-validation helper for sensitive account actions
 * (recover-account, delete-account, export-user-data).
 *
 * Guarantees:
 *   - Calls `supabase.auth.getSession()` and inspects the returned error.
 *   - Requires a non-null session.
 *   - Requires a non-empty, non-whitespace access token string.
 *   - Rejects the literal strings "undefined" / "null" that would slip
 *     through if a caller ever stringified a missing value.
 *
 * On failure throws an Error whose `code` is `session_expired` and whose
 * message is safe to surface directly to the user.
 */
import { supabase } from "@/integrations/supabase/client";

export const SESSION_EXPIRED_MESSAGE =
  "Your session has expired. Please sign in again to continue.";

export class SessionExpiredError extends Error {
  code = "session_expired" as const;
  constructor(message: string = SESSION_EXPIRED_MESSAGE) {
    super(message);
    this.name = "SessionExpiredError";
  }
}

export async function requireAccessToken(): Promise<string> {
  const { data, error } = await supabase.auth.getSession();
  if (error) throw new SessionExpiredError();
  const session = data?.session ?? null;
  if (!session) throw new SessionExpiredError();
  const token = (session as any).access_token;
  if (typeof token !== "string") throw new SessionExpiredError();
  const trimmed = token.trim();
  if (trimmed === "" || trimmed === "undefined" || trimmed === "null") {
    throw new SessionExpiredError();
  }
  return token;
}
