import { DEFAULT_CLUB_CHAT_NAMES } from "./defaultChatNames";

/**
 * Concurrent default-chat setup (two devices/screens at once) could create a
 * second "Coaches"/"Team Admins"/"Club Committee" chat in the same club.
 * Hide only copies that have never had a message when another same-club
 * chat of that default name exists. Nothing is deleted, and any chat with
 * messages — or a custom chat with the same name — always stays visible.
 */
export function hideEmptyDefaultCopies<T extends { id: string; name: string; club_id: string | null }>(
  groups: readonly T[],
  hasMessages: (id: string) => boolean,
): T[] {
  const norm = (n: string) => n.trim().toLowerCase();
  const buckets = new Map<string, T[]>();
  for (const g of groups) {
    if (!g.club_id || !DEFAULT_CLUB_CHAT_NAMES.has(norm(g.name))) continue;
    const k = `${g.club_id}\u0000${norm(g.name)}`;
    buckets.set(k, [...(buckets.get(k) ?? []), g]);
  }
  const hidden = new Set<string>();
  for (const list of buckets.values()) {
    if (list.length < 2) continue;
    const keep = list.find((g) => hasMessages(g.id)) ?? list[0];
    for (const g of list) if (g !== keep && !hasMessages(g.id)) hidden.add(g.id);
  }
  return groups.filter((g) => !hidden.has(g.id));
}
