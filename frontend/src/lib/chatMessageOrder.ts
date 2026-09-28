/**
 * Deterministic chronological ordering shared by every chat route (Team,
 * Club, Group, Direct Message, Club Admin, Broadcast).
 *
 * Every route sorts its message list the same way after an initial fetch,
 * an older-history page merge, or a realtime insert: ascending by
 * `created_at`, with the message `id` as a stable tie-breaker when two rows
 * share a timestamp (common for rapid successive sends or batch fixtures).
 * This is the one piece of the chat pipeline proven identical across all
 * six routes — the surrounding fetch, cache key, table, and realtime wiring
 * remain route-local because their contracts differ (see
 * docs/FRONTEND_VENDOR_HANDOVER_AUDIT.md).
 */

export interface ChronologicallyOrderable {
  id: string;
  created_at: string;
}

/**
 * Comparator for `Array.prototype.sort`. Ascending by `created_at`, then by
 * `id` (lexicographic) when timestamps are equal. Never mutates its inputs.
 *
 * `T` defaults to `any` and is not constrained with `extends
 * ChronologicallyOrderable` on the public signature. Every chat route call
 * site passes messages typed by an un-generic-parameterized Supabase query
 * result (effectively `any`), and TypeScript falls back an `any`-typed
 * argument to a generic parameter's *constraint* when one is declared —
 * which would silently narrow every returned message down to just `id` and
 * `created_at`, manufacturing new "Property does not exist" diagnostics at
 * every later field access. The internal cast keeps the comparison itself
 * type-checked while leaving the public type exactly as permissive as the
 * inline comparator it replaces.
 */
export function compareChatMessagesChronologically<T = any>(a: T, b: T): number {
  const left = a as unknown as ChronologicallyOrderable;
  const right = b as unknown as ChronologicallyOrderable;
  const timeDelta = new Date(left.created_at).getTime() - new Date(right.created_at).getTime();
  if (timeDelta !== 0) return timeDelta;
  return left.id.localeCompare(right.id);
}

/**
 * Returns a new array sorted chronologically. Does not mutate `messages`.
 */
export function sortChatMessagesChronologically<T = any>(
  messages: readonly T[],
): T[] {
  return [...messages].sort(compareChatMessagesChronologically);
}
