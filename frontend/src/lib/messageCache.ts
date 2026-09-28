// Local message cache for offline reading
//
// IMPORTANT (Android WebView freeze fix — companion to messagesPageCache):
// Previously every cacheMessages / addMessageToCache / removeMessageFromCache
// call did synchronous JSON.parse(localStorage) → merge → JSON.stringify →
// setItem on the main thread. With ~100 messages × multiple chats × bursty
// react-query refetches after a chat unmount, this stacked into multi-second
// freezes on Android WebView.
//
// Now: an in-memory mirror is the source of truth for reads/merges. Disk
// writes are coalesced per cache key with a debounce (1500ms) and scheduled
// during requestIdleCallback so they never block the user's interaction or
// navigation frame. Same on-disk shape.

import { orderChatMessagesChronologically } from "@/lab/chatMessageOrdering";

export interface CachedMessage {
  id: string;
  text: string;
  author_id: string;
  created_at: string;
  image_url: string | null;
  reply_to_id: string | null;
  profiles: { display_name: string | null; avatar_url: string | null } | null;
  reactions?: Array<{ reaction_type: string; user_id: string; id?: string }>;
  reply_to?: {
    id?: string;
    text: string;
    author_id?: string;
    profiles?: { display_name: string | null } | null;
    author?: { display_name: string | null } | null;
  } | null;
  // Allow extra properties for different chat types
  [key: string]: unknown;
}

interface CacheEntry {
  messages: CachedMessage[];
  timestamp: number;
}

type ChatType = "team" | "club" | "group" | "broadcast" | "dm" | "club_admin";

const CACHE_KEY_PREFIX = "ignite_message_cache_";
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHED_MESSAGES = 100; // Per chat
const FLUSH_DEBOUNCE_MS = 1500;
const IDLE_TIMEOUT_MS = 3000;

// In-memory mirror of disk cache, keyed by full storage key.
// `null` = known-missing/expired (so we don't re-read disk every call).
const memCache = new Map<string, CacheEntry | null>();

// Pending disk-write timers and idle handles per key.
const pendingFlushTimers = new Map<string, ReturnType<typeof setTimeout>>();
const pendingIdleHandles = new Map<string, number>();

function getCacheKey(type: ChatType, targetId: string): string {
  return `${CACHE_KEY_PREFIX}${type}_${targetId}`;
}

function loadFromDisk(key: string): CacheEntry | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const stored = localStorage.getItem(key);
    if (!stored) return null;
    const entry: CacheEntry = JSON.parse(stored);
    if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
      try { localStorage.removeItem(key); } catch {}
      return null;
    }
    return entry;
  } catch {
    return null;
  }
}

function ensureLoaded(key: string): CacheEntry | null {
  if (memCache.has(key)) return memCache.get(key) ?? null;
  const entry = loadFromDisk(key);
  memCache.set(key, entry);
  return entry;
}

function flushKeyNow(key: string): void {
  pendingIdleHandles.delete(key);
  const entry = memCache.get(key);
  try {
    if (typeof localStorage === 'undefined') return;
    if (!entry) {
      try { localStorage.removeItem(key); } catch {}
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(entry));
    } catch {
      clearOldCaches();
      try { localStorage.setItem(key, JSON.stringify(entry)); } catch { /* drop */ }
    }
  } catch { /* best-effort */ }
}

function scheduleFlush(key: string): void {
  const existing = pendingFlushTimers.get(key);
  if (existing) clearTimeout(existing);
  const t = setTimeout(() => {
    pendingFlushTimers.delete(key);
    const ric = (typeof window !== 'undefined' && (window as any).requestIdleCallback) as
      | undefined
      | ((cb: () => void, opts?: { timeout: number }) => number);
    if (ric) {
      const handle = ric(() => flushKeyNow(key), { timeout: IDLE_TIMEOUT_MS });
      pendingIdleHandles.set(key, handle);
    } else {
      setTimeout(() => flushKeyNow(key), 0);
    }
  }, FLUSH_DEBOUNCE_MS);
  pendingFlushTimers.set(key, t);
}

// Get cached messages for a specific chat
export function getCachedMessages(type: ChatType, targetId: string): CachedMessage[] {
  const entry = ensureLoaded(getCacheKey(type, targetId));
  if (!entry) return [];
  return orderChatMessagesChronologically(entry.messages);
}

// Save messages to cache.
//
// IMPORTANT: We normalise the input to ascending-by-created_at order, then
// keep the TAIL of MAX_CACHED_MESSAGES — i.e. the newest N messages.
//
// Previously this did a naive `slice(0, N)` which assumed the caller passed
// a descending array. Most callers (chat pages' useLayoutEffect merge) pass
// ASCENDING arrays — so `slice(0, N)` silently kept the OLDEST 100 and
// dropped every newer message on every cache write. After the user scrolled
// up far enough to grow the merged list past 100, the on-disk cache became
// "frozen" at the oldest 100 messages. On app resume the chat re-seeded
// localMessages from that stale cache and the user appeared stuck on
// ancient history with no newer messages and no way to scroll down to
// today's content.
export function cacheMessages(type: ChatType, targetId: string, messages: CachedMessage[]): void {
  try {
    const key = getCacheKey(type, targetId);
    // Always normalise, even under the cap. Some callers pass descending
    // Supabase pages and others pass ascending merged render state; persisting
    // mixed order makes a cache-only first paint look like a broken history
    // boundary until the network query repairs it.
    const sortedAsc = orderChatMessagesChronologically(messages);
    const normalised = sortedAsc.slice(-MAX_CACHED_MESSAGES);
    const entry: CacheEntry = {
      messages: normalised,
      timestamp: Date.now(),
    };
    memCache.set(key, entry);
    scheduleFlush(key);
  } catch { /* caching is best-effort */ }
}

// Add a single message to cache (for optimistic updates)
export function addMessageToCache(type: ChatType, targetId: string, message: CachedMessage): void {
  try {
    const existing = getCachedMessages(type, targetId);
    const updated = [message, ...existing.filter(m => m.id !== message.id)];
    cacheMessages(type, targetId, updated);
  } catch {
    console.error("Failed to add message to cache");
  }
}

// Remove a message from cache (for deletion)
export function removeMessageFromCache(type: ChatType, targetId: string, messageId: string): void {
  try {
    const existing = getCachedMessages(type, targetId);
    const updated = existing.filter(m => m.id !== messageId);
    cacheMessages(type, targetId, updated);
  } catch { /* ignore */ }
}

// Clear old caches to free up space (called only when localStorage quota errors).
function clearOldCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(CACHE_KEY_PREFIX)) {
        try {
          const stored = localStorage.getItem(key);
          if (stored) {
            const entry: CacheEntry = JSON.parse(stored);
            if (Date.now() - entry.timestamp > CACHE_EXPIRY_MS) {
              keysToRemove.push(key);
            }
          }
        } catch {
          keysToRemove.push(key);
        }
      }
    }
    keysToRemove.forEach(key => {
      try { localStorage.removeItem(key); } catch {}
      memCache.delete(key);
    });
  } catch { /* ignore */ }
}

// Check if we have cached messages for a chat
export function hasCachedMessages(type: ChatType, targetId: string): boolean {
  return getCachedMessages(type, targetId).length > 0;
}

// Check if messages unexpectedly dropped to 0 (had cache but now empty).
// Returns true if a refetch should be triggered.
export function shouldRefetchMessages(type: ChatType, targetId: string, fetchedCount: number): boolean {
  if (fetchedCount > 0) return false;
  const cachedCount = getCachedMessages(type, targetId).length;
  return cachedCount > 0;
}

// Clear cache for a specific chat
export function clearMessageCache(type: ChatType, targetId: string): void {
  const key = getCacheKey(type, targetId);
  memCache.set(key, null);
  const t = pendingFlushTimers.get(key);
  if (t) { clearTimeout(t); pendingFlushTimers.delete(key); }
  const handle = pendingIdleHandles.get(key);
  if (handle != null && typeof window !== 'undefined' && (window as any).cancelIdleCallback) {
    try { (window as any).cancelIdleCallback(handle); } catch {}
    pendingIdleHandles.delete(key);
  }
  try { localStorage.removeItem(key); } catch {}
}
