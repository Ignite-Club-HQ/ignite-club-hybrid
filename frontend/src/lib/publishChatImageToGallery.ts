import { supabase } from "@/integrations/supabase/client";

/**
 * Publish a chat-attached image to the team / club media gallery.
 *
 * Chat images live in the `chat-attachments` storage bucket (so they follow
 * message lifecycle — deleting a message can remove them). The media gallery
 * is backed by the `photos` storage bucket + `photos` table. To make a chat
 * image durably available in the gallery we:
 *
 *  1. Detect if it's already been published (idempotent).
 *  2. Download the original from `chat-attachments`.
 *  3. Re-upload a clean copy into `photos/clubs/{clubId}/teams/{teamId}/...`.
 *  4. Insert a `photos` row scoped to the same team/club.
 *
 * The `photos` RLS policy ("Members can upload photos") requires the caller to
 * be a member of the target club or team — which the original poster already is.
 */
export interface PublishChatImageArgs {
  imageUrl: string;
  uploaderId: string;
  /** team scope — required unless clubId is provided (club-wide chat). */
  teamId: string | null;
  clubId: string | null;
  caption?: string | null;
  /** Optional album to group this photo under (for batch "Publish all"). */
  albumId?: string | null;
}

export interface PublishChatImageResult {
  photoId: string;
  alreadyPublished: boolean;
}

const PHOTOS_BUCKET = "photos";
const SUPABASE_URL = "REDACTED_LAB_VALUE";

function inferExtension(blob: Blob, fallback = "jpg"): string {
  const fromMime = blob.type?.split("/")?.[1];
  if (!fromMime) return fallback;
  // Normalise common MIME variants.
  if (fromMime === "jpeg") return "jpg";
  if (fromMime === "svg+xml") return "svg";
  // Strip any "+xml" / parameters.
  return fromMime.split("+")[0].split(";")[0] || fallback;
}

export async function publishChatImageToGallery(
  args: PublishChatImageArgs,
): Promise<PublishChatImageResult> {
  const { imageUrl, uploaderId, teamId, clubId, caption, albumId } = args;
  if (!imageUrl) throw new Error("imageUrl is required");
  if (!uploaderId) throw new Error("uploaderId is required");
  if (!teamId && !clubId) throw new Error("teamId or clubId is required");

  // 1. Idempotency — has this exact image already been published by this user?
  // Fail-closed: if the lookup errors (RLS, connectivity, server), we cannot
  // safely determine whether the image is already published. Continuing would
  // risk duplicate storage objects and duplicate gallery rows, so abort.
  const { data: existing, error: existingError } = await supabase
    .from("photos")
    .select("id")
    .eq("uploader_id", uploaderId)
    .eq("image_url", imageUrl)
    .is("deleted_at", null)
    .maybeSingle();
  if (existingError) {
    console.error("[publishChatImageToGallery] existing lookup failed", existingError);
    throw new Error(
      existingError.message ||
        "Could not check whether this image is already published",
    );
  }
  if (existing?.id) {
    return { photoId: existing.id, alreadyPublished: true };
  }

  // 2. Download the original image bytes.
  let blob: Blob;
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) throw new Error(`fetch failed: ${res.status}`);
    blob = await res.blob();
  } catch (err) {
    console.error("[publishChatImageToGallery] download failed", err);
    throw new Error("Could not load the image to publish");
  }

  // 3. Re-upload into the photos bucket under the appropriate scope path.
  const ext = inferExtension(blob);
  const timestamp = Date.now();
  const randomSuffix = Math.random().toString(36).slice(2, 9);
  const storagePath = teamId
    ? clubId
      ? `clubs/${clubId}/teams/${teamId}/${uploaderId}/${timestamp}-${randomSuffix}.${ext}`
      : `teams/${teamId}/${uploaderId}/${timestamp}-${randomSuffix}.${ext}`
    : `clubs/${clubId}/${uploaderId}/${timestamp}-${randomSuffix}.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(PHOTOS_BUCKET)
    .upload(storagePath, blob, {
      contentType: blob.type || `image/${ext}`,
      upsert: false,
      cacheControl: "31536000",
    });
  if (uploadError) {
    console.error("[publishChatImageToGallery] upload failed", uploadError);
    throw new Error("Could not save image to the gallery");
  }

  const storageUrl = `${SUPABASE_URL}/storage/v1/object/public/${PHOTOS_BUCKET}/${storagePath}`;

  // 4. Insert the photos row. Cleanup storage if the insert fails (RLS, etc.).
  const { data: inserted, error: insertError } = await supabase
    .from("photos")
    .insert({
      image_url: storageUrl,
      uploader_id: uploaderId,
      club_id: clubId,
      team_id: teamId,
      file_size: blob.size,
      caption: caption || null,
      title: caption || null,
      album_id: albumId ?? null,
    })
    .select("id")
    .single();

  if (insertError || !inserted) {
    console.error("[publishChatImageToGallery] insert failed", insertError);
    try {
      await supabase.storage.from(PHOTOS_BUCKET).remove([storagePath]);
    } catch (cleanupErr) {
      console.warn("[publishChatImageToGallery] cleanup failed", cleanupErr);
    }
    throw insertError || new Error("Could not register photo in gallery");
  }

  return { photoId: inserted.id, alreadyPublished: false };
}

/**
 * Reverse a recent publish by soft-deleting the gallery photo row.
 * Mirrors the regular media gallery delete flow (sets deleted_at) so it
 * disappears from the gallery immediately and can be cleaned up later.
 */
export async function unpublishGalleryPhoto(photoId: string): Promise<void> {
  const { error } = await supabase
    .from("photos")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", photoId);
  if (error) {
    console.error("[unpublishGalleryPhoto] failed", error);
    throw new Error("Could not undo");
  }
}
