import type { QueryClient } from "@tanstack/react-query";
import { purgeEventsFromScheduleCache } from "@/lib/scheduleCache";


/**
 * Extra top-level query keys that hold event rows but are not named "event*".
 */
export const EXTRA_EVENT_QUERY_KEYS = [
  "upcoming-events",
  "next-up-pending-count",
  "user-rsvps-home",
  "rsvps",
  "duties",
  "my-duties",
] as const;

/** True when a query key's root refers to event-derived data. */
export function isEventRelatedQueryKey(key: readonly unknown[]): boolean {
  const root = key[0];
  if (typeof root !== "string") return false;
  if (root.includes("event")) return true;
  return (EXTRA_EVENT_QUERY_KEYS as readonly string[]).includes(root);
}

/**
 * Drop a deleted event from every cached list so it cannot repaint from stale
 * data, then force a refetch of every event-derived query (including inactive
 * ones — a backgrounded screen must not resurrect the row on resume).
 */
export async function purgeDeletedEventFromCaches(
  queryClient: QueryClient,
  deletedIds: string[],
): Promise<void> {
  const ids = new Set(deletedIds.filter(Boolean));

  // Persisted (localStorage) schedule cache first: the list view falls back to
  // it on offline/error and on the next cold open, so leaving it stale is what
  // makes a deleted event reappear in List but not Calendar.
  purgeEventsFromScheduleCache([...ids]);

  queryClient.getQueryCache().getAll().forEach((query) => {

    if (!isEventRelatedQueryKey(query.queryKey)) return;
    const data = query.state.data;
    if (Array.isArray(data)) {
      const next = data.filter(
        (row: any) =>
          !(row && typeof row === "object" && typeof row.id === "string" && ids.has(row.id)),
      );
      if (next.length !== data.length) {
        queryClient.setQueryData(query.queryKey, next);
      }
    } else if (data && typeof data === "object" && typeof (data as any).id === "string" && ids.has((data as any).id)) {
      queryClient.removeQueries({ queryKey: query.queryKey, exact: true });
    }
  });

  await queryClient.invalidateQueries({
    predicate: (query) => isEventRelatedQueryKey(query.queryKey),
    refetchType: "all",
  });
}
