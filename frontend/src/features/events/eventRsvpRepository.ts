import { withFeatureBackend } from "@/live/featureRouter";
import { getLiveEventsSnapshot } from "@/live/features/events";

export type EventRsvpProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type EventRsvpProfileLoader = (
  userIds: string[],
) => Promise<{ data: EventRsvpProfile[] | null; error?: unknown }>;

/**
 * Enrich authoritative RSVP rows with display-only profile and child
 * information. Enrichment stays best effort so valid attendance never
 * disappears because an avatar/name lookup is temporarily unavailable.
 */
async function enrichRsvpRows(
  client: any,
  rows: any[],
  loadProfiles: EventRsvpProfileLoader,
) {
  const userIds = rows.filter((row: any) => row.user_id).map((row: any) => row.user_id);
  const childIds = rows.filter((row: any) => row.child_id).map((row: any) => row.child_id);

  let profilesMap: Record<string, Omit<EventRsvpProfile, "id">> = {};
  let childrenMap: Record<string, { id: string; name: string }> = {};

  if (userIds.length > 0) {
    const { data: profiles } = await loadProfiles(userIds);
    if (profiles) {
      profilesMap = Object.fromEntries(
        profiles.map((profile) => [
          profile.id,
          { display_name: profile.display_name, avatar_url: profile.avatar_url },
        ]),
      );
    }
  }

  if (childIds.length > 0) {
    const { data: children } = await client
      .from("children")
      .select("id, name")
      .in("id", childIds);
    if (children) {
      childrenMap = Object.fromEntries(
        children.map((child: any) => [child.id, { id: child.id, name: child.name }]),
      );
    }
  }

  return rows.map((row: any) => ({
    ...row,
    profiles: row.user_id ? profilesMap[row.user_id] || null : null,
    children: row.child_id ? childrenMap[row.child_id] || null : null,
  }));
}

/**
 * Read the authoritative RSVP rows for one event, then enrich display-only
 * profile and child information. The RSVP read fails closed.
 *
 * Hybrid routing: when the events feature is routed to ICP, authoritative
 * rows come from the events_domain snapshot (account_id -> user_id,
 * state -> status). Profile/child enrichment still reads Supabase, so
 * canister account ids that are not Supabase profile ids simply enrich to
 * null. Provisional until verified against a deployed canister.
 */
export async function fetchEventRsvps(
  client: any,
  eventId: string,
  loadProfiles: EventRsvpProfileLoader,
) {
  return withFeatureBackend("events", {
    supabase: async () => {
      const { data: rsvpData, error: rsvpError } = await client
        .from("rsvps")
        .select("*, mini_league_players (id, name, child_id)")
        .eq("event_id", eventId);
      if (rsvpError) throw rsvpError;
      return enrichRsvpRows(client, rsvpData ?? [], loadProfiles);
    },
    icp: async (ctx) => {
      const snapshot = await getLiveEventsSnapshot(ctx);
      const rows = snapshot.rsvps
        .filter((rsvp) => rsvp.event_id === eventId)
        .map((rsvp) => ({
          id: `${rsvp.event_id}:${rsvp.account_id}`,
          event_id: rsvp.event_id,
          user_id: rsvp.account_id,
          child_id: null,
          status: rsvp.state,
          mini_league_players: null,
          updated_at: new Date(Number(rsvp.updated_at_ms)).toISOString(),
        }));
      return enrichRsvpRows(client, rows, loadProfiles);
    },
  });
}
