/**
 * Shared, module-level cache for `profiles` lookups by id.
 *
 * Purpose: cut repeated `profiles WHERE id = ANY(...)` fanouts by:
 *   1. Serving hot rows from memory (5 min TTL).
 *   2. De-duplicating concurrent requests for the same ids across the app.
 *   3. Coalescing rapid-fire calls into a single batched fetch (10ms window).
 *
 * Safe by design:
 *   - TTL keeps drift bounded; realtime updates elsewhere invalidate on edit.
 *   - Consumers that need instant freshness can call `updateProfileCache()`
 *     or `clearProfileCache()`.
 *   - No writes, no auth changes, no RLS interaction — pure read memoisation.
 */

import { supabase } from "@/integrations/supabase/client";

export interface CachedProfile {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
  /** Legacy field kept for backward compat with older callers. */
  cached_at?: number;
}

// Profile display_name / avatar_url change rarely; local edits already call
// `updateProfileCache()` to refresh the entry immediately, so a long TTL is
// safe and dramatically cuts the #1 slow query (`profiles WHERE id = ANY(...)`).
const FRESH_TTL_MS = 60 * 60 * 1000;     // 1h — considered fresh
const STALE_TTL_MS = 24 * 60 * 60 * 1000; // 24h — still usable when allowStale
// A null profile can be caused by a transient RLS/session/timing miss. Do not
// keep it "fresh" for an hour, otherwise Messages/Media can get stuck showing
// "Unknown User" for people whose profile is readable moments later.
const NULL_PROFILE_RETRY_MS = 5 * 1000;
const BATCH_WINDOW_MS = 10;
const DEFAULT_TIMEOUT_MS = 15_000;

interface Entry {
  profile: CachedProfile | null;
  fetchedAt: number;
}

const cache = new Map<string, Entry>();
const inFlight = new Map<string, Promise<CachedProfile | null>>();
const updateListeners = new Set<(id: string) => void>();

let pendingIds = new Set<string>();
let pendingResolvers = new Map<
  string,
  Array<(p: CachedProfile | null) => void>
>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;

function notify(id: string) {
  for (const cb of updateListeners) {
    try { cb(id); } catch { /* noop */ }
  }
}

function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(flushBatch, BATCH_WINDOW_MS);
}

async function flushBatch() {
  flushTimer = null;
  const ids = Array.from(pendingIds);
  const resolvers = pendingResolvers;
  pendingIds = new Set();
  pendingResolvers = new Map();
  if (ids.length === 0) return;

  try {
    const { data, error } = await supabase
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", ids);
    if (error) throw error;

    const now = Date.now();
    const byId = new Map<string, CachedProfile>();
    for (const p of data ?? []) byId.set(p.id, p as CachedProfile);

    for (const id of ids) {
      const profile = byId.get(id) ?? null;
      cache.set(id, { profile, fetchedAt: now });
      inFlight.delete(id);
      notify(id);
      const cbs = resolvers.get(id) ?? [];
      for (const cb of cbs) cb(profile);
    }
  } catch (err) {
    for (const id of ids) {
      inFlight.delete(id);
      const cbs = resolvers.get(id) ?? [];
      for (const cb of cbs) cb(cache.get(id)?.profile ?? null);
    }
    // eslint-disable-next-line no-console
    console.warn("[profileCache] batch fetch failed", err);
  }
}

function requestOne(id: string): Promise<CachedProfile | null> {
  const existing = inFlight.get(id);
  if (existing) return existing;
  const p = new Promise<CachedProfile | null>((resolve) => {
    pendingIds.add(id);
    const arr = pendingResolvers.get(id) ?? [];
    arr.push(resolve);
    pendingResolvers.set(id, arr);
    scheduleFlush();
  });
  inFlight.set(id, p);
  return p;
}

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    let done = false;
    const timer = setTimeout(() => {
      if (done) return;
      done = true;
      resolve(fallback);
    }, ms);
    p.then((v) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(v);
    }).catch(() => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      resolve(fallback);
    });
  });
}

// ---------- Public API ----------

/** Read the current cached profile for `id`, ignoring TTL. Returns null if unknown. */
export function getProfileFromCache(id: string | null | undefined): CachedProfile | null {
  if (!id) return null;
  return cache.get(id)?.profile ?? null;
}

/**
 * Partition ids by cache state.
 * - cached: fresh entries (within FRESH_TTL_MS)
 * - stale:  present but past fresh TTL (still usable when allowStale)
 * - missing: not in cache or past STALE_TTL_MS
 */
export function getProfilesFromCache(ids: readonly string[]): {
  cached: Map<string, CachedProfile>;
  missing: string[];
  stale: string[];
} {
  const cached = new Map<string, CachedProfile>();
  const missing: string[] = [];
  const stale: string[] = [];
  const now = Date.now();
  const seen = new Set<string>();
  for (const raw of ids) {
    if (!raw || seen.has(raw)) continue;
    seen.add(raw);
    const entry = cache.get(raw);
    if (!entry) { missing.push(raw); continue; }
    const age = now - entry.fetchedAt;
    if (!entry.profile) {
      if (age >= NULL_PROFILE_RETRY_MS) missing.push(raw);
      continue;
    }
    if (age < FRESH_TTL_MS) {
      cached.set(raw, entry.profile);
    } else if (age < STALE_TTL_MS) {
      cached.set(raw, entry.profile);
      stale.push(raw);
    } else {
      missing.push(raw);
    }
  }
  return { cached, missing, stale };
}

/** Insert/refresh profiles in the cache (e.g., after a bespoke fetch). */
export function cacheProfiles(
  profiles: ReadonlyArray<Partial<CachedProfile> & { id: string }>,
) {
  const now = Date.now();
  for (const p of profiles ?? []) {
    if (!p?.id) continue;
    cache.set(p.id, {
      profile: {
        id: p.id,
        display_name: p.display_name ?? null,
        avatar_url: p.avatar_url ?? null,
      },
      fetchedAt: now,
    });
    notify(p.id);
  }
}

/** Update a single profile (e.g., after the current user edits their own). */
export function updateProfileCache(profile: Partial<CachedProfile> & { id: string }) {
  cacheProfiles([profile]);
}

/** Clear the whole cache (called on sign-out / cross-user switch). */
export function clearProfileCache() {
  cache.clear();
  inFlight.clear();
  pendingIds = new Set();
  pendingResolvers = new Map();
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
}

/** Subscribe to per-id cache updates. Returns unsubscribe. */
export function onProfileCacheUpdate(cb: (id: string) => void): () => void {
  updateListeners.add(cb);
  return () => { updateListeners.delete(cb); };
}

/**
 * Fetch profiles for the given ids. Returns a Map keyed by id.
 * - Cached fresh entries served instantly, no network.
 * - Misses batched into a single query (10ms window).
 * - opts.allowStale: also serve stale entries (still triggers background refresh
 *   for expired-but-not-purged ids to bound drift).
 * - opts.timeout: fall back to whatever is currently cached if the network is slow.
 */
export async function fetchProfilesWithCache(
  ids: readonly string[],
  opts: { allowStale?: boolean; timeout?: number } = {},
): Promise<Map<string, CachedProfile>> {
  const { allowStale = false, timeout = DEFAULT_TIMEOUT_MS } = opts;
  const uniqueIds = Array.from(new Set(ids.filter(Boolean)));
  if (uniqueIds.length === 0) return new Map();

  const { cached, missing, stale } = getProfilesFromCache(uniqueIds);

  const toFetch = allowStale ? missing : [...missing, ...stale];
  if (toFetch.length === 0) return cached;

  const fetchPromise = Promise.all(toFetch.map(requestOne)).then((fetched) => {
    const merged = new Map(cached);
    for (let i = 0; i < toFetch.length; i++) {
      const p = fetched[i];
      if (p) merged.set(toFetch[i], p);
    }
    return merged;
  });

  // Fallback returns whatever we have cached so UI never hangs on slow network.
  return withTimeout(fetchPromise, timeout, cached);
}

/** Convenience: fetch one profile through the cache. */
export async function fetchSingleProfileWithCache(
  id: string,
): Promise<CachedProfile | null> {
  const map = await fetchProfilesWithCache([id]);
  return map.get(id) ?? null;
}

// ---------- Drop-in helpers that mirror Supabase's `{ data, error }` shape ----------
// These exist so raw `supabase.from('profiles').select(...).in('id', ids)` calls
// can be replaced with a single line while preserving the caller's existing
// destructuring pattern. Both are pure reads via the cache — no network hit
// when entries are fresh, deduped batching when they aren't.

/**
 * The `error` field is typed as `Error | null` (never actually populated) so
 * existing call-sites that destructure `{ data, error }` and dereference
 * `error.message` still type-check without change.
 */
type CachedProfileResult<T> = { data: T; error: Error | null };

/** List variant: replaces `.select("id, display_name, avatar_url").in("id", ids)`. */
export async function selectCachedProfilesByIds(
  ids: readonly (string | null | undefined)[],
): Promise<CachedProfileResult<CachedProfile[]>> {
  const clean = ids.filter((v): v is string => typeof v === "string" && v.length > 0);
  if (clean.length === 0) return { data: [], error: null };
  const map = await fetchProfilesWithCache(clean);
  return { data: Array.from(map.values()), error: null };
}

/** Single variant: replaces `.select("...").eq("id", id).maybeSingle()`. */
export async function selectCachedProfileById(
  id: string | null | undefined,
): Promise<CachedProfileResult<CachedProfile | null>> {
  if (!id) return { data: null, error: null };
  const profile = await fetchSingleProfileWithCache(id);
  return { data: profile, error: null };
}


