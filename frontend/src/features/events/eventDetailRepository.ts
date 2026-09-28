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
      return events.find((event) => event.id === eventId) ?? null;
    },
  });
}
