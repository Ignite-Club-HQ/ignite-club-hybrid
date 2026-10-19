import { Principal } from '@icp-sdk/core/principal';

/** ICP delivery addresses are principals, never Supabase UUIDs or account assertions. */
export function notificationRecipients(ids: readonly string[]): string[] {
  const recipients = new Set<string>();
  for (const raw of ids) {
    const text = raw.trim().replace(/^principal:/, '');
    if (!text) continue;
    const principal = Principal.fromText(text);
    if (principal.isAnonymous()) throw new Error('Invalid notification recipient');
    recipients.add(principal.toText());
  }
  return [...recipients];
}