import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveHomeSnapshot } from "@/live/features/home";

export interface HomeUserRsvp {
  event_id: string;
  status: string;
}

/**
 * Read the signed-in adult's RSVP status for events currently visible on Home.
 * Child RSVP rows are deliberately excluded because Home's compact action
 * represents the signed-in user; child responses are managed in the RSVP flow.
 *
 * Hybrid routing: when the home feature is routed to ICP, RSVP rows come from
 * the events_domain snapshot (account_id -> user_id, state -> status). In ICP
 * auth mode the signed-in user id IS the Internet Identity principal text.
 * Provisional until verified against a deployed canister.
 */
export async function fetchHomeUserRsvps(
  client: any,
  userId: string,
  eventIds: readonly string[],
): Promise<HomeUserRsvp[]> {
  if (eventIds.length === 0) return [];

  return withFeatureBackend("home", {
    supabase: async () => {
      const { data, error } = await client
        .from("rsvps")
        .select("event_id, status")
        .eq("user_id", userId)
        .is("child_id", null)
        .in("event_id", [...eventIds]);

      if (error) throw error;
      return data ?? [];
    },
    icp: async (ctx) => {
      const snapshot = await getLiveHomeSnapshot(ctx);
      const wanted = new Set(eventIds);
      return snapshot.rsvps
        .filter((rsvp) => rsvp.account_id === userId && wanted.has(rsvp.event_id))
        .map((rsvp) => ({ event_id: rsvp.event_id, status: rsvp.state }));
    },
  });
}
