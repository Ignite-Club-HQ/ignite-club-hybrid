import type { Principal } from '@icp-sdk/core/principal';
import { withClubBackend } from './backendRouter';
import type { EnrichmentOutcome } from './hybridEventRsvpRepository';
import type { PlacementRegistry } from './hybridClubLinksService';

export type EventGuestRow = {
  id: string;
  event_id?: string;
  added_by?: string | null;
  [key: string]: unknown;
};

export type EventGuestWithAdderName = EventGuestRow & {
  added_by_name: string;
};

export type EventGuestProfile = {
  id: string;
  display_name: string | null;
  avatar_url?: string | null;
};

export type EventGuestProfileLoader = (userIds: string[]) => Promise<EventGuestProfile[]>;

export type EventDutyRow = {
  id: string;
  event_id?: string;
  name?: string | null;
  status?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  assigned_to?: string | null;
  profiles?: { display_name: string | null; avatar_url: string | null } | null;
  [key: string]: unknown;
};

export type EventGuestsFetchResult = {
  rows: EventGuestWithAdderName[];
  adderProfilesEnrichment: EnrichmentOutcome;
};

export interface EventSupportingReadsProvider {
  listEventGuests(eventId: string): Promise<EventGuestRow[]>;
  listEventDuties(eventId: string): Promise<EventDutyRow[]>;
}

export type EventSupportingReadsProviders = {
  icp: (canister: Principal) => Promise<EventSupportingReadsProvider>;
  supabase: (environment: string) => Promise<EventSupportingReadsProvider>;
};

function isPresentUserId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

/**
 * Read event guests for one event and enrich the display name of the adding
 * member. The guest list is authoritative and fails closed; profile enrichment
 * is display-only, so failures are surfaced as degraded outcomes while rows
 * still render with the neutral source fallback.
 */
export async function fetchEventGuests(
  provider: EventSupportingReadsProvider,
  eventId: string,
  loadProfiles: EventGuestProfileLoader,
): Promise<EventGuestsFetchResult> {
  const rows = await provider.listEventGuests(eventId);
  const adderIds = [...new Set(rows.map(guest => guest.added_by).filter(isPresentUserId))];

  let adderMap: Record<string, string> = {};
  let adderProfilesEnrichment: EnrichmentOutcome = { status: 'skipped' };
  if (adderIds.length > 0) {
    try {
      const profiles = await loadProfiles(adderIds);
      adderMap = Object.fromEntries(
        profiles.map(profile => [profile.id, profile.display_name || 'A member']),
      );
      adderProfilesEnrichment = { status: 'ok' };
    } catch (error) {
      adderProfilesEnrichment = { status: 'unavailable', error };
    }
  }

  return {
    rows: rows.map(guest => ({
      ...guest,
      added_by_name: isPresentUserId(guest.added_by)
        ? adderMap[guest.added_by] ?? 'A member'
        : 'A member',
    })),
    adderProfilesEnrichment,
  };
}

/**
 * Read event duties and optional assignee display context for exactly one
 * event. Duties are authoritative supporting records, so provider failures
 * propagate instead of being converted into an empty list.
 */
export async function fetchEventDuties(
  provider: EventSupportingReadsProvider,
  eventId: string,
): Promise<EventDutyRow[]> {
  return provider.listEventDuties(eventId);
}

/**
 * Placement-routed adaptation of the bundle's event supporting reads. The
 * caller must supply the owning club because backend placement is club-scoped;
 * this repository never infers a fallback backend from an event id.
 */
export function createHybridEventSupportingReadsRepository(
  registry: PlacementRegistry,
  providers: EventSupportingReadsProviders,
) {
  const clients = new Map<string, EventSupportingReadsProvider>();

  const providerFor = async (clubId: string): Promise<EventSupportingReadsProvider> => {
    const key = `club:${clubId}`;
    const existing = clients.get(key);
    if (existing) return existing;

    const provider = await withClubBackend(registry, providers, clubId, async value => value);
    clients.set(key, provider);
    return provider;
  };

  return {
    async fetchGuests(
      clubId: string,
      eventId: string,
      loadProfiles: EventGuestProfileLoader,
    ): Promise<EventGuestsFetchResult> {
      const provider = await providerFor(clubId);
      return fetchEventGuests(provider, eventId, loadProfiles);
    },

    async fetchDuties(clubId: string, eventId: string): Promise<EventDutyRow[]> {
      const provider = await providerFor(clubId);
      return fetchEventDuties(provider, eventId);
    },

    clearProviderCache() {
      clients.clear();
    },
  };
}
