import { useCallback, useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

// Stable no-op ref callback used when no userId/photoId is available.
const noopRef = (_el: HTMLElement | null) => {};

/**
 * Build a stable cache key from a list of photo IDs.
 *
 * Sorting + joining the full id list is required: keys based only on length /
 * first / last id collide constantly (e.g. paginated feeds where two distinct
 * pages share endpoints) and cause counts from one photo set to be served for
 * another.
 */
function makeIdsKey(photoIds: string[]): string {
  if (photoIds.length === 0) return "";
  // Copy before sort so we never mutate the caller's array.
  return [...photoIds].sort().join(",");
}

/**
 * Fetch view counts for a list of photos.
 * Returns a Map of photoId -> count.
 *
 * Uses the `get_photo_view_counts` RPC which aggregates server-side; this
 * avoids the Supabase 1000-row default cap that previously caused popular
 * photos to undercount once total views across the requested set exceeded 1k.
 */
export function usePhotoViewCounts(photoIds: string[]) {
  const idsKey = useMemo(() => makeIdsKey(photoIds), [photoIds]);

  return useQuery({
    queryKey: ["photo-view-counts", idsKey],
    queryFn: async () => {
      if (photoIds.length === 0) return new Map<string, number>();
      const { data, error } = await supabase.rpc("get_photo_view_counts", {
        _photo_ids: photoIds,
      });
      if (error) {
        console.error("Error fetching photo view counts:", error);
        return new Map<string, number>();
      }
      const counts = new Map<string, number>();
      for (const row of (data || []) as Array<{ photo_id: string; view_count: number }>) {
        counts.set(row.photo_id, Number(row.view_count) || 0);
      }
      return counts;
    },
    enabled: photoIds.length > 0,
    staleTime: 60 * 1000,
    // Keep previously-fetched counts visible while a new id set (e.g. next
    // infinite-scroll page) is loading. Without this, the query key change
    // briefly returns `undefined` and every view badge flickers to hidden
    // before reappearing once the refetch resolves.
    placeholderData: (prev) => prev,
  });
}

/**
 * Records a view for the current user when a photo becomes visible.
 * Caller passes `shouldRecord` (e.g. on intersection or lightbox open).
 */
export function useRecordPhotoView(userId: string | undefined) {
  const queryClient = useQueryClient();
  // Per-mount throttle: don't record the same photo more than once every 30s
  // from the same component instance (prevents accidental double-fires from
  // scroll observer + lightbox open in the same gesture).
  const lastRecorded = useRef<Map<string, number>>(new Map());
  const RECORD_THROTTLE_MS = 30 * 1000;

  const mutation = useMutation({
    mutationFn: async (photoId: string) => {
      if (!userId) return;
      const { error } = await supabase
        .from("photo_views")
        .insert({ photo_id: photoId, user_id: userId });
      if (error) throw error;
    },
    onSuccess: (_data, photoId) => {
      // Optimistically bump count in any cached query. We intentionally do
      // NOT invalidate here — invalidation triggers a refetch that briefly
      // returns the pre-bump count and causes the view number to flicker as
      // the image loads. The realtime channel + this optimistic update keep
      // the cache in sync.
      queryClient.setQueriesData<Map<string, number>>(
        { queryKey: ["photo-view-counts"] },
        (old) => {
          if (!old) return old;
          const next = new Map(old);
          next.set(photoId, (next.get(photoId) || 0) + 1);
          return next;
        }
      );
    },
  });

  const recordView = useCallback((photoId: string) => {
    if (!userId || !photoId) return;
    const last = lastRecorded.current.get(photoId) || 0;
    if (Date.now() - last < RECORD_THROTTLE_MS) return;
    lastRecorded.current.set(photoId, Date.now());
    mutation.mutate(photoId);
  }, [userId, mutation]);

  /**
   * Returns a ref callback that records a view once the element has been
   * visible in the viewport (>=25% for ~300ms). Lenient thresholds catch
   * quick scrollers who would otherwise go uncounted.
   *
   * Ref callbacks are cached per photoId so React does not detach/reattach
   * (and re-create the IntersectionObserver) on every render.
   */
  const observerCleanups = useRef<Map<string, () => void>>(new Map());
  const refCallbacks = useRef<Map<string, (el: HTMLElement | null) => void>>(new Map());

  // Cleanup all observers on unmount
  useEffect(() => {
    return () => {
      observerCleanups.current.forEach((cleanup) => cleanup());
      observerCleanups.current.clear();
      refCallbacks.current.clear();
    };
  }, []);

  const observeView = useCallback((photoId: string) => {
    if (!userId || !photoId) {
      // Return a stable no-op so React doesn't churn refs
      return noopRef;
    }

    const existing = refCallbacks.current.get(photoId);
    if (existing) return existing;

    const cb = (el: HTMLElement | null) => {
      // Tear down any previous observer for this photoId
      const prevCleanup = observerCleanups.current.get(photoId);
      if (prevCleanup) {
        prevCleanup();
        observerCleanups.current.delete(photoId);
      }

      if (!el) return;

      let timer: ReturnType<typeof setTimeout> | null = null;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (entry.isIntersecting && entry.intersectionRatio >= 0.25) {
              if (timer) continue;
              timer = setTimeout(() => {
                recordView(photoId);
                observer.disconnect();
                observerCleanups.current.delete(photoId);
              }, 300);
            } else if (timer) {
              clearTimeout(timer);
              timer = null;
            }
          }
        },
        { threshold: [0, 0.25, 0.5, 1] }
      );

      observer.observe(el);
      observerCleanups.current.set(photoId, () => {
        if (timer) clearTimeout(timer);
        observer.disconnect();
      });
    };

    refCallbacks.current.set(photoId, cb);
    return cb;
  }, [userId, recordView]);

  return { recordView, observeView };
}

/**
 * Realtime subscription that increments cached photo view counts as new
 * `photo_views` rows are inserted for any of the supplied photo IDs.
 */
export function usePhotoViewRealtime(photoIds: string[], currentUserId?: string) {
  const queryClient = useQueryClient();
  const idsKey = useMemo(() => makeIdsKey(photoIds), [photoIds]);

  useEffect(() => {
    if (photoIds.length === 0) return;
    const ids = new Set(photoIds);

    // Channel name must be globally unique per id set; a stable hash of the
    // sorted ids guarantees no collisions across mounted feeds.
    const channelName = `photo-views-${idsKey.length}-${idsKey.slice(0, 80)}`;

    const channel = supabase
      .channel(channelName)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "photo_views" },
        (payload) => {
          const row = payload.new as any;
          const photoId = row?.photo_id as string | undefined;
          const userId = row?.user_id as string | undefined;
          if (!photoId || !ids.has(photoId)) return;
          // Skip own inserts — already optimistically counted in onSuccess.
          // Without this guard the count flickers (+1 optimistic, +1 realtime,
          // then settles back) as the image loads.
          if (currentUserId && userId === currentUserId) return;
          queryClient.setQueriesData<Map<string, number>>(
            { queryKey: ["photo-view-counts"] },
            (old) => {
              if (!old) return old;
              const next = new Map(old);
              next.set(photoId, (next.get(photoId) || 0) + 1);
              return next;
            }
          );
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // Intentionally omit `photoIds` from deps — its array reference changes every
    // render even when contents are stable. `idsKey` is the stable hash of the
    // sorted ids and is the only signal that should trigger a resubscribe.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [idsKey, queryClient, currentUserId]);
}
