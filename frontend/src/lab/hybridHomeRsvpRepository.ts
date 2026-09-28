import type { Principal } from '@icp-sdk/core/principal';
import { withClubBackend } from './backendRouter';
import type { PlacementRegistry } from './hybridClubLinksService';

export type HomeUserRsvp = {
  event_id: string;
  status: string;
};

/**
 * One club's slice of the events currently visible on Home. Home aggregates
 * events across every club the signed-in user belongs to, and each club may
 * be placed on a different backend, so the caller must group event ids by
 * the club that owns them before this repository can route each group.
 */
export type HomeRsvpEventGroup = {
  clubId: string;
  eventIds: readonly string[];
};

/**
 * Read the signed-in adult's RSVP status for one club's visible events. Child
 * RSVP rows are deliberately excluded because Home's compact action
 * represents the signed-in user; child responses are managed in the RSVP
 * flow. Ported unchanged from the bundle's `fetchHomeUserRsvps`, adapted to
 * take a throwing provider instead of a raw Supabase-shaped `client: any`.
 */
export interface HomeRsvpProvider {
  listUserRsvps(userId: string, eventIds: readonly string[]): Promise<HomeUserRsvp[]>;
}

export type HomeRsvpProviders = {
  icp: (canister: Principal) => Promise<HomeRsvpProvider>;
  supabase: (environment: string) => Promise<HomeRsvpProvider>;
};

/**
 * Per-club outcome of one Home RSVP aggregation. Unlike the single-event
 * RSVP repository (where the RSVP read is the authoritative record for that
 * event and must fail closed), Home's RSVP status is a best-effort summary
 * spanning every club membership: a temporarily unavailable club must not
 * make the rest of Home's dashboard unusable. That degradation is still
 * never silently swallowed — each club's outcome is returned as an
 * inspectable `HomeRsvpGroupOutcome` so a caller can show a "some clubs'
 * RSVP status could not be loaded" notice explicitly, and it is never
 * converted into a same-club Supabase fallback.
 */
export type HomeRsvpGroupOutcome =
  | { status: 'ok'; rows: HomeUserRsvp[] }
  | { status: 'unavailable'; error: unknown };

export type HomeRsvpFetchResult = {
  rows: HomeUserRsvp[];
  groups: Record<string, HomeRsvpGroupOutcome>;
};

/**
 * Read one club's RSVP rows. Matches the bundle's original empty-input
 * short-circuit so a club with no currently-visible events never issues a
 * query.
 */
export async function fetchHomeUserRsvpsForClub(
  provider: HomeRsvpProvider,
  userId: string,
  eventIds: readonly string[],
): Promise<HomeUserRsvp[]> {
  if (eventIds.length === 0) return [];
  return provider.listUserRsvps(userId, eventIds);
}

/**
 * Placement-routed adaptation: resolves each club's authoritative backend
 * independently and caches one provider per backend identity, mirroring
 * every other hybrid service in this lab. An unavailable/disabled backend
 * for one club surfaces its reason with no Supabase fallback for that club,
 * while other clubs' groups are still attempted independently.
 */
export function createHybridHomeRsvpRepository(
  registry: PlacementRegistry,
  providers: HomeRsvpProviders,
) {
  const clients = new Map<string, HomeRsvpProvider>();

  const providerFor = async (clubId: string): Promise<HomeRsvpProvider> => {
    const key = `club:${clubId}`;
    const existing = clients.get(key);
    if (existing) return existing;

    const provider = await withClubBackend(registry, providers, clubId, async value => value);
    clients.set(key, provider);
    return provider;
  };

  return {
    async fetchRsvpsAcrossClubs(
      userId: string,
      groups: readonly HomeRsvpEventGroup[],
    ): Promise<HomeRsvpFetchResult> {
      const rows: HomeUserRsvp[] = [];
      const groupOutcomes: Record<string, HomeRsvpGroupOutcome> = {};

      for (const group of groups) {
        if (group.eventIds.length === 0) {
          groupOutcomes[group.clubId] = { status: 'ok', rows: [] };
          continue;
        }
        try {
          const provider = await providerFor(group.clubId);
          const groupRows = await fetchHomeUserRsvpsForClub(provider, userId, group.eventIds);
          groupOutcomes[group.clubId] = { status: 'ok', rows: groupRows };
          rows.push(...groupRows);
        } catch (error) {
          groupOutcomes[group.clubId] = { status: 'unavailable', error };
        }
      }

      return { rows, groups: groupOutcomes };
    },
    clearProviderCache() {
      clients.clear();
    },
  };
}
