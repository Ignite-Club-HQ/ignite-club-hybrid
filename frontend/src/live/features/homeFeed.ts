import { readContentInScope } from "../contentRouting";
import { assertReadNotAborted, withReadDeadline } from "../readDeadline";
import { memberLists } from "../featureScopes";
import type { FeatureBackendContext } from "../featureRouter";
import { getLiveClubProfile, getLiveTeam, listLivePersonalTeams } from "./club";
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
  teamNameById?: ReadonlyMap<string, string>,
): LiveHomeEvent {
  const teamId = event.team_id[0] ?? null;
  const teamName = teamId ? teamNameById?.get(teamId) ?? null : null;
  const opponent = event.opponent[0] ?? null;
  // Canister games often store an empty title (the Supabase branch auto-titles
  // "Team vs Opponent" at creation). Derive the same display title so the
  // Next Up card never renders a nameless game.
  const title =
    event.title.trim() ||
    (teamName && opponent
      ? `${teamName} vs ${opponent}`
      : (teamName ?? opponent ?? ""));
  return {
    id: event.id,
    title,
    type: event.event_type === "game" || event.event_type === "social" ? event.event_type : "training",
    event_date: new Date(Number(event.starts_at_ms)).toISOString(),
    start_time: null,
    address: event.address[0] ?? null,
    location_name: event.location[0] ?? null,
    suburb: null,
    club_id: event.club_id,
    team_id: teamId,
    mini_league_id: event.mini_league_id[0] ?? null,
    is_cancelled: event.cancelled,
    is_bye: false,
    is_recurring: false,
    parent_event_id: null,
    amount: null,
    opponent,
    arrival_minutes_before: null,
    teams: teamName ? { name: teamName, default_match_arrival_minutes: null } : null,
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
export type LiveHomeFeed = { memberships: LiveHomeMemberships; events: LiveHomeEvent[]; incomplete?: boolean };
export async function fetchLiveHomeFeed(
  ctx: FeatureBackendContext,
  options: { signal?: AbortSignal; onProgress?: (feed: LiveHomeFeed) => void } = {},
): Promise<LiveHomeFeed> {
  const { signal, onProgress } = options;
  assertReadNotAborted(signal);
  const read = <T,>(promise: Promise<T>, label: string) => withReadDeadline(promise, label, 20_000, signal);
  // Attach failure handling immediately: optional personal-team reads must not
  // hold club events hostage or produce an unhandled rejection while grants load.
  const personal = read(readContentInScope(ctx, "membership", { shared: "person" }, listLivePersonalTeams), "Personal teams")
    .then(value => ({ value, failed: false }), () => ({ value: [], failed: true }));
  const raw = deriveLiveMemberships(await read(getLiveMyRoleGrants(ctx), "Home memberships"));
  const { isHomeEventForMember, isStillUpcomingForNextUp } = await import("@/components/home/homeEventSelection");
  const { filterRecurringEvents } = await import("@/lib/filterRecurringEvents");
  const activeClubs = new Set<string>();
  const activeTeams = new Set<string>();
  const clubNames = new Map<string, string>();
  const teamNames = new Map<string, string>();
  const rows = new Map<string, LiveEvent>();
  let failures = 0;
  let successes = 0;
  const snapshot = (incomplete: boolean): LiveHomeFeed => {
    const memberships: LiveHomeMemberships = {
      teamIds: [...activeTeams], clubIds: raw.clubIds.filter(id => activeClubs.has(id)),
      clubAdminClubIds: raw.clubAdminClubIds.filter(id => activeClubs.has(id)),
      leagueAdminClubIds: raw.leagueAdminClubIds.filter(id => activeClubs.has(id)),
      miniLeagueIds: raw.miniLeagueIds,
      roles: raw.roles.filter(r => (!r.club_id || activeClubs.has(r.club_id)) && (!r.team_id || activeTeams.has(r.team_id))),
    };
    const events = [...rows.values()].map(e => mapLiveHomeEvent(e, clubNames, teamNames))
      .filter(e => isHomeEventForMember(e, { teamIds: memberships.teamIds, clubIds: memberships.clubIds, miniLeagueIds: null }))
      .filter(e => isStillUpcomingForNextUp(e, Date.now()))
      .sort((a,b) => Date.parse(a.event_date) - Date.parse(b.event_date)).slice(0, MERGED_EVENTS_CAP);
    return { memberships, events: filterRecurringEvents(events), incomplete };
  };
  const publish = () => { assertReadNotAborted(signal); onProgress?.(snapshot(true)); };
  const clubIds = [...new Set([...raw.clubIds, ...raw.clubAdminClubIds, ...raw.leagueAdminClubIds,
    ...raw.roles.map(r => r.club_id).filter((id): id is string => !!id)])];
  const tasks = clubIds.map(async clubId => {
    const teamIds = [...new Set(raw.roles.filter(r => r.club_id === clubId && r.team_id).map(r => r.team_id as string))];
    const eventRead = read(readContentInScope(ctx, "events", { clubId }, scoped => listLiveEvents(scoped, clubId, null)), "Home club events")
      .then(value => ({ value, error: null }), error => ({ value: [] as LiveEvent[], error }));
    const teamRead = Promise.all(teamIds.map(async teamId => {
      const [team] = await read(readContentInScope(ctx, "membership", { clubId }, scoped => getLiveTeam(scoped, teamId)), "Home team");
      return team && team.club_id === clubId && !team.deleted_at_ms.length ? team : null;
    })).catch(() => { failures++; return []; });
    const teamEvents = Promise.all(teamIds.map(teamId =>
      read(readContentInScope(ctx, "events", { clubId }, scoped => listLiveEvents(scoped, null, teamId)), "Home team events")
        .then(value => ({ value, failed: false }), () => ({ value: [] as LiveEvent[], failed: true }))));
    try {
      const [club] = await read(readContentInScope(ctx, "membership", { clubId }, scoped => getLiveClubProfile(scoped, clubId)), "Home club");
      if (!club || club.deleted_at_ms.length) return;
      activeClubs.add(clubId); clubNames.set(clubId, club.name);
      for (const team of await teamRead) {
        if (team) { activeTeams.add(team.id); teamNames.set(team.id, team.name); }
      }
      const result = await eventRead;
      if (result.error) failures++;
      else {
        for (const event of result.value) rows.set(event.id, event);
        successes++; publish();
      }
      for (const result of await teamEvents) {
        if (result.failed) { failures++; continue; }
        for (const event of result.value) rows.set(event.id, event);
        successes++;
      }
      publish();
    } catch (error) { assertReadNotAborted(signal); failures++; }
  });
  // Team-only grants still need their owning club verified, but do not wait
  // for unrelated clubs or the personal-team inventory.
  const covered = new Set(raw.roles.filter(r => r.club_id).map(r => r.team_id));
  tasks.push(...raw.teamIds.filter(id => !covered.has(id)).map(async teamId => {
    try {
      const [team] = await read(readContentInScope(ctx, "membership", { teamId }, scoped => getLiveTeam(scoped, teamId)), "Home team");
      if (!team || team.deleted_at_ms.length) return;
      const [club] = await read(readContentInScope(ctx, "membership", { clubId: team.club_id }, scoped => getLiveClubProfile(scoped, team.club_id)), "Home club");
      if (!club || club.deleted_at_ms.length) return;
      activeTeams.add(teamId); activeClubs.add(team.club_id); teamNames.set(teamId, team.name); clubNames.set(team.club_id, club.name);
      for (const event of await read(readContentInScope(ctx, "events", { teamId }, scoped => listLiveEvents(scoped, null, teamId)), "Home team events")) rows.set(event.id, event);
      successes++; publish();
    } catch { assertReadNotAborted(signal); failures++; }
  }));
  tasks.push((async () => {
    const result = await personal;
    assertReadNotAborted(signal);
    if (result.failed) { failures++; return; }
    await Promise.all(result.value.filter(team => !team.deleted_at_ms?.length).map(async team => {
      try {
        activeTeams.add(team.id); teamNames.set(team.id, team.name);
        for (const event of await read(readContentInScope(ctx, "events", { teamId: team.id }, scoped => listLiveEvents(scoped, null, team.id)), "Personal team events")) rows.set(event.id, event);
        successes++; publish();
      } catch { assertReadNotAborted(signal); failures++; }
    }));
  })());
  await Promise.all(tasks);
  assertReadNotAborted(signal);
  if (failures && successes === 0) throw new Error("Home events could not be read; please try again.");
  return snapshot(failures > 0);
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
  const rsvps = await readContentInScope(ctx, "events", memberLists, listLiveMyRsvps);
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
