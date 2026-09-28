import { useEffect, useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Hook to track when a user views an event.
 * Records the view in the database on first view.
 *
 * The existence lookup returns:
 *   true  — a matching event_views row exists
 *   false — the lookup succeeded and confirmed no row exists
 * Lookup errors are surfaced through React Query (isError) rather than
 * being coerced to `false`, so a failed/unauthorized read never triggers
 * a speculative insert.
 */
export function useEventViewTracking(eventId: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient();

  // Check if user has already viewed this event
  const viewCheckQuery = useQuery({
    queryKey: ["event-view-check", eventId, userId],
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from("event_views")
        .select("id")
        .eq("event_id", eventId!)
        .eq("user_id", userId!)
        .maybeSingle();

      if (error) {
        // Surface the error to React Query — do NOT coerce to `false`,
        // which would be interpreted as "confirmed not viewed" and
        // cause a spurious insert.
        throw error;
      }
      return !!data;
    },
    enabled: !!eventId && !!userId,
  });

  const hasViewed = viewCheckQuery.data;

  // Mutation to record the view
  const recordViewMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("event_views")
        .insert({
          event_id: eventId!,
          user_id: userId!,
        });

      // Ignore unique constraint violations (user already viewed) —
      // treated as an idempotent success.
      if (error && !error.message.includes("duplicate key")) {
        throw error;
      }
    },
    onSuccess: () => {
      // Only invalidate on successful insert (or idempotent duplicate).
      queryClient.invalidateQueries({ queryKey: ["event-view-check", eventId, userId] });
      queryClient.invalidateQueries({ queryKey: ["event-views", eventId] });
      queryClient.invalidateQueries({ queryKey: ["user-event-views"] });
    },
  });

  // Only record when the lookup EXPLICITLY confirmed no row exists.
  // Unknown / error states must not trigger a write.
  useEffect(() => {
    if (eventId && userId && hasViewed === false) {
      recordViewMutation.mutate();
    }
  }, [eventId, userId, hasViewed]);

  return { hasViewed };
}

/**
 * Hook to get the list of users who have/haven't viewed an event.
 * Only for admins.
 */
export function useEventViewsAdmin(eventId: string | undefined, enabled: boolean = true) {
  return useQuery({
    queryKey: ["event-views", eventId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("event_views")
        .select(`
          id,
          user_id,
          viewed_at
        `)
        .eq("event_id", eventId!);

      if (error) throw error;
      return data || [];
    },
    enabled: !!eventId && enabled,
  });
}

/**
 * Hook to get user's viewed event IDs for showing badges on event list.
 *
 * The caller's `eventIds` array is never mutated. We compute a normalized
 * (deduplicated + sorted) copy once and use the SAME copy for both the
 * React Query cache key and the database `.in()` filter, so equivalent
 * ID sets in different orders reuse the same cache entry.
 */
export function useUserEventViews(userId: string | undefined, eventIds: string[] = []) {
  const normalizedIds = useMemo(
    () => Array.from(new Set(eventIds)).sort(),
    [eventIds],
  );
  const cacheKey = normalizedIds.join(",");

  return useQuery({
    queryKey: ["user-event-views", userId, cacheKey],
    queryFn: async () => {
      if (normalizedIds.length === 0) return new Set<string>();

      const { data, error } = await supabase
        .from("event_views")
        .select("event_id")
        .eq("user_id", userId!)
        .in("event_id", normalizedIds);

      if (error) throw error;
      return new Set<string>(
        (data ?? []).flatMap((view) =>
          typeof view.event_id === "string" ? [view.event_id] : [],
        ),
      );
    },
    enabled: !!userId && normalizedIds.length > 0,
  });
}
