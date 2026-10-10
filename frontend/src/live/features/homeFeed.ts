import type { FeatureBackendContext } from "../featureRouter";
import { getLiveClubProfile, getLiveTeam } from "./club";
import { listLiveEvents, listLiveMyRsvps } from "./events";
import { getLiveMyRoleGrants, listLiveChildren } from "./membership";
import { resolveLivePiiTextBatch } from "./vault";

/**
 * Home feed -> club_domain (role grants, club names, children) and
 * events_domain (events + RSVPs). Routed to only when placement settings
 * resolve ICP for the "home"/"membership" feature areas (see
 * featureBackend.ts); until then HomePage stays on its Supabase queries.
 *
 * Role grants MUST come from club_domain `my_role_grants`: that is the live
 * role store every membership write targets (create_club grants the creator
 * club_admin there, invite acceptance and add_role_grant likewise).
 * identity_access `my_roles` is governor-managed only and never receives
 * club-creation grants — reading it here hid newly created clubs from Home.
 *
 * PROVISIONAL until verified against deployed canisters:
 * - event type/location/cancellation now come from the canister Event
 *   record; a "mini_league" type maps to "social" because HomePage's Event
 *   union only covers game/training/social and mini-leagues stay Supabase-only;
 * - recurrences are not exposed by list_events, so is_recurring maps to
 *   false and the recurring-series cap is a no-op on this branch;
 * - account ids are matched against principal text until account ids are
 *   bound to principals post-deploy;
 * - soft-deleted clubs/teams are filtered out of memberships before use:
 *   the canister keeps role grants across the tombstone, so without the
 *   filter a deleted club still grants admin powers (ghost Club Files card,
 *   ghost news) — mirrors the Supabase branch's clubs.deleted_at filter.
 */

/** Minimal shape of an identity_access role grant used here. */
export interface LiveRoleGrantLike {
  role: string;
  club: [] | [string];
  team: [] | [string];
}

export interface LiveHomeMemberships {
  teamIds: string[];
  clubIds: string[];
  clubAdminClubIds: string[];
  leagueAdminClubIds: string[];
  miniLeagueIds: string[];
  roles: { role: string; club_id: string | null; team_id: string | null }[];
}

/** Pure: identity_access role grants -> the memberships shape HomePage consumes. */
export function deriveLiveMemberships(grants: LiveRoleGrantLike[]): LiveHomeMemberships {
  const teamIds = new Set<string>();
  const clubIds = new Set<string>();
  const clubAdminClubIds = new Set<string>();
  const leagueAdminClubIds = new Set<string>();
  const roles: LiveHomeMemberships["roles"] = [];

  for (const grant of grants) {
    const clubId = grant.club[0] ?? null;
    const teamId = grant.team[0] ?? null;
    if (teamId) teamIds.add(teamId);
    if (clubId) {
      clubIds.add(clubId);
      if (grant.role === "club_admin" || grant.role === "app_admin") {
        clubAdminClubIds.add(clubId);
      }
      if (grant.role === "league_admin") {
        leagueAdminClubIds.add(clubId);
      }
    }
    roles.push({ role: grant.role, club_id: clubId, team_id: teamId });
  }

  return {
    teamIds: [...teamIds],
    clubIds: [...clubIds],
    clubAdminClubIds: [...clubAdminClubIds],
    leagueAdminClubIds: [...leagueAdminClubIds],
    // Mini-leagues are Supabase-only by design (cutover plan Stage C).
    miniLeagueIds: [],
    roles,
  };
}

type LiveEvent = Awaited<ReturnType<typeof listLiveEvents>>[number];

/** Shape mirrors the `Event` interface in pages/HomePage.tsx. */
export interface LiveHomeEvent {
  id: string;
  title: string;
  type: "game" | "training" | "social";
  event_date: string;
  start_time: string | null;
  address: string | null;
  location_name: string | null;
  suburb: string | null;
  club_id: string;
  team_id: string | null;
  mini_league_id: string | null;
  is_cancelled: boolean;
  is_bye: boolean;
  is_recurring: boolean;
  parent_event_id: string | null;
  amount: number | null;
  opponent: string | null;
  arrival_minutes_before: number | null;
  teams: { name: string; default_match_arrival_minutes: number | null } | null;
  clubs: { name: string; sport: string | null };
}

/** Pure: canister event -> HomePage Event shape (see PROVISIONAL notes above). */
export function mapLiveHomeEvent(
  event: LiveEvent,
  clubNameById: ReadonlyMap<string, string>,
): LiveHomeEvent {
  return {
    id: event.id,
    title: event.title,
    type: event.event_type === "game" || event.event_type === "social" ? event.event_type : "training",
    event_date: new Date(Number(event.starts_at_ms)).toISOString(),
    start_time: null,
    address: event.address[0] ?? null,
    location_name: event.location[0] ?? null,
    suburb: null,
    club_id: event.club_id,
    team_id: event.team_id[0] ?? null,
    mini_league_id: event.mini_league_id[0] ?? null,
    is_cancelled: event.cancelled,
    is_bye: false,
    is_recurring: false,
    parent_event_id: null,
    amount: null,
    opponent: event.opponent[0] ?? null,
    arrival_minutes_before: null,
    teams: null,
    clubs: { name: clubNameById.get(event.club_id) ?? "", sport: null },
  };
}

// Overall bound on the merged Next Up payload, matching the Supabase branch.
const MERGED_EVENTS_CAP = 100;

/**
 * Consolidated home feed: role grants from identity_access, per-club/team
 * event fan-out against events_domain (mirrors the Supabase branch's
 * per-scope fan-out so busy clubs cannot starve quiet ones), club names from
 * club_domain. Throws on any canister failure so React Query keeps the last
 * good snapshot instead of caching an empty feed — same contract as the
 * Supabase branch's resume-race guards.
 */
export async function fetchLiveHomeFeed(
  ctx: FeatureBackendContext,
): Promise<{ memberships: LiveHomeMemberships; events: LiveHomeEvent[] }> {
  const raw = deriveLiveMemberships(await getLiveMyRoleGrants(ctx));

  // Drop soft-deleted clubs/teams. Grants survive the tombstone (mirroring
  // Supabase's orphan user_roles rows), so cross-check every club/team
  // against its canister record's deleted_at_ms before trusting the grant —
  // same protection as the Supabase branch's active-clubs filter. Failures
  // throw so React Query keeps the last good snapshot.
  const candidateClubIds = [...new Set([
    ...raw.clubIds,
    ...raw.clubAdminClubIds,
    ...raw.leagueAdminClubIds,
    ...raw.roles.map((r) => r.club_id).filter((id): id is string => !!id),
  ])];
  const activeClubIds = new Set<string>();
  await Promise.all(
    candidateClubIds.map(async (clubId) => {
      const profile = await getLiveClubProfile(ctx, clubId);
      const club = profile[0];
      if (club && club.deleted_at_ms.length === 0) activeClubIds.add(clubId);
    }),
  );
  const activeTeamIds = new Set<string>();
  await Promise.all(
    raw.teamIds.map(async (teamId) => {
      const teamOpt = (await getLiveTeam(ctx, teamId)) as unknown as Array<{
        club_id: string;
        deleted_at_ms: [] | [bigint];
      }>;
      const team = teamOpt[0];
      if (team && team.deleted_at_ms.length === 0 && activeClubIds.has(team.club_id)) {
        activeTeamIds.add(teamId);
      }
    }),
  );
  const memberships: LiveHomeMemberships = {
    teamIds: raw.teamIds.filter((id) => activeTeamIds.has(id)),
    clubIds: raw.clubIds.filter((id) => activeClubIds.has(id)),
    clubAdminClubIds: raw.clubAdminClubIds.filter((id) => activeClubIds.has(id)),
    leagueAdminClubIds: raw.leagueAdminClubIds.filter((id) => activeClubIds.has(id)),
    miniLeagueIds: raw.miniLeagueIds,
    roles: raw.roles.filter(
      (r) =>
        (!r.club_id || activeClubIds.has(r.club_id)) &&
        (!r.team_id || activeTeamIds.has(r.team_id)),
    ),
  };

  const eventResults = await Promise.all([
    ...memberships.clubIds.map((clubId) => listLiveEvents(ctx, clubId, null)),
    ...memberships.teamIds.map((teamId) => listLiveEvents(ctx, null, teamId)),
  ]);

  const mergedById = new Map<string, LiveEvent>();
  for (const events of eventResults) {
    for (const event of events) mergedById.set(event.id, event);
  }
  const merged = [...mergedById.values()]
    .sort((a, b) => Number(a.starts_at_ms) - Number(b.starts_at_ms))
    .slice(0, MERGED_EVENTS_CAP);

  // Club names for the carousel cards. Best effort per club: a missing
  // profile falls back to an empty name rather than failing the whole feed.
  const clubNameById = new Map<string, string>();
  await Promise.all(
    [...new Set(merged.map((event) => event.club_id))].map(async (clubId) => {
      try {
        const profile = await getLiveClubProfile(ctx, clubId);
        const name = profile[0]?.name;
        if (name) clubNameById.set(clubId, name);
      } catch {
        // Best effort — see comment above.
      }
    }),
  );

  // Only events this user is actually part of: club-level roles (club admin,
  // competition admin) must not surface other teams' games. listLiveEvents by
  // club returns every team's events, so filter like the Supabase branch.
  const { isHomeEventForMember } = await import("@/components/home/homeEventSelection");
  let events = merged
    .map((event) => mapLiveHomeEvent(event, clubNameById))
    .filter((event) =>
      isHomeEventForMember(event, {
        teamIds: memberships.teamIds,
        clubIds: memberships.clubIds,
        miniLeagueIds: null,
      }),
    );

  // Same client-side freshness/recurring handling as the Supabase branch.
  // Imported lazily so the live layer keeps no static dependency on the
  // components layer.
  const { isStillUpcomingForNextUp } = await import("@/components/home/homeEventSelection");
  const { filterRecurringEvents } = await import("@/lib/filterRecurringEvents");
  events = events.filter((event) => isStillUpcomingForNextUp(event, Date.now()));
  events = filterRecurringEvents(events);

  return { memberships, events };
}

/**
 * The caller's own RSVPs for the visible home events, from the events_domain
 * `my_rsvps` query. Returns the {event_id, status} rows HomePage renders.
 */
export async function fetchLiveHomeRsvps(
  ctx: FeatureBackendContext,
  eventIds: string[],
): Promise<{ event_id: string; status: string }[]> {
  if (eventIds.length === 0) return [];
  const visible = new Set(eventIds);
  const rsvps = await listLiveMyRsvps(ctx);
  return rsvps
    .filter((rsvp) => visible.has(rsvp.event_id))
    .map((rsvp) => ({ event_id: rsvp.event_id, status: rsvp.state }));
}

/**
 * The caller's children from club_domain, with display names decrypted
 * through pii_access_control. PII records are keyed pii_id = child id,
 * field_id = "name"; the caller must be the record's domain_owner (the
 * registering parent/guardian) or a granted reader. Unreadable or
 * unregistered names fall back to null. ignite_points is Supabase-only and
 * maps to 0. PROVISIONAL: verify the pii_id/field_id convention against the
 * deployed canisters post-deploy.
 */
export async function fetchLiveHomeChildren(
  ctx: FeatureBackendContext,
): Promise<{ id: string; name: string | null; ignite_points: number }[]> {
  const children = await listLiveChildren(ctx);
  const nameByChildId = new Map<string, string>();
  try {
    const decrypted = await resolveLivePiiTextBatch(
      ctx,
      children.map((child) => child.id),
      "name",
      "home_feed",
      "Display child names on the home feed",
    );
    for (const [childId, name] of decrypted) {
      const trimmed = name.trim();
      if (trimmed) nameByChildId.set(childId, trimmed);
    }
  } catch {
    // Best effort: a PII read failure must not blank the home children list.
  }
  return children.map((child) => ({
    id: child.id,
    name: nameByChildId.get(child.id) ?? null,
    ignite_points: 0,
  }));
}
