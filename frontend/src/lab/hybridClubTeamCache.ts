import type { Principal } from '@icp-sdk/core/principal';
import { withClubBackend } from './backendRouter';
import type { PlacementRegistry } from './hybridClubLinksService';

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
  team_type?: 'junior' | 'senior' | 'mixed';
  cached_at: number;
}

export interface ClubTeamMetadataProvider {
  getClubs(ids: string[]): Promise<CachedClub[]>;
  getTeams(ids: string[]): Promise<CachedTeam[]>;
}

export interface ClubTeamMetadataProviders {
  icp: (canister: Principal) => Promise<ClubTeamMetadataProvider>;
  supabase: (environment: string) => Promise<ClubTeamMetadataProvider>;
}

export interface ClubTeamCacheOptions {
  ttlMs?: number;
  now?: () => number;
}

function isFresh(entry: { cached_at: number }, now: number, ttlMs: number): boolean {
  return now - entry.cached_at >= 0 && now - entry.cached_at < ttlMs;
}

/**
 * Placement-routed adaptation of the bundle's club/team metadata cache.
 *
 * The source cache persisted globally in localStorage. The lab deliberately
 * keeps this cache in memory until authenticated identity scoping is proven;
 * provider selection and failures remain authoritative for every cache miss.
 */
export function createHybridClubTeamCache(
  registry: PlacementRegistry,
  providers: ClubTeamMetadataProviders,
  options: ClubTeamCacheOptions = {},
) {
  const ttlMs = options.ttlMs ?? 24 * 60 * 60 * 1000;
  const now = options.now ?? (() => Date.now());
  const clubs = new Map<string, CachedClub>();
  const teams = new Map<string, CachedTeam>();
  const clients = new Map<string, ClubTeamMetadataProvider>();

  const providerFor = async (placementClubId: string): Promise<ClubTeamMetadataProvider> => {
    const key = `club:${placementClubId}`;
    const existing = clients.get(key);
    if (existing) return existing;

    const provider = await withClubBackend(registry, providers, placementClubId, async value => value);
    clients.set(key, provider);
    return provider;
  };

  const readClub = (id: string): CachedClub | null => {
    const value = clubs.get(id);
    if (!value || !isFresh(value, now(), ttlMs)) {
      if (value) clubs.delete(id);
      return null;
    }
    return value;
  };

  const readTeam = (id: string): CachedTeam | null => {
    const value = teams.get(id);
    if (!value || !isFresh(value, now(), ttlMs)) {
      if (value) teams.delete(id);
      return null;
    }
    return value;
  };

  return {
    getCachedClub: readClub,
    getCachedClubs(ids: string[]) {
      const cached: CachedClub[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const value = readClub(id);
        if (value) cached.push(value);
        else missing.push(id);
      }
      return { cached, missing };
    },
    getCachedTeam: readTeam,
    getCachedTeams(ids: string[]) {
      const cached: CachedTeam[] = [];
      const missing: string[] = [];
      for (const id of ids) {
        const value = readTeam(id);
        if (value) cached.push(value);
        else missing.push(id);
      }
      return { cached, missing };
    },
    cacheClub(club: Omit<CachedClub, 'cached_at'>) {
      clubs.set(club.id, { ...club, cached_at: now() });
    },
    cacheClubs(values: Array<Omit<CachedClub, 'cached_at'>>) {
      const cachedAt = now();
      for (const club of values) clubs.set(club.id, { ...club, cached_at: cachedAt });
    },
    cacheTeam(team: Omit<CachedTeam, 'cached_at'>) {
      teams.set(team.id, { ...team, cached_at: now() });
    },
    cacheTeams(values: Array<Omit<CachedTeam, 'cached_at'>>) {
      const cachedAt = now();
      for (const team of values) teams.set(team.id, { ...team, cached_at: cachedAt });
    },
    async fetchClubs(placementClubId: string, ids: string[]) {
      const { cached, missing } = this.getCachedClubs(ids);
      if (missing.length === 0) return { cached, missing: [] };
      const provider = await providerFor(placementClubId);
      const fetched = await provider.getClubs(missing);
      this.cacheClubs(fetched.map(({ cached_at: _cachedAt, ...club }) => club));
      return this.getCachedClubs(ids);
    },
    async fetchTeams(placementClubId: string, ids: string[]) {
      const { cached, missing } = this.getCachedTeams(ids);
      if (missing.length === 0) return { cached, missing: [] };
      const provider = await providerFor(placementClubId);
      const fetched = await provider.getTeams(missing);
      this.cacheTeams(fetched.map(({ cached_at: _cachedAt, ...team }) => team));
      return this.getCachedTeams(ids);
    },
    invalidateClub(clubId: string) {
      clubs.delete(clubId);
    },
    invalidateTeam(teamId: string) {
      teams.delete(teamId);
    },
    clear() {
      clubs.clear();
      teams.clear();
      clients.clear();
    },
  };
}
