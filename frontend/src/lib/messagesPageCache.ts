// Cache for messages page list data - enables instant loading for returning users.
//
// IMPORTANT (Android WebView freeze fix):
// Writes used to be synchronous on every dep change in MessagesPage's caching
// useEffect — which fires many times in a burst as each react-query refetch
// resolves (refetchInterval=30s + realtime + post-chat-unmount refetch). Each
// write did JSON.parse(localStorage) → merge → JSON.stringify → setItem. With
// power users (many teams/clubs/groups) the blob is 100-500KB and that I/O
// blocks the main thread for hundreds of ms per write. A burst of 5+ writes
// after returning from a chat freezes the WebView for >20s.
//
// Now: in-memory mirror is the source of truth for merges; disk writes are
// debounced (1500ms) and scheduled via requestIdleCallback so they never sit
// on the navigation/render critical path.

// v2 drops stale team rows cached before inbox queries filtered deleted/purged
// parent clubs. Keep the old key ignored so orphaned deleted-club teams do not
// flash back into /messages from localStorage.
const CACHE_KEY = 'messages-page-cache-v2';
const CACHE_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const FLUSH_DEBOUNCE_MS = 1500;
const IDLE_TIMEOUT_MS = 3000;

interface CachedTeam {
  id: string;
  name: string;
  logo_url: string | null;
  deleted_at?: string | null;
  clubs: { name: string; logo_url: string | null; sport: string | null; deleted_at?: string | null; purged_at?: string | null };
}

interface CachedClub {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
}

interface CachedGroup {
  id: string;
  name: string;
  allowed_roles: string[];
  team_id: string | null;
  club_id: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
  teams?: { name: string } | null;
  clubs?: { name: string } | null;
}

interface CachedDMConversation {
  id: string;
  participant_1: string;
  participant_2: string;
  updated_at: string;
  created_at?: string;
  created_by?: string | null;
  other_user: {
    id: string;
    display_name: string | null;
    avatar_url: string | null;
  } | null;
}

interface MessagesPageCache {
  userId: string;
  timestamp: number;
  teams: CachedTeam[];
  memberClubs: CachedClub[];
  adminClubs: CachedClub[];
  chatGroups: CachedGroup[];
  dmConversations: CachedDMConversation[];
  latestBroadcast: { text: string; created_at: string; image_url: string | null; profiles: { display_name: string } | null } | null;
  latestTeamMessages: Record<string, LatestMessage>;
  latestClubMessages: Record<string, LatestMessage>;
  latestGroupMessages: Record<string, LatestMessage>;
  latestDMMessages: Record<string, LatestMessage>;
}

interface LatestMessage {
  text: string;
  author: string;
  created_at: string;
  image_url?: string | null;
}

// In-memory mirror of the on-disk cache. Single read on first access; all
// subsequent merges read from here instead of re-parsing localStorage.
let memCache: MessagesPageCache | null = null;
let memCacheLoaded = false;

let flushTimer: ReturnType<typeof setTimeout> | null = null;
let flushIdleHandle: number | null = null;
let pendingFlush = false;

function safeLoadFromDisk(): MessagesPageCache | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    const cached = localStorage.getItem(CACHE_KEY);
    if (!cached) return null;
    const data: MessagesPageCache = JSON.parse(cached);
    if (Date.now() - data.timestamp > CACHE_EXPIRY_MS) {
      try { localStorage.removeItem(CACHE_KEY); } catch {}
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

function ensureMemCache(): void {
  if (memCacheLoaded) return;
  memCacheLoaded = true;
  memCache = safeLoadFromDisk();
}

export function getCachedMessagesPageData(userId: string): Omit<MessagesPageCache, 'userId' | 'timestamp'> | null {
  ensureMemCache();
  if (!memCache || memCache.userId !== userId) return null;
  return {
    teams: memCache.teams || [],
    memberClubs: memCache.memberClubs || [],
    adminClubs: memCache.adminClubs || [],
    chatGroups: memCache.chatGroups || [],
    dmConversations: memCache.dmConversations || [],
    latestBroadcast: memCache.latestBroadcast || null,
    latestTeamMessages: memCache.latestTeamMessages || {},
    latestClubMessages: memCache.latestClubMessages || {},
    latestGroupMessages: memCache.latestGroupMessages || {},
    latestDMMessages: memCache.latestDMMessages || {},
  };
}

function writeToDiskNow(): void {
  pendingFlush = false;
  if (!memCache) return;
  try {
    if (typeof localStorage === 'undefined') return;
    const jsonData = JSON.stringify(memCache);
    try {
      localStorage.setItem(CACHE_KEY, jsonData);
    } catch {
      clearOldCaches();
      try { localStorage.setItem(CACHE_KEY, jsonData); } catch { /* skip */ }
    }
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
    // Run the actual stringify + setItem in idle time so it never lands
    // on the user's interaction or navigation frame.
    const ric = (typeof window !== 'undefined' && (window as any).requestIdleCallback) as undefined | ((cb: () => void, opts?: { timeout: number }) => number);
    if (ric) {
      flushIdleHandle = ric(() => { flushIdleHandle = null; writeToDiskNow(); }, { timeout: IDLE_TIMEOUT_MS });
    } else {
      // Fallback: still off the immediate render frame.
      setTimeout(writeToDiskNow, 0);
    }
  }, FLUSH_DEBOUNCE_MS);
}

export function cacheMessagesPageData(
  userId: string,
  data: {
    teams?: CachedTeam[];
    memberClubs?: CachedClub[];
    adminClubs?: CachedClub[];
    chatGroups?: CachedGroup[];
    dmConversations?: CachedDMConversation[];
    latestBroadcast?: { text: string; created_at: string; image_url?: string | null; profiles?: { display_name: string } | null } | null;
    latestTeamMessages?: Record<string, LatestMessage>;
    latestClubMessages?: Record<string, LatestMessage>;
    latestGroupMessages?: Record<string, LatestMessage>;
    latestDMMessages?: Record<string, LatestMessage>;
  }
): void {
  try {
    ensureMemCache();
    const existing: MessagesPageCache | null =
      memCache && memCache.userId === userId ? memCache : null;

    memCache = {
      userId,
      timestamp: Date.now(),
      teams: data.teams ?? existing?.teams ?? [],
      memberClubs: data.memberClubs ?? existing?.memberClubs ?? [],
      adminClubs: data.adminClubs ?? existing?.adminClubs ?? [],
      chatGroups: data.chatGroups ?? existing?.chatGroups ?? [],
      dmConversations: data.dmConversations ?? existing?.dmConversations ?? [],
      latestBroadcast: (data.latestBroadcast !== undefined ? data.latestBroadcast : (existing?.latestBroadcast ?? null)) as MessagesPageCache['latestBroadcast'],
      latestTeamMessages: data.latestTeamMessages ?? existing?.latestTeamMessages ?? {},
      latestClubMessages: data.latestClubMessages ?? existing?.latestClubMessages ?? {},
      latestGroupMessages: data.latestGroupMessages ?? existing?.latestGroupMessages ?? {},
      latestDMMessages: data.latestDMMessages ?? existing?.latestDMMessages ?? {},
    };

    scheduleFlush();
  } catch (e) {
    console.debug('Failed to update messages page cache:', e);
  }
}

// Clear old localStorage caches to free up space
function clearOldCaches(): void {
  try {
    const keysToRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith('ignite_message_cache_') ||
          key?.startsWith('ignite_photos_cache') ||
          key?.startsWith('ignite_folders_cache')) {
        keysToRemove.push(key);
      }
    }
    keysToRemove.forEach(key => {
      try { localStorage.removeItem(key); } catch {}
    });
  } catch { /* ignore */ }
}

/**
 * Purge a single team from the persisted inbox snapshot.
 *
 * Called the moment a team is soft-deleted so the stale row can never be
 * repainted as a phantom second thread on the next cold load.
 */
export function removeTeamFromMessagesPageCache(userId: string, teamId: string): void {
  try {
    ensureMemCache();
    if (!memCache || memCache.userId !== userId) return;
    const nextTeams = (memCache.teams || []).filter((t: any) => t?.id !== teamId);
    const nextLatest = { ...(memCache.latestTeamMessages || {}) };
    delete nextLatest[teamId];
    memCache = { ...memCache, teams: nextTeams, latestTeamMessages: nextLatest };
    scheduleFlush();
  } catch {
    /* best-effort */
  }
}


export function clearMessagesPageCache(): void {
  memCache = null;
  memCacheLoaded = true;
  if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
  if (flushIdleHandle != null && typeof window !== 'undefined' && (window as any).cancelIdleCallback) {
    try { (window as any).cancelIdleCallback(flushIdleHandle); } catch {}
    flushIdleHandle = null;
  }
  pendingFlush = false;
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch { /* ignore */ }
}
