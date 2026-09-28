// Local cache for user's own roles with aggressive caching

export interface CachedRole {
  id: string;
  role: string;
  club_id: string | null;
  team_id: string | null;
}

interface RolesCacheEntry {
  roles: CachedRole[];
  cached_at: number;
}

const ROLES_CACHE_KEY = "ignite_user_roles_cache";
const CACHE_TTL = 1000 * 60 * 30; // 30 minutes - roles change occasionally
const STALE_TTL = 1000 * 60 * 60 * 4; // 4 hours - use stale data if DB fails

let memoryCache: RolesCacheEntry | null = null;
let memoryCacheLoaded = false;

function ensureMemoryCacheLoaded() {
  if (memoryCacheLoaded) return;
  try {
    const stored = localStorage.getItem(ROLES_CACHE_KEY);
    if (stored) {
      memoryCache = JSON.parse(stored);
    }
    memoryCacheLoaded = true;
  } catch {
    memoryCacheLoaded = true;
  }
}

let saveTimeout: number | null = null;

function saveCache() {
  if (saveTimeout) clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(() => {
    try {
      if (memoryCache) {
        localStorage.setItem(ROLES_CACHE_KEY, JSON.stringify(memoryCache));
      } else {
        localStorage.removeItem(ROLES_CACHE_KEY);
      }
    } catch {
      try { localStorage.removeItem(ROLES_CACHE_KEY); } catch {}
    }
  }, 500);
}

function isCacheValid(): boolean {
  if (!memoryCache) return false;
  return Date.now() - memoryCache.cached_at < CACHE_TTL;
}

// Check if cache is stale but still usable
function isCacheUsable(): boolean {
  if (!memoryCache) return false;
  return Date.now() - memoryCache.cached_at < STALE_TTL;
}

// Get cached roles - returns stale data if available
export function getCachedRoles(options: { allowStale?: boolean } = {}): CachedRole[] | null {
  const { allowStale = true } = options;
  ensureMemoryCacheLoaded();
  
  if (!memoryCache) return null;
  
  if (isCacheValid()) {
    return memoryCache.roles;
  }
  
  if (allowStale && isCacheUsable()) {
    return memoryCache.roles;
  }
  
  return null;
}

// Check if roles need refresh (stale but still being used)
export function rolesNeedRefresh(): boolean {
  ensureMemoryCacheLoaded();
  if (!memoryCache) return true;
  return !isCacheValid() && isCacheUsable();
}

// Cache user roles
export function cacheRoles(roles: CachedRole[]) {
  ensureMemoryCacheLoaded();
  memoryCache = {
    roles,
    cached_at: Date.now(),
  };
  saveCache();
}

// Check if user has a specific role (from cache)
export function hasCachedRole(
  role: string,
  clubId?: string | null,
  teamId?: string | null
): boolean | null {
  const roles = getCachedRoles();
  if (!roles) return null; // Cache miss - caller should fetch
  
  return roles.some(r => {
    if (r.role !== role) return false;
    if (clubId !== undefined && r.club_id !== clubId) return false;
    if (teamId !== undefined && r.team_id !== teamId) return false;
    return true;
  });
}

// Get all roles for a specific club
export function getCachedClubRoles(clubId: string): CachedRole[] | null {
  const roles = getCachedRoles();
  if (!roles) return null;
  return roles.filter(r => r.club_id === clubId);
}

// Get all roles for a specific team
export function getCachedTeamRoles(teamId: string): CachedRole[] | null {
  const roles = getCachedRoles();
  if (!roles) return null;
  return roles.filter(r => r.team_id === teamId);
}

// Check if user is admin of a club (from cache)
export function isCachedClubAdmin(clubId: string): boolean | null {
  return hasCachedRole('club_admin', clubId, null);
}

// Check if user is admin of a team (from cache)
export function isCachedTeamAdmin(teamId: string): boolean | null {
  return hasCachedRole('team_admin', null, teamId);
}

// Check if user is app admin (from cache)
export function isCachedAppAdmin(): boolean | null {
  return hasCachedRole('app_admin');
}

// Invalidate cache (call after role changes)
export function invalidateRolesCache() {
  memoryCache = null;
  memoryCacheLoaded = false;
  try {
    localStorage.removeItem(ROLES_CACHE_KEY);
  } catch {}
}

// Clear on logout
export function clearRolesCache() {
  invalidateRolesCache();
}
