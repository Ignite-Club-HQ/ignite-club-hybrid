import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { subscribeToScheduleBroadcasts } from "@/lib/scheduleBroadcast";

/**
 * Listens for server-side schedule refresh broadcasts for the given clubs and
 * invalidates the relevant React Query caches so the schedule view re-fetches
 * automatically. Also clears the local schedule cache so stale data doesn't
 * paint on next mount.
 */
export function useScheduleBroadcastListener(clubIds: string[] | undefined) {
  const queryClient = useQueryClient();

  // Stable key so effect doesn't re-subscribe on every render
  const key = (clubIds ?? []).slice().sort().join(",");

  useEffect(() => {
    if (!key) return;
    const ids = key.split(",").filter(Boolean);
    if (ids.length === 0) return;

    const unsub = subscribeToScheduleBroadcasts(ids, () => {
      queryClient.invalidateQueries({ queryKey: ["events"] });
      queryClient.invalidateQueries({ queryKey: ["user-memberships-for-events"] });
    });

    return unsub;
  }, [key, queryClient]);
}
