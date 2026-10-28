/**
 * Remembers which conversations the signed-in user just sent a message to,
 * so the Messages inbox can float those rows to the top of their current
 * section (Unread or Recent) instead of waiting for the next fresh ordering.
 *
 * In-memory only, bounded, and short-lived: once the inbox refetch lands,
 * the natural lastActivity ordering takes over and the bump is a no-op.
 */

const MAX_BUMPS = 20;
const BUMP_TTL_MS = 10 * 60 * 1000;

type BumpEntry = { key: string; at: number };

let bumps: BumpEntry[] = [];
const listeners = new Set<() => void>();

function prune(now: number): void {
  bumps = bumps.filter((entry) => now - entry.at < BUMP_TTL_MS);
}

function notify(): void {
  for (const listener of listeners) listener();
}

/** Record a successful own send. Newest bump wins (moved to the front). */
export function recordOwnSentConversation(key: string, now: number = Date.now()): void {
  if (!key) return;
  prune(now);
  bumps = [{ key, at: now }, ...bumps.filter((entry) => entry.key !== key)].slice(0, MAX_BUMPS);
  notify();
}

/** Unexpired bumped conversation keys, most recently sent first. */
export function peekOwnSentConversationKeys(now: number = Date.now()): readonly string[] {
  prune(now);
  return bumps.map((entry) => entry.key);
}

/** Subscribe to new own-send bumps. Returns an unsubscribe function. */
export function subscribeOwnSentConversations(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Test-only: clear all recorded bumps and listeners. */
export function resetOwnSentConversationBumpsForTests(): void {
  bumps = [];
  listeners.clear();
}
