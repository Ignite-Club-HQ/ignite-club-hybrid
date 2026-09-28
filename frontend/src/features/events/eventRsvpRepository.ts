export type EventRsvpProfile = {
  id: string;
  display_name: string | null;
  avatar_url: string | null;
};

export type EventRsvpProfileLoader = (
  userIds: string[],
) => Promise<{ data: EventRsvpProfile[] | null; error?: unknown }>;

/**
 * Read the authoritative RSVP rows for one event, then enrich display-only
 * profile and child information. The RSVP read fails closed; enrichment stays
 * best effort so valid attendance never disappears because an avatar/name
 * lookup is temporarily unavailable.
 */
export async function fetchEventRsvps(
  client: any,
  eventId: string,
  loadProfiles: EventRsvpProfileLoader,
) {
  const { data: rsvpData, error: rsvpError } = await client
    .from("rsvps")
    .select("*, mini_league_players (id, name, child_id)")
    .eq("event_id", eventId);
  if (rsvpError) throw rsvpError;

  const rows = rsvpData ?? [];
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
