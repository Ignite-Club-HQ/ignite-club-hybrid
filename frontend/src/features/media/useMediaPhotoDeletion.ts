import { useState } from "react";
import { type QueryKey, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { removePhotoFromCache } from "@/lib/mediaCache";

type MediaFeedPage = { photos: Array<{ id: string }>; nextCursor?: number };
type MediaFeedCache = { pages: MediaFeedPage[]; [key: string]: unknown };

export function removePhotoFromMediaFeedCache<T>(cache: T, photoId: string): T {
  const candidate = cache as MediaFeedCache | undefined;
  if (!candidate?.pages) return cache;
  return {
    ...candidate,
    pages: candidate.pages.map((page) => ({
      ...page,
      photos: page.photos.filter((photo) => photo.id !== photoId),
    })),
  } as T;
}

export function useMediaPhotoDeletion(options: {
  userId: string | undefined;
  photosQueryKey: QueryKey;
  onDeleteStarted: () => void;
}) {
  const queryClient = useQueryClient();
  const [deletingPhotoId, setDeletingPhotoId] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: async ({ photoId, deleteFromVault }: { photoId: string; deleteFromVault: boolean }) => {
      const { deleteMediaPhoto } = await import("@/lib/mediaPhotoDeletion");
      await deleteMediaPhoto(supabase, {
        photoId,
        mode: deleteFromVault ? "feed_and_vault" : "feed_only",
        callerId: options.userId ?? null,
      });
    },
    onMutate: async ({ photoId }) => {
      setDeletingPhotoId(photoId);
      options.onDeleteStarted();
      await queryClient.cancelQueries({ queryKey: options.photosQueryKey });
      const previousPhotos = queryClient.getQueryData(options.photosQueryKey);
      queryClient.setQueryData(options.photosQueryKey, (old: unknown) =>
        removePhotoFromMediaFeedCache(old, photoId));
      return { previousPhotos, photoId };
    },
    onSuccess: (_, { photoId }) => {
      removePhotoFromCache(photoId);
    },
    onError: (error: any, _, context) => {
      if (context?.previousPhotos) {
        queryClient.setQueryData(options.photosQueryKey, context.previousPhotos);
      }
      toast.error(error.message || "Failed to delete photo");
    },
    onSettled: () => {
      setDeletingPhotoId(null);
      void queryClient.invalidateQueries({ queryKey: options.photosQueryKey });
    },
  });

  return { deletePhoto: mutation.mutate, deletingPhotoId };
}
