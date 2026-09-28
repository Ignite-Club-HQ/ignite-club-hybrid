import type { Principal } from '@icp-sdk/core/principal';
import { withClubBackend } from './backendRouter';
import type { PlacementRegistry } from './hybridClubLinksService';

export type EventRsvpRow = {
  id: string;
  event_id: string;
  user_id: string | null;
  child_id: string | null;
  status: string;
  mini_league_players?: unknown;
  [key: string]: unknown;
};

export type EventRsvpProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type EventRsvpChild = { id: string; name: string };

export type EventRsvpProfileLoader = (userIds: string[]) => Promise<EventRsvpProfile[]>;

/**
 * The authoritative RSVP read plus display-only child lookups for one event.
 * Both belong to the same club backend, so a single provider serves both.
 */
export interface EventRsvpProvider {
  listRsvps(eventId: string): Promise<EventRsvpRow[]>;
  listChildren(childIds: string[]): Promise<EventRsvpChild[]>;
}

export type EventRsvpProviders = {
  icp: (canister: Principal) => Promise<EventRsvpProvider>;
  supabase: (environment: string) => Promise<EventRsvpProvider>;
};

/**
 * Inspectable outcome of one optional display-enrichment lookup. `'skipped'`
 * means no row required that lookup; `'unavailable'` carries the causing
 * error so a caller can surface a degraded-enrichment notice explicitly
 * instead of the failure being caught and discarded.
 */
export type EnrichmentOutcome =
  | { status: 'skipped' }
  | { status: 'ok' }
  | { status: 'unavailable'; error: unknown };

export type EventRsvpFetchResult = {
  rows: EventRsvpRow[];
  profilesEnrichment: EnrichmentOutcome;
  childrenEnrichment: EnrichmentOutcome;
};

/**
 * Read the authoritative RSVP rows for one event, then enrich display-only
 * profile and child information. The RSVP read fails closed and propagates
 * any error directly. Enrichment is intentionally best effort — a failed
 * profile or child lookup must never make a valid attendance row disappear —
 * but that degradation is never silently swallowed: each lookup's outcome is
 * returned as an inspectable `EnrichmentOutcome` so a caller can surface a
 * "some names/children could not be loaded" notice explicitly.
 *
 * Adapted from the bundle's `eventRsvpRepository`, which took a raw
 * Supabase-shaped `client: any` and relied on Postgrest's `{ data, error }`
 * responses never throwing to make enrichment implicitly best effort. The
 * provider boundary here uses throwing async methods (matching every other
 * hybrid provider in this lab), so an enrichment failure must be caught
 * explicitly — and is reported back rather than caught and discarded.
 */
export async function fetchEventRsvps(
  provider: EventRsvpProvider,
  eventId: string,
  loadProfiles: EventRsvpProfileLoader,
): Promise<EventRsvpFetchResult> {
  const rows = await provider.listRsvps(eventId);

  const userIds = rows.filter(row => row.user_id).map(row => row.user_id as string);
  const childIds = rows.filter(row => row.child_id).map(row => row.child_id as string);

  let profilesMap: Record<string, Omit<EventRsvpProfile, 'id'>> = {};
  let profilesEnrichment: EnrichmentOutcome = { status: 'skipped' };
  if (userIds.length > 0) {
    try {
      const profiles = await loadProfiles(userIds);
      profilesMap = Object.fromEntries(
        profiles.map(profile => [profile.id, { display_name: profile.display_name, avatar_url: profile.avatar_url }]),
      );
      profilesEnrichment = { status: 'ok' };
    } catch (error) {
      profilesEnrichment = { status: 'unavailable', error };
    }
  }

  let childrenMap: Record<string, EventRsvpChild> = {};
  let childrenEnrichment: EnrichmentOutcome = { status: 'skipped' };
  if (childIds.length > 0) {
    try {
      const children = await provider.listChildren(childIds);
      childrenMap = Object.fromEntries(children.map(child => [child.id, child]));
      childrenEnrichment = { status: 'ok' };
    } catch (error) {
      childrenEnrichment = { status: 'unavailable', error };
    }
  }

  const enrichedRows = rows.map(row => ({
    ...row,
    profiles: row.user_id ? profilesMap[row.user_id] ?? null : null,
    children: row.child_id ? childrenMap[row.child_id] ?? null : null,
  }));

  return { rows: enrichedRows, profilesEnrichment, childrenEnrichment };
}

/**
 * Placement-routed adaptation: resolves the club's authoritative backend and
 * caches one provider per backend identity, mirroring every other hybrid
 * service in this lab. An unavailable/disabled backend surfaces its reason
 * with no Supabase fallback in ICP mode.
 */
export function createHybridEventRsvpRepository(
  registry: PlacementRegistry,
  providers: EventRsvpProviders,
) {
  const clients = new Map<string, EventRsvpProvider>();

  const providerFor = async (clubId: string): Promise<EventRsvpProvider> => {
    const key = `club:${clubId}`;
    const existing = clients.get(key);
    if (existing) return existing;

    const provider = await withClubBackend(registry, providers, clubId, async value => value);
    clients.set(key, provider);
    return provider;
  };

  return {
    async fetchRsvps(
      clubId: string,
      eventId: string,
      loadProfiles: EventRsvpProfileLoader,
    ): Promise<EventRsvpFetchResult> {
      const provider = await providerFor(clubId);
      return fetchEventRsvps(provider, eventId, loadProfiles);
    },
    clearProviderCache() {
      clients.clear();
    },
  };
}
