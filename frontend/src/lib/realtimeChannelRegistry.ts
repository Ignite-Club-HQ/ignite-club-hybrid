/**
 * Realtime channel registry.
 *
 * Central bookkeeping for Supabase Realtime subscriptions so that membership
 * revocation (kick, leave, role change, club delete, sign-out) can:
 *   1. tear down the underlying channel immediately, and
 *   2. evict any React Query cache entries that were populated from it.
 *
 * This is deliberately small — it is not a subscription framework. Callers
 * still create the channel with `supabase.channel(...)` and call `.subscribe()`
 * themselves; they register the resulting channel here so it can be revoked
 * from a single place.
 *
 * Contract:
 *   - `register` returns an `unregister` function. Callers MUST call it on
 *     component unmount (this also removes the channel from Supabase).
 *   - `revokeScope` and `revokeAllForUser` are idempotent.
 *   - The registry never touches auth state; callers wire it to membership
 *     changes via `useAuthorizedScopes` (subsequent pass).
 */

import type { RealtimeChannel } from "@supabase/supabase-js";
import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Re-exported so callers (e.g. the shared chat channel lifecycle) can type
// against this module instead of adding another direct import of the
// `@supabase/supabase-js` type declarations, which are intentionally absent
// from this lab's dependencies.
export type { RealtimeChannel };

/**
 * `club_admin` covers member↔club-admin conversations. Its scope id is the
 * CLUB id (not the conversation id) so that losing club membership revokes
 * every club-admin thread channel for that club. Modelling these as `dm`
 * was wrong: their ids never appear in `dmConversationIds`, so revocation
 * could never match them.
 */
export type ScopeKind = "team" | "club" | "group" | "dm" | "club_admin" | "user" | "global";


export interface Scope {
  kind: ScopeKind;
  /** For `global`, id is empty string. */
  id: string;
}

export interface RegisterOptions {
  /** Stable, unique key. Registering the same key twice replaces the prior entry. */
  key: string;
  channel: RealtimeChannel;
  userId: string;
  scope: Scope;
  /** React Query keys to remove when this channel is revoked. */
  cacheKeys?: QueryKey[];
}

interface Entry {
  key: string;
  channel: RealtimeChannel;
  userId: string;
  scope: Scope;
  cacheKeys: QueryKey[];
}

const entries = new Map<string, Entry>();
let queryClient: QueryClient | null = null;

/**
 * Wire the registry to the app's QueryClient so `cacheKeys` can be evicted on
 * revoke. Called once at app startup.
 */
export function bindRealtimeRegistryQueryClient(client: QueryClient): void {
  queryClient = client;
}

function scopeMatches(entry: Entry, userId: string, scope: Scope): boolean {
  if (entry.userId !== userId) return false;
  if (entry.scope.kind !== scope.kind) return false;
  // A scope with id "" matches any id of that kind (used for "revoke all teams").
  if (scope.id === "") return true;
  return entry.scope.id === scope.id;
}

function evictCacheKeys(keys: QueryKey[]): void {
  if (!queryClient || keys.length === 0) return;
  for (const key of keys) {
    try {
      queryClient.removeQueries({ queryKey: key });
    } catch {
      // best-effort — never let cache eviction throw into caller
    }
  }
}

async function teardown(entry: Entry): Promise<void> {
  try {
    await supabase.removeChannel(entry.channel);
  } catch {
    // channel may already be closed; ignore
  }
  evictCacheKeys(entry.cacheKeys);
}

/**
 * Register a channel. Returns an `unregister` fn that removes it from the
 * registry AND from Supabase. Safe to call multiple times.
 */
export function registerChannel(opts: RegisterOptions): () => void {
  const prev = entries.get(opts.key);
  if (prev && prev.channel !== opts.channel) {
    // Replace: tear down old channel silently.
    void teardown(prev);
  }
  const entry: Entry = {
    key: opts.key,
    channel: opts.channel,
    userId: opts.userId,
    scope: opts.scope,
    cacheKeys: opts.cacheKeys ?? [],
  };
  entries.set(opts.key, entry);

  return () => {
    const current = entries.get(opts.key);
    if (!current || current.channel !== opts.channel) return;
    entries.delete(opts.key);
    void teardown(current);
  };
}

/**
 * Tear down every channel matching (userId, scope). Pass `scope.id = ""` to
 * revoke every channel of that kind for the user (e.g. all `team` channels
 * when their team list becomes empty).
 */
export function revokeScope(userId: string, scope: Scope): void {
  const toRemove: Entry[] = [];
  for (const entry of entries.values()) {
    if (scopeMatches(entry, userId, scope)) toRemove.push(entry);
  }
  for (const entry of toRemove) {
    entries.delete(entry.key);
    void teardown(entry);
  }
}

/**
 * Tear down every channel owned by userId. Call on SIGNED_OUT and on
 * cross-user SIGNED_IN.
 */
export function revokeAllForUser(userId: string): void {
  const toRemove: Entry[] = [];
  for (const entry of entries.values()) {
    if (entry.userId === userId) toRemove.push(entry);
  }
  for (const entry of toRemove) {
    entries.delete(entry.key);
    void teardown(entry);
  }
}

/** Test/inspection helper. */
export function _debugListChannels(): ReadonlyArray<Omit<Entry, "channel">> {
  return Array.from(entries.values()).map(({ channel: _c, ...rest }) => rest);
}

/** Test-only reset. */
export function _resetRealtimeRegistry(): void {
  entries.clear();
}
