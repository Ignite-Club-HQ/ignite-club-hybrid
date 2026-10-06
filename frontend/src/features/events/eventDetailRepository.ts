import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveEvents } from "@/live/features/events";

/** Core Event Detail read boundary. */
export const EVENT_DETAIL_SELECT =
  "*, teams (name, default_match_arrival_minutes, default_rsvp_audience), clubs!club_id (name, is_pro, sport)";

async function fetchEventDetailFromSupabase(client: any, eventId: string) {
  const { data, error } = await client
    .from("events")
    .select(EVENT_DETAIL_SELECT)
    .eq("id", eventId)
    .maybeSingle();

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
export async function fetchEventDetail(client: any, eventId: string) {
  return withFeatureBackend("events", {
    supabase: () => fetchEventDetailFromSupabase(client, eventId),
    icp: async (ctx) => {
      const events = await listLiveEvents(ctx);
      const raw = events.find((event) => event.id === eventId);
      return raw ? toEventDetailShape(raw) : null;
    },
  });
}

/**
 * Canister events arrive with ms timestamps and optional-array fields; the
 * detail page expects the Supabase row shape (event_date ISO, plain ids,
 * teams/clubs joins). Translate here so every consumer gets one shape.
 */
async function toEventDetailShape(e: any) {
  const opt = (v: unknown) => (Array.isArray(v) ? (v[0] ?? null) : (v ?? null));
  const teamId = opt(e.team_id) as string | null;
  const { icpGetTeam, icpGetClubName } = await import("@/lib/icpClubTeamLookup");
  const [team, clubName] = await Promise.all([
    teamId ? icpGetTeam(teamId).catch(() => null) : Promise.resolve(null),
    icpGetClubName(e.club_id).catch(() => null),
  ]);
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
