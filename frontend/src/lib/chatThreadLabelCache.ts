/**
 * Account-scoped display labels for chat threads.
 *
 * Why: opening a thread used to paint the header with skeleton bars until the
 * thread's own metadata read resolved — on a cold on-chain read that is several
 * seconds of an unnamed header (Paul's report, 26 Oct 2026). The inbox already
 * knows every thread's name before the user taps it, so we keep a small
 * disposable copy of the *display label* and paint it instantly, then hand the
 * header to the authoritative read when it lands.
 *
 * Rules:
 *  - Labels only (title/subtitle/avatar URL). Never message text, never
 *    children's PII — message bodies stay out of persistent storage.
 *  - Scoped to one account: a stored blob is ignored when its userId differs,
 *    and sign-out clears it (see clearUserScopedCaches).
 *  - Bounded: entry cap + writeBoundedReadCache, so it counts against the
 *    device read-cache budget and can never grow without limit.
 *  - Display-only: nothing here grants access. Every thread page still runs its
 *    own authorization read before rendering messages or controls.
 */
import { writeBoundedReadCache } from "./deviceCacheBudget";

const CACHE_KEY = "ignite_chat_thread_labels_v1";
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000;
const FLUSH_DEBOUNCE_MS = 1500;
const IDLE_TIMEOUT_MS = 3000;
const MAX_LABELS = 120;
const MAX_TITLE_CHARS = 80;
const MAX_SUBTITLE_CHARS = 120;
const MAX_AVATAR_URL_CHARS = 500;

export type ChatThreadLabelType =
  | "dm"
  | "group"
  | "league"
  | "team"
  | "club"
  | "admin_group"
  | "broadcast"
  | "support";

export interface ChatThreadLabel {
  title: string;
  subtitle?: string;
  avatarUrl?: string;
}

interface StoredChatThreadLabel extends ChatThreadLabel {
  seen: number;
}

interface ChatThreadLabelCacheBlob {
  userId: string;
  timestamp: number;
  labels: Record<string, StoredChatThreadLabel>;
}

let memCache: ChatThreadLabelCacheBlob | null = null;
let memLoaded = false;
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushIdleHandle: number | null = null;
let pendingFlush = false;

function threadKey(type: ChatThreadLabelType, id: string): string {
  return `${type}:${id}`;
}

function cleanText(value: unknown, maxChars: number): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed.length > maxChars ? trimmed.slice(0, maxChars) : trimmed;
}

function cleanAvatarUrl(value: unknown): string | null {
  const url = cleanText(value, MAX_AVATAR_URL_CHARS);
  if (!url) return null;
  // Only remote images we would legitimately show in a header; nothing that
  // could smuggle a data: URI of arbitrary size into persistent storage.
  return url.startsWith("https://") || url.startsWith("http://") ? url : null;
}

function loadFromDisk(): ChatThreadLabelCacheBlob | null {
  if (memLoaded) return memCache;
  memLoaded = true;
  try {
    if (typeof localStorage === "undefined") return null;
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatThreadLabelCacheBlob;
    if (!parsed || typeof parsed.userId !== "string" || typeof parsed.timestamp !== "number") return null;
    if (Date.now() - parsed.timestamp > CACHE_EXPIRY_MS) {
      localStorage.removeItem(CACHE_KEY);
      return null;
    }
    if (!parsed.labels || typeof parsed.labels !== "object") return null;
    memCache = parsed;
  } catch {
    memCache = null;
  }
  return memCache;
}

function ensureMemCache(userId: string): ChatThreadLabelCacheBlob {
  const existing = loadFromDisk();
  if (existing && existing.userId === userId) return existing;
  // A different account's labels must never merge into this one.
  memCache = { userId, timestamp: Date.now(), labels: {} };
  return memCache;
}

function writeToDiskNow(): void {
  pendingFlush = false;
  if (!memCache) return;
  try {
    if (typeof localStorage === "undefined") return;
    writeBoundedReadCache(CACHE_KEY, JSON.stringify(memCache));
  } catch {
    /* caching is best-effort */
  }
}

function scheduleFlush(): void {
  if (pendingFlush) return;
  pendingFlush = true;
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = setTimeout(() => {
    flushTimer = null;
    // Stringify + setItem in idle time so a label write never lands on the
    // user's tap or navigation frame (same freeze avoidance as messageCache).
    const ric =
      typeof window !== "undefined" &&
      ((window as unknown as { requestIdleCallback?: (cb: () => void, opts?: { timeout: number }) => number })
        .requestIdleCallback);
    if (ric) {
      flushIdleHandle = ric(
        () => {
          flushIdleHandle = null;
          writeToDiskNow();
        },
        { timeout: IDLE_TIMEOUT_MS },
      );
    } else {
      setTimeout(writeToDiskNow, 0);
    }
  }, FLUSH_DEBOUNCE_MS);
}

/** Drop the least-recently-seen labels once the cap is passed. */
function trimLabels(labels: Record<string, StoredChatThreadLabel>): void {
  const keys = Object.keys(labels);
  if (keys.length <= MAX_LABELS) return;
  keys
    .sort((a, b) => (labels[a]?.seen ?? 0) - (labels[b]?.seen ?? 0))
    .slice(0, keys.length - MAX_LABELS)
    .forEach((key) => delete labels[key]);
}

function storeLabel(
  userId: string,
  type: ChatThreadLabelType,
  id: string,
  label: ChatThreadLabel,
): void {
  const title = cleanText(label.title, MAX_TITLE_CHARS);
  if (!userId || !id || !title) return;
  const cache = ensureMemCache(userId);
  const key = threadKey(type, id);
  const previous = cache.labels[key];
  const subtitle = cleanText(label.subtitle, MAX_SUBTITLE_CHARS) ?? previous?.subtitle ?? null;
  const avatarUrl = cleanAvatarUrl(label.avatarUrl) ?? previous?.avatarUrl ?? null;
  // Re-inserting moves the entry to the end so recency ordering stays honest.
  delete cache.labels[key];
  cache.labels[key] = {
    title,
    ...(subtitle ? { subtitle } : {}),
    ...(avatarUrl ? { avatarUrl } : {}),
    seen: Date.now(),
  };
  cache.timestamp = Date.now();
  trimLabels(cache.labels);
  scheduleFlush();
}

/**
 * Record one thread's display label. Safe to call on every render of a resolved
 * header — repeats are a no-op write into the same bounded map.
 */
export function rememberChatThreadLabel(
  userId: string | null | undefined,
  type: ChatThreadLabelType,
  id: string | null | undefined,
  label: ChatThreadLabel,
): void {
  if (!userId || !id) return;
  try {
    storeLabel(userId, type, id, label);
  } catch {
    /* caching is best-effort */
  }
}

/**
 * Record labels for a whole inbox in one pass. Only name-shaped fields are
 * read; preview text on the row is deliberately ignored.
 */
export function rememberChatThreadLabels(
  userId: string | null | undefined,
  rows: readonly {
    type: ChatThreadLabelType;
    id: string;
    name: string;
    avatarUrl?: string | null;
    subtitle?: string | null;
  }[],
): void {
  if (!userId || !Array.isArray(rows) || rows.length === 0) return;
  try {
    for (const row of rows) {
      if (!row || typeof row.id !== "string" || typeof row.name !== "string") continue;
      storeLabel(userId, row.type, row.id, {
        title: row.name,
        subtitle: row.subtitle ?? undefined,
        avatarUrl: row.avatarUrl ?? undefined,
      });
    }
  } catch {
    /* caching is best-effort */
  }
}

/**
 * The label we last saw for this thread on this account, or null. Callers use it
 * only to paint a header while the authoritative read is still running.
 */
export function getChatThreadLabel(
  userId: string | null | undefined,
  types: ChatThreadLabelType | readonly ChatThreadLabelType[],
  id: string | null | undefined,
): ChatThreadLabel | null {
  if (!userId || !id) return null;
  try {
    const cache = loadFromDisk();
    if (!cache || cache.userId !== userId) return null;
    const candidates = Array.isArray(types) ? types : [types as ChatThreadLabelType];
    for (const type of candidates) {
      const stored = cache.labels[threadKey(type, id)];
      if (stored && typeof stored.title === "string" && stored.title) {
        return {
          title: stored.title,
          ...(stored.subtitle ? { subtitle: stored.subtitle } : {}),
          ...(stored.avatarUrl ? { avatarUrl: stored.avatarUrl } : {}),
        };
      }
    }
  } catch {
    /* display fallback only */
  }
  return null;
}

/** Drop every remembered label — used on sign-out. */
export function clearChatThreadLabelCache(): void {
  memCache = null;
  memLoaded = true;
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (
    flushIdleHandle !== null &&
    typeof window !== "undefined" &&
    (window as unknown as { cancelIdleCallback?: (handle: number) => void }).cancelIdleCallback
  ) {
    (window as unknown as { cancelIdleCallback: (handle: number) => void }).cancelIdleCallback(flushIdleHandle);
  }
  flushIdleHandle = null;
  pendingFlush = false;
  try {
    if (typeof localStorage !== "undefined") localStorage.removeItem(CACHE_KEY);
  } catch {
    /* already gone */
  }
}

/** Test seam: forget the in-memory mirror so the next read re-loads from disk. */
export function resetChatThreadLabelCacheForTests(): void {
  memCache = null;
  memLoaded = false;
}
