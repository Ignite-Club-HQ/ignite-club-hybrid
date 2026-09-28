/**
 * Temporary allowlist for AI Chat Recap access while the feature is in
 * restricted beta. Only users listed here can use Chat Recap, regardless of
 * club-level settings.
 */
export const AI_CATCH_UP_ALLOWLISTED_USER_IDS: ReadonlySet<string> = new Set([
  // redacted@example.invalid
  "f51dd664-b0d5-4956-b2d5-cec9222ae3dc",
]);

export function isAICatchUpAllowlisted(userId: string | null | undefined): boolean {
  if (!userId) return false;
  return AI_CATCH_UP_ALLOWLISTED_USER_IDS.has(userId);
}
