import type { EventRsvpProfileLoader } from "@/features/events/eventRsvpRepository";

/** Read event guests and enrich only the display name of the adding member. */
export async function fetchEventGuests(
  client: any,
  eventId: string,
  loadProfiles: EventRsvpProfileLoader,
) {
  const { data, error } = await client
    .from("event_guests")
    .select("*")
    .eq("event_id", eventId);
  if (error) throw error;

  const rows = data ?? [];
  const adderIds = [...new Set<string>(rows.map((guest: any) => guest.added_by).filter(Boolean))];
  let adderMap: Record<string, string> = {};
  if (adderIds.length > 0) {
    const { data: profiles } = await loadProfiles(adderIds);
    if (profiles) {
      adderMap = Object.fromEntries(
        profiles.map((profile) => [profile.id, profile.display_name || "A member"]),
      );
    }
  }

  return rows.map((guest: any) => ({
    ...guest,
    added_by_name: adderMap[guest.added_by] || "A member",
  }));
}

/** Read duties for exactly one event with optional assignee display context. */
export async function fetchEventDuties(client: any, eventId: string) {
  const { data, error } = await client
    .from("duties")
    .select("*, profiles:assigned_to (display_name, avatar_url)")
    .eq("event_id", eventId);
  if (error) throw error;
  return data ?? [];
}
