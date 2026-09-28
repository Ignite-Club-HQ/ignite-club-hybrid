import type { Principal } from '@icp-sdk/core/principal';
import { withClubBackend } from './backendRouter';
import type { PlacementRegistry } from './hybridClubLinksService';

/**
 * One row of the event-scoped attendance roster: either a `"child"` or an
 * `"adult"` (guardian/parent) linked to that child, both restricted to the
 * exact event's target teams.
 */
export type ScopedAttendanceRosterRow = {
  kind: string;
  person_id: string;
  display_name: string | null;
  parent_id: string | null;
  team_ids: string[] | null;
};

export type VisibleChildRow = {
  id: string;
  name?: string | null;
  parent_id?: string | null;
  [key: string]: unknown;
};

export type ChildParentLink = {
  id?: string;
  parent_id?: string | null;
};

export type GuardianLink = {
  child_id?: string;
  guardian_id?: string | null;
};

export type RoleTeamPair = { role: string; team_id: string | null };

export type TargetedReminderMember = {
  id: string;
  role_team_pairs?: RoleTeamPair[] | null;
  [key: string]: unknown;
};

export interface TargetedAttendanceProvider {
  listTargetedAttendanceRoster(eventId: string): Promise<ScopedAttendanceRosterRow[]>;
}

export type TargetedAttendanceProviders = {
  icp: (canister: Principal) => Promise<TargetedAttendanceProvider>;
  supabase: (environment: string) => Promise<TargetedAttendanceProvider>;
};

/**
 * Read the event-scoped attendance roster for exactly one event. This roster
 * exists because event managers (club admin / committee / target-team admin)
 * cannot read other members' `children` rows directly under RLS; the bundle's
 * source used a narrowly scoped SECURITY DEFINER RPC to return the minimum
 * roster for that one event. The read is authoritative and fails closed: a
 * denied or failed lookup must never be silently swallowed into an empty
 * roster.
 */
export async function fetchTargetedAttendanceRoster(
  provider: TargetedAttendanceProvider,
  eventId: string,
): Promise<ScopedAttendanceRosterRow[]> {
  return provider.listTargetedAttendanceRoster(eventId);
}

/** Keeps only the `"child"` rows from a mixed scoped roster. */
export function selectScopedChildRoster(
  rows: readonly ScopedAttendanceRosterRow[] | null | undefined,
): ScopedAttendanceRosterRow[] {
  return (rows ?? []).filter(row => row.kind === 'child');
}

/**
 * Merges RLS-visible children with the event-scoped roster's child rows,
 * de-duplicating by person id and never mutating the visible input. An
 * existing visible child's name always wins over the scoped fallback name.
 */
export function mergeTargetedChildren(
  visibleChildren: readonly VisibleChildRow[] | null | undefined,
  scopedChildren: readonly ScopedAttendanceRosterRow[] | null | undefined,
): VisibleChildRow[] {
  const byId = new Map<string, VisibleChildRow>();
  for (const child of visibleChildren ?? []) byId.set(child.id, { ...child });
  for (const row of selectScopedChildRoster(scopedChildren)) {
    const existing = byId.get(row.person_id);
    if (existing) {
      if (!existing.name && row.display_name) {
        byId.set(row.person_id, { ...existing, name: row.display_name });
      }
    } else {
      byId.set(row.person_id, {
        id: row.person_id,
        name: row.display_name,
        parent_id: row.parent_id,
      });
    }
  }
  return [...byId.values()];
}

/**
 * Selects the adults who should receive a targeted reminder: members whose
 * role/team pairs intersect the event's target teams, plus any parent or
 * guardian linked to a child already in the composed roster. Each matching
 * adult appears at most once.
 */
export function selectTargetedReminderMembers(
  members: readonly TargetedReminderMember[] | null | undefined,
  targetTeamIds: readonly string[],
  children: readonly ChildParentLink[] | null | undefined,
  guardianLinks: readonly GuardianLink[] | null | undefined,
): TargetedReminderMember[] {
  const targetSet = new Set(targetTeamIds);
  const linkedAdultIds = new Set<string>();
  for (const child of children ?? []) if (child.parent_id) linkedAdultIds.add(child.parent_id);
  for (const link of guardianLinks ?? []) if (link.guardian_id) linkedAdultIds.add(link.guardian_id);

  return (members ?? []).filter(member => {
    const pairs = member.role_team_pairs ?? [];
    if (pairs.some(pair => pair.team_id && targetSet.has(pair.team_id))) return true;
    return linkedAdultIds.has(member.id);
  });
}

/**
 * Placement-routed adaptation of the bundle's `targetedAttendanceRepository`.
 * The source called this RPC with a raw Supabase client and only an event id;
 * because hybrid placement is authoritative per club rather than per event,
 * the caller must supply the event's owning `clubId` explicitly. The
 * repository resolves that club's backend, caches one provider per backend
 * identity, and never falls back to Supabase when an ICP placement or
 * provider is unavailable.
 */
export function createHybridTargetedAttendanceRepository(
  registry: PlacementRegistry,
  providers: TargetedAttendanceProviders,
) {
  const clients = new Map<string, TargetedAttendanceProvider>();

  const providerFor = async (clubId: string): Promise<TargetedAttendanceProvider> => {
    const key = `club:${clubId}`;
    const existing = clients.get(key);
    if (existing) return existing;

    const provider = await withClubBackend(registry, providers, clubId, async value => value);
    clients.set(key, provider);
    return provider;
  };

  return {
    async fetchRoster(clubId: string, eventId: string): Promise<ScopedAttendanceRosterRow[]> {
      const provider = await providerFor(clubId);
      return fetchTargetedAttendanceRoster(provider, eventId);
    },

    clearProviderCache() {
      clients.clear();
    },
  };
}
