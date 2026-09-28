import { useCallback, useState } from "react";
import { toast } from "sonner";
import {
  publishChatImageToGallery,
  unpublishGalleryPhoto,
  type PublishChatImageArgs,
} from "@/lib/publishChatImageToGallery";
import { notifyClubFreeUsageChanged } from "@/hooks/useClubFreeUsage";
import {
  shouldShowGalleryNudge,
  markGalleryNudgeShown,
} from "@/lib/galleryPublishNudge";

interface UsePublishChatImageOptions {
  uploaderId: string | undefined;
  teamId: string | null;
  clubId: string | null;
}

/**
 * Reusable hook for "publish a chat image to the media gallery" used by team,
 * club and group chat pages. Tracks per-message in-flight + completed sets so
 * UI can render an inline chip with the right state, and exposes a one-shot
 * post-send nudge that suggests adding the just-sent image to the gallery.
 */
export function usePublishChatImage({ uploaderId, teamId, clubId }: UsePublishChatImageOptions) {
  const [publishingIds, setPublishingIds] = useState<Set<string>>(new Set());
  const [publishedIds, setPublishedIds] = useState<Set<string>>(new Set());

  // Gallery publishing is only available in team chats — club/group chats
  // don't have a destination team gallery and shouldn't show the chip.
  const canPublish = !!uploaderId && !!teamId;

  const undoPublish = useCallback(
    async (messageId: string, photoId: string) => {
      try {
        await unpublishGalleryPhoto(photoId);
        setPublishedIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
        notifyClubFreeUsageChanged(clubId);
        toast.success("Removed from gallery");
      } catch (err: any) {
        console.error("[usePublishChatImage] undo failed", err);
        toast.error(err?.message || "Couldn't undo");
      }
    },
    [clubId],
  );

  const publish = useCallback(
    async (messageId: string, imageUrl: string) => {
      if (!canPublish || !uploaderId) return;
      if (publishingIds.has(messageId) || publishedIds.has(messageId)) return;

      setPublishingIds((prev) => {
        const next = new Set(prev);
        next.add(messageId);
        return next;
      });

      try {
        const args: PublishChatImageArgs = {
          imageUrl,
          uploaderId,
          teamId,
          clubId,
        };
        const result = await publishChatImageToGallery(args);
        setPublishedIds((prev) => {
          const next = new Set(prev);
          next.add(messageId);
          return next;
        });
        if (result.alreadyPublished) {
          toast.success("Already in the media gallery");
        } else {
          notifyClubFreeUsageChanged(clubId);
          toast.success("Added to media gallery", {
            duration: 6000,
            action: {
              label: "Undo",
              onClick: () => {
                void undoPublish(messageId, result.photoId);
              },
            },
          });
        }
      } catch (err: any) {
        console.error("[usePublishChatImage] failed", err);
        toast.error(err?.message || "Couldn't add to gallery");
      } finally {
        setPublishingIds((prev) => {
          const next = new Set(prev);
          next.delete(messageId);
          return next;
        });
      }
    },
    [canPublish, uploaderId, teamId, clubId, publishingIds, publishedIds, undoPublish],
  );

  /**
   * Throttled toast nudge — call right after the user sends an image message.
   * Shows at most once every 24h per device, pointing at the inline
   * "Add to gallery" chip on the just-sent message.
   */
  const nudgeAfterSend = useCallback(() => {
    // Disabled: the "Saved to chat / Add to gallery" toast was noisy after every image send.
    // The inline chip under the message still lets users publish to the gallery.
    return;
  }, []);


  return {
    publishingIds,
    publishedIds,
    publish,
    nudgeAfterSend,
    canPublish,
  };
}
