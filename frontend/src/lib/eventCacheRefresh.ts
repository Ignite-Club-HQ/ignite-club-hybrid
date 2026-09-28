// Single place that refreshes every event-derived cache after a mutation
// (create / edit / cancel / delete).
//
// Why this exists: invalidating only the query the mutating page happened to
// read left the other surfaces stale — a newly created event was missing from
// the home "Next Up" carousel and from the Schedule list until staleTime
// expired, and on a cold open the persisted localStorage snapshots
// (`ignite_events_list_*`, `ignite_next_up_events_*`) repainted the pre-
// mutation list before any network call ran.

import type { QueryClient } from "@tanstack/react-query";
import { clearCachedEventsLists } from "./scheduleCache";
import { clearCachedNextUp } from "./nextUpEventsCache";

export function refreshEventCaches(
  queryClient: QueryClient,
  userId: string | undefined | null,
): void {
  // React Query (in-memory)
  queryClient.invalidateQueries({ queryKey: ["events"] });
  queryClient.invalidateQueries({ queryKey: ["upcoming-events"] });
  queryClient.invalidateQueries({ queryKey: ["team-next-event"] });
  if (userId) {
    queryClient.invalidateQueries({ queryKey: ["user-memberships-and-events", userId] });
  }

  // Persisted snapshots (localStorage) — must be cleared too, otherwise the
  // next cold open hydrates from pre-mutation data.
  clearCachedEventsLists(userId ?? null);
  clearCachedNextUp(userId ?? undefined);
}
