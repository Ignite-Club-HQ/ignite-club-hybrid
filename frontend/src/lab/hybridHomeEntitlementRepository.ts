import type { Principal } from '@icp-sdk/core/principal';
import { withClubBackend } from './backendRouter';
import type { PlacementRegistry } from './hybridClubLinksService';

export type ProEntitlementRow = {
  is_pro?: boolean | null;
  is_pro_football?: boolean | null;
  admin_pro_override?: boolean | null;
  admin_pro_football_override?: boolean | null;
};

export type HomeRewardClub = {
  id: string;
  name: string;
  logo_url: string | null;
  hasPro: boolean;
};

/**
 * One club's Home entitlement scope. Team entitlements must be grouped by
 * their owning club before routing because placement is authoritative per club,
 * not per team id.
 */
export type HomeEntitlementScope = {
  clubId: string;
  teamIds?: readonly string[];
};

export interface HomeEntitlementProvider {
  hasHomeProAccess(clubId: string, teamIds: readonly string[]): Promise<boolean>;
  getHomeRewardClub(clubId: string): Promise<HomeRewardClub | null>;
}

export type HomeEntitlementProviders = {
  icp: (canister: Principal) => Promise<HomeEntitlementProvider>;
  supabase: (environment: string) => Promise<HomeEntitlementProvider>;
};

export type HomeProAccessOutcome =
  | { status: 'ok'; hasPro: boolean }
  | { status: 'unavailable'; error: unknown };

export type HomeProAccessFetchResult = {
  hasPro: boolean;
  groups: Record<string, HomeProAccessOutcome>;
};

export type HomeRewardClubOutcome =
  | { status: 'ok'; club: HomeRewardClub | null }
  | { status: 'unavailable'; error: unknown };

export type HomeRewardClubsFetchResult = {
  clubs: HomeRewardClub[];
  groups: Record<string, HomeRewardClubOutcome>;
};

function hasProEntitlement(row: ProEntitlementRow | null | undefined): boolean {
  return !!(
    row?.is_pro ||
    row?.is_pro_football ||
    row?.admin_pro_override ||
    row?.admin_pro_football_override
  );
}

export function resolveHomeProAccess(
  clubSubscriptions: readonly ProEntitlementRow[] | null | undefined,
  teamSubscriptions: readonly ProEntitlementRow[] | null | undefined,
  teams: readonly { is_pro?: boolean | null }[] | null | undefined,
): boolean {
  if ((clubSubscriptions ?? []).some(hasProEntitlement)) return true;
  if ((teamSubscriptions ?? []).some(hasProEntitlement)) return true;
  return (teams ?? []).some(team => !!team.is_pro);
}

export function normalizeHomeEntitlementScopes(
  scopes: readonly HomeEntitlementScope[],
): HomeEntitlementScope[] {
  const byClub = new Map<string, Set<string>>();
  for (const scope of scopes) {
    if (!scope.clubId) continue;
    const teamIds = byClub.get(scope.clubId) ?? new Set<string>();
    for (const teamId of scope.teamIds ?? []) {
      if (teamId) teamIds.add(teamId);
    }
    byClub.set(scope.clubId, teamIds);
  }
  return [...byClub.entries()].map(([clubId, teamIds]) => ({
    clubId,
    teamIds: [...teamIds],
  }));
}

export async function fetchHomeProAccessForClub(
  provider: HomeEntitlementProvider,
  scope: HomeEntitlementScope,
): Promise<boolean> {
  return provider.hasHomeProAccess(scope.clubId, scope.teamIds ?? []);
}

export async function fetchHomeRewardClubForClub(
  provider: HomeEntitlementProvider,
  clubId: string,
): Promise<HomeRewardClub | null> {
  return provider.getHomeRewardClub(clubId);
}

/**
 * Placement-routed adaptation of Home entitlement reads. Home may summarize
 * memberships from clubs on different backends, so each club is resolved and
 * queried independently. Unavailable ICP/Supabase providers are surfaced as
 * typed per-club outcomes; they never trigger a fallback to the other backend.
 */
export function createHybridHomeEntitlementRepository(
  registry: PlacementRegistry,
  providers: HomeEntitlementProviders,
) {
  const clients = new Map<string, HomeEntitlementProvider>();

  const providerFor = async (clubId: string): Promise<HomeEntitlementProvider> => {
    const key = `club:${clubId}`;
    const existing = clients.get(key);
    if (existing) return existing;

    const provider = await withClubBackend(registry, providers, clubId, async value => value);
    clients.set(key, provider);
    return provider;
  };

  return {
    async fetchProAccessAcrossClubs(
      scopes: readonly HomeEntitlementScope[],
    ): Promise<HomeProAccessFetchResult> {
      let hasPro = false;
      const groups: Record<string, HomeProAccessOutcome> = {};

      for (const scope of normalizeHomeEntitlementScopes(scopes)) {
        try {
          const provider = await providerFor(scope.clubId);
          const clubHasPro = await fetchHomeProAccessForClub(provider, scope);
          groups[scope.clubId] = { status: 'ok', hasPro: clubHasPro };
          hasPro ||= clubHasPro;
        } catch (error) {
          groups[scope.clubId] = { status: 'unavailable', error };
        }
      }

      return { hasPro, groups };
    },

    async fetchRewardClubs(
      clubIds: readonly string[],
      activeClubId: string | null | undefined,
    ): Promise<HomeRewardClubsFetchResult> {
      const ids = activeClubId ? [activeClubId] : [...new Set(clubIds.filter(Boolean))];
      const clubs: HomeRewardClub[] = [];
      const groups: Record<string, HomeRewardClubOutcome> = {};

      for (const clubId of ids) {
        try {
          const provider = await providerFor(clubId);
          const club = await fetchHomeRewardClubForClub(provider, clubId);
          groups[clubId] = { status: 'ok', club };
          if (club) clubs.push(club);
        } catch (error) {
          groups[clubId] = { status: 'unavailable', error };
        }
      }

      return { clubs, groups };
    },

    clearProviderCache() {
      clients.clear();
    },
  };
}
