// Single place that refreshes every event-derived cache after a mutation
// (create / edit / cancel / delete).
//
// Why this exists: invalidating only the query the mutating page happened to
// read left the other surfaces stale — a newly created event was missing from
// the home "Next Up" carousel and from the Schedule list until staleTime
// expired, and on a cold open the persisted localStorage snapshots
// (`ignite_events_list_*`, `ignite_next_up_events_*`) repainted the pre-
// mutation list before any network call ran.
//
// Adapted from the bundle's refactored `eventCacheRefresh`: the source
// baseline invalidated hand-written literal query-key arrays duplicated
// across the create/edit/detail event pages, where a typo in one array
// silently broke that surface's cache. The refactor replaced every literal
// key with the canonical `eventKeys` factory so every caller invalidates the
// same cache identities. This orchestrator has no provider or Supabase/ICP
// edge — it only coordinates React Query and local snapshot invalidation.
import type { QueryClient } from '@tanstack/react-query';
import { clearCachedEventsLists } from './scheduleCache';
import { clearCachedNextUp } from './nextUpEventsCache';
import { eventKeys } from './eventQueryKeys';

export function refreshEventCaches(
  queryClient: QueryClient,
  userId: string | undefined | null,
): void {
  // React Query (in-memory)
  queryClient.invalidateQueries({ queryKey: eventKeys.lists() });
  queryClient.invalidateQueries({ queryKey: eventKeys.upcoming() });
  queryClient.invalidateQueries({ queryKey: eventKeys.teamNext() });
  if (userId) {
    queryClient.invalidateQueries({ queryKey: eventKeys.home(userId) });
  }

  // Persisted snapshots (localStorage) — must be cleared too, otherwise the
  // next cold open hydrates from pre-mutation data.
  clearCachedEventsLists(userId ?? null);
  clearCachedNextUp(userId ?? undefined);
}
