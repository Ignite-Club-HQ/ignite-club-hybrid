/**
 * Detects membership/role-change system messages by their text content.
 *
 * The DB trigger that posts these messages sets `is_system_message = true`,
 * but legacy rows (and any future code paths that bypass the trigger) may
 * insert the same text without the flag. This helper guarantees the chat
 * renders them as a centered grey pill regardless.
 *
 * Patterns mirror `post_membership_system_message` in the SQL migration:
 *   - "<Name> joined as <Role>"
 *   - "<Name> is no longer a <Role>"
 *   - "<Name> is now a <Role>"
 *   - "<Name> left the team"
 */
const SYSTEM_MESSAGE_PATTERNS: RegExp[] = [
  / joined as /,
  / is no longer (?:a |an )/,
  / is now (?:a |an )/,
  / left the team$/,
];

export function isMembershipSystemText(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length > 200) return false; // bail early on long bodies
  return SYSTEM_MESSAGE_PATTERNS.some((re) => re.test(trimmed));
}

export function isSystemMessageLike(
  text: string | null | undefined,
  flag: boolean | null | undefined,
): boolean {
  return Boolean(flag) || isMembershipSystemText(text);
}