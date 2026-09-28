// Local cache for club and team metadata

export interface CachedClub {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
  is_pro: boolean;
  cached_at: number;
}

export interface CachedTeam {
  id: string;
  name: string;
  logo_url: string | null;
  club_id: string;
  level_age: string | null;
  team_type?: "junior" | "senior" | "mixed";
  cached_at: number;
}

const CLUBS_CACHE_KEY = "ignite_clubs_cache";
const TEAMS_CACHE_KEY = "ignite_teams_cache";
const CACHE_TTL = 1000 * 60 * 60 * 24; // 24 hours - metadata rarely changes

// In-memory caches
const clubsMemoryCache = new Map<string, CachedClub>();
const teamsMemoryCache = new Map<string, CachedTeam>();
let memoryCacheLoaded = false;

function ensureMemoryCacheLoaded() {
  if (memoryCacheLoaded) return;
  try {
    const clubsStored = localStorage.getItem(CLUBS_CACHE_KEY);
    if (clubsStored) {
      const parsed = JSON.parse(clubsStored) as Record<string, CachedClub>;
      Object.entries(parsed).forEach(([key, club]) => {
        clubsMemoryCache.set(key, club);
      });
    }
    const teamsStored = localStorage.getItem(TEAMS_CACHE_KEY);
    if (teamsStored) {
      const parsed = JSON.parse(teamsStored) as Record<string, CachedTeam>;
      Object.entries(parsed).forEach(([key, team]) => {
        teamsMemoryCache.set(key, team);
      });
    }
    memoryCacheLoaded = true;
  } catch {
    memoryCacheLoaded = true;
  }
}

// Debounced saves
let saveClubsTimeout: number | null = null;
let saveTeamsTimeout: number | null = null;

function saveClubsCache() {
  if (saveClubsTimeout) clearTimeout(saveClubsTimeout);
  saveClubsTimeout = window.setTimeout(() => {
    try {
      const obj: Record<string, CachedClub> = {};
      clubsMemoryCache.forEach((club, key) => {
        obj[key] = club;
      });
      localStorage.setItem(CLUBS_CACHE_KEY, JSON.stringify(obj));
    } catch {
      try { localStorage.removeItem(CLUBS_CACHE_KEY); } catch {}
    }
  }, 1000);
}

function saveTeamsCache() {
  if (saveTeamsTimeout) clearTimeout(saveTeamsTimeout);
  saveTeamsTimeout = window.setTimeout(() => {
    try {
      const obj: Record<string, CachedTeam> = {};
      teamsMemoryCache.forEach((team, key) => {
        obj[key] = team;
      });
      localStorage.setItem(TEAMS_CACHE_KEY, JSON.stringify(obj));
    } catch {
      try { localStorage.removeItem(TEAMS_CACHE_KEY); } catch {}
    }
  }, 1000);
}

function isCacheValid(cachedAt: number): boolean {
  return Date.now() - cachedAt < CACHE_TTL;
}

// Club caching
export function getCachedClub(clubId: string): CachedClub | null {
  ensureMemoryCacheLoaded();
  const club = clubsMemoryCache.get(clubId);
  if (!club || !isCacheValid(club.cached_at)) {
    if (club) clubsMemoryCache.delete(clubId);
    return null;
  }
  return club;
}

export function getCachedClubs(clubIds: string[]): { cached: CachedClub[]; missing: string[] } {
  ensureMemoryCacheLoaded();
  const cached: CachedClub[] = [];
  const missing: string[] = [];
  
  for (const id of clubIds) {
    const club = getCachedClub(id);
    if (club) {
      cached.push(club);
    } else {
      missing.push(id);
    }
  }
  
  return { cached, missing };
}

export function cacheClub(club: {
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
  is_pro: boolean;
}) {
  ensureMemoryCacheLoaded();
  clubsMemoryCache.set(club.id, { ...club, cached_at: Date.now() });
  saveClubsCache();
}

export function cacheClubs(clubs: Array<{
  id: string;
  name: string;
  logo_url: string | null;
  sport: string | null;
  is_pro: boolean;
}>) {
  ensureMemoryCacheLoaded();
  const now = Date.now();
  clubs.forEach(club => {
    clubsMemoryCache.set(club.id, { ...club, cached_at: now });
  });
  saveClubsCache();
}

// Team caching
export function getCachedTeam(teamId: string): CachedTeam | null {
  ensureMemoryCacheLoaded();
  const team = teamsMemoryCache.get(teamId);
  if (!team || !isCacheValid(team.cached_at)) {
    if (team) teamsMemoryCache.delete(teamId);
    return null;
  }
  return team;
}

export function getCachedTeams(teamIds: string[]): { cached: CachedTeam[]; missing: string[] } {
  ensureMemoryCacheLoaded();
  const cached: CachedTeam[] = [];
  const missing: string[] = [];
  
  for (const id of teamIds) {
    const team = getCachedTeam(id);
    if (team) {
      cached.push(team);
    } else {
      missing.push(id);
    }
  }
  
  return { cached, missing };
}

export function cacheTeam(team: {
  id: string;
  name: string;
  logo_url: string | null;
  club_id: string;
  level_age: string | null;
  team_type?: "junior" | "senior" | "mixed";
}) {
  ensureMemoryCacheLoaded();
  teamsMemoryCache.set(team.id, { ...team, cached_at: Date.now() });
  saveTeamsCache();
}

export function cacheTeams(teams: Array<{
  id: string;
  name: string;
  logo_url: string | null;
  club_id: string;
  level_age: string | null;
  team_type?: "junior" | "senior" | "mixed";
}>) {
  ensureMemoryCacheLoaded();
  const now = Date.now();
  teams.forEach(team => {
    teamsMemoryCache.set(team.id, { ...team, cached_at: now });
  });
  saveTeamsCache();
}

// Invalidation
export function invalidateClubCache(clubId: string) {
  ensureMemoryCacheLoaded();
  clubsMemoryCache.delete(clubId);
  saveClubsCache();
}

export function invalidateTeamCache(teamId: string) {
  ensureMemoryCacheLoaded();
  teamsMemoryCache.delete(teamId);
  saveTeamsCache();
}

export function clearClubTeamCache() {
  clubsMemoryCache.clear();
  teamsMemoryCache.clear();
  memoryCacheLoaded = false;
  try {
    localStorage.removeItem(CLUBS_CACHE_KEY);
    localStorage.removeItem(TEAMS_CACHE_KEY);
  } catch {}
}
