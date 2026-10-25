import { withFeatureBackend } from "@/live/featureRouter";
import { getListedLiveEvent, listLiveEvents } from "@/live/features/events";
import { getCachedTeam, getCachedClub } from "@/lib/clubTeamCache";
import { getLiveTeam, getLiveClubProfile } from "@/live/features/club";
import { assertReadNotAborted, withReadDeadline } from "@/live/readDeadline";

/** Core Event Detail read boundary. */
export const EVENT_DETAIL_SELECT =
  "*, teams (name, default_match_arrival_minutes, default_rsvp_audience), clubs!club_id (name, is_pro, sport)";

async function fetchEventDetailFromSupabase(client: any, eventId: string, signal?: AbortSignal) {
  let query = client
    .from("events")
    .select(EVENT_DETAIL_SELECT)
    .eq("id", eventId);
  if (signal) query = query.abortSignal(signal);
  const { data, error } = await query.maybeSingle();

  if (error) throw error;
  return data ?? null;
}

/**
 * Returns the event row, or `null` when it does not exist/is not visible.
 * Transport, authorization and database failures are propagated unchanged so
 * the page can distinguish them from a legitimate not-found result.
 *
 * Hybrid routing: when placement settings route the events feature to ICP
 * (and an events_domain canister ID is configured), the read is served by the
 * canister instead. NOTE: the canister event shape differs from the Supabase
 * row (no teams/clubs joins, ms epoch timestamps, Principal creator) — the
 * mapping is provisional until verified against a deployed canister.
 */
export async function fetchEventDetail(client: any, eventId: string, signal?: AbortSignal) {
  assertReadNotAborted(signal);
  return withReadDeadline(withFeatureBackend("events", {
    supabase: () => fetchEventDetailFromSupabase(client, eventId, signal),
    icp: async (ctx) => {
      assertReadNotAborted(signal);
      // Read only the event's own club when it is already known from a list.
      const known = getListedLiveEvent(eventId);
      const events = known?.club_id ? await listLiveEvents(ctx, known.club_id) : await listLiveEvents(ctx);
      assertReadNotAborted(signal);
      const raw = events.find((event) => event.id === eventId);
      return raw ? toEventDetailShape(raw, signal) : null;
    },
  }, getListedLiveEvent(eventId)?.club_id ? { clubId: getListedLiveEvent(eventId)!.club_id } : { eventId }), 'Event loading', 20_000, signal);
}

/**
 * Instant first paint for an event already listed this session: the same
 * shape as the detail read, using only labels already cached on the device.
 * The detail read still runs and replaces it.
 */
export function listedEventDetailPreview(eventId: string) {
  const e = getListedLiveEvent(eventId);
  if (!e) return undefined;
  const opt = (v: unknown) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const teamId = opt(e.team_id) as string | null;
  const team = teamId ? getCachedTeam(teamId) : null;
  return shapeEvent(e, team?.club_id === e.club_id ? team : null, getCachedClub(e.club_id)?.name ?? null);
}

/**
 * Canister events arrive with ms timestamps and optional-array fields; the
 * detail page expects the Supabase row shape (event_date ISO, plain ids,
 * teams/clubs joins). Translate here so every consumer gets one shape.
 */
async function toEventDetailShape(e: any, signal?: AbortSignal) {
  const opt = (v: unknown) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const teamId = opt(e.team_id) as string | null;
  const cachedTeam = teamId ? getCachedTeam(teamId) : null;
  const cachedClub = getCachedClub(e.club_id);
  const [team, clubName] = await Promise.all([
    cachedTeam?.club_id === e.club_id ? Promise.resolve(cachedTeam) : teamId ? withReadDeadline(withFeatureBackend("membership", {
      supabase: async () => null,
      icp: async ctx => {
        return (await getLiveTeam(ctx, teamId))[0] ?? null;
      },
    }, { clubId: e.club_id }), 'Event team label', 1500, signal).catch(() => null) : Promise.resolve(null),
    cachedClub ? Promise.resolve(cachedClub.name) : withReadDeadline(withFeatureBackend("membership", {
      supabase: async () => null,
      icp: async ctx => {
        return (await getLiveClubProfile(ctx, e.club_id))[0]?.name ?? null;
      },
    }, { clubId: e.club_id }), 'Event club label', 1500, signal).catch(() => null),
  ]);
  assertReadNotAborted(signal);
  return shapeEvent(e, team, clubName);
}

function shapeEvent(e: any, team: { name: string } | null, clubName: string | null) {
  const opt = (v: unknown) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const teamId = opt(e.team_id) as string | null;
  const type = ["game", "training", "social", "mini_league"].includes(e.event_type) ? e.event_type : "training";
  return {
    id: e.id,
    title: e.title,
    description: e.description || null,
    type,
    event_date: new Date(Number(e.starts_at_ms)).toISOString(),
    end_time: Number(e.ends_at_ms) ? new Date(Number(e.ends_at_ms)).toISOString() : null,
    start_time: null,
    address: opt(e.address),
    location_name: opt(e.location),
    suburb: null,
    state: null,
    postcode: null,
    club_id: e.club_id,
    team_id: teamId,
    mini_league_id: opt(e.mini_league_id),
    opponent: opt(e.opponent),
    is_cancelled: !!e.cancelled,
    is_recurring: !!opt(e.series_id),
    parent_event_id: null,
    series_id: opt(e.series_id),
    teams: team ? { name: team.name, default_match_arrival_minutes: null, default_rsvp_audience: null } : null,
    clubs: { name: clubName ?? "", is_pro: null, sport: null },
  };
}
