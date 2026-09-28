import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Fetch the set of attendee IDs who RSVP'd "going" to a given event.
 *
 * Returned IDs are matched against the `user_id` field on PitchBoard members:
 *   - Adult RSVPs       → `rsvps.user_id` where `child_id is null`
 *   - Child/player RSVPs → `rsvps.child_id`
 *
 * Both shapes are merged into a single Set<string> so callers can do a
 * straight `.has(member.user_id)` lookup regardless of whether the member is
 * an adult or a child profile.
 *
 * Returns `null` (not an empty Set) when there is no event to query so callers
 * can distinguish "no filtering needed" from "filtering applied, nobody going".
 */
export function useEventGoingAttendees(eventId: string | null | undefined) {
  return useQuery({
    queryKey: ["event-going-attendees", eventId],
    queryFn: async (): Promise<Set<string>> => {
      const { data, error } = await supabase
        .from("rsvps")
        .select("user_id, child_id, status")
        .eq("event_id", eventId!)
        .eq("status", "going");

      if (error) throw error;

      const ids = new Set<string>();
      for (const r of data ?? []) {
        if (r.child_id) ids.add(r.child_id);
        else if (r.user_id) ids.add(r.user_id);
      }
      return ids;
    },
    enabled: !!eventId,
    staleTime: 30 * 1000, // RSVPs change during a session — keep this short
  });
}
