import { useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { mediaKeys } from "./mediaQueryKeys";

type MediaChangePayload = {
  new?: { photo_id?: string } | null;
  old?: { photo_id?: string } | null;
};

const isNativeRuntime = () => !!(window as any).Capacitor?.isNativePlatform?.();

export function useMediaRealtime(userId: string | undefined, photoIds: readonly string[]) {
  const queryClient = useQueryClient();
  const photoIdsSignature = photoIds.join(",");
  const visiblePhotoIds = useMemo(() => new Set(photoIds), [photoIdsSignature]);

  useEffect(() => {
    if (!userId) return;
    const channel = supabase
      .channel(`media-feed-${userId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "photos" },
        () => {
          void queryClient.invalidateQueries({ queryKey: mediaKeys.feeds(userId) });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, queryClient]);

  useEffect(() => {
    if (!userId || visiblePhotoIds.size === 0) return;
    const channel = supabase
      .channel(`media-comments-${userId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "photo_comments" },
        (payload: MediaChangePayload) => {
          const photoId = (payload.new || payload.old)?.photo_id;
          if (photoId && visiblePhotoIds.has(photoId)) {
            void queryClient.invalidateQueries({ queryKey: mediaKeys.comments(userId) });
          }
        },
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "photo_reactions" },
        (payload: MediaChangePayload) => {
          const photoId = (payload.new || payload.old)?.photo_id;
          if (photoId && visiblePhotoIds.has(photoId)) {
            void queryClient.invalidateQueries({ queryKey: mediaKeys.reactions(userId) });
          }
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [userId, photoIdsSignature, visiblePhotoIds, queryClient]);

  useEffect(() => {
    if (!userId) return;
    const onVisible = () => {
      if (isNativeRuntime() || document.visibilityState !== "visible") return;
      void queryClient.invalidateQueries({ queryKey: mediaKeys.comments(userId) });
      void queryClient.invalidateQueries({ queryKey: mediaKeys.reactions(userId) });
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [userId, queryClient]);
}
