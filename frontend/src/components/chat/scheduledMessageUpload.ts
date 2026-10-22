import { supabase } from "@/integrations/supabase/client";
import { uploadWithinClubMediaAllowance } from "@/features/vault/clubMediaAllowance";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { tryUploadMediaToBlobStore } from "@/live/mediaUpload";
import { compressImage as compressImageFile } from "@/lib/imageCompression";
import { mimeToExtension } from "@/lib/binaryUtils";
import {
  measureImageDimensions,
  appendDimensionsToUrl,
  setCachedImageAspectRatio,
} from "@/lib/chatImageAspectCache";

const MAX_UPLOAD_SIZE_BYTES = 10 * 1024 * 1024;

export interface ScheduledUploadTarget {
  clubId?: string | null;
  teamId?: string | null;
}

/**
 * Upload an image attachment for a scheduled message.
 *
 * Supabase accounts upload into the chat-attachments bucket, mirroring the
 * path layout used by ChatImageInput so the worker can reuse the resulting
 * public URL when the message is delivered.
 *
 * Internet Identity accounts upload encrypted bytes to the media_blob_store
 * canister (same IBE-encrypt + pii_access_control registration flow as
 * ChatImageInput's uploadBlob) — there is no Supabase session to authorize a
 * Storage upload, and the bytes must never leave the device unencrypted.
 */
export async function uploadScheduledImage(
  file: File,
  target: ScheduledUploadTarget = {},
): Promise<string> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Please select an image file");
  }
  if (file.size > MAX_UPLOAD_SIZE_BYTES) {
    throw new Error("Image must be less than 10MB");
  }

  let toUpload: File = file;
  let contentType = file.type || "image/jpeg";
  try {
    const { file: compressed } = await compressImageFile(file);
    toUpload = compressed;
    contentType = compressed.type || contentType;
  } catch (e) {
    console.warn("[scheduledUpload] compression failed, using original", e);
  }

  const ext = mimeToExtension(contentType);
  const ts = Date.now();

  let publicUrl: string;

  if (isFeatureRoutedToIcp("messaging")) {
    const rand = Math.random().toString(36).slice(2, 8);
    let icpPath: string;
    if (target.clubId && target.teamId) {
      icpPath = `clubs/${target.clubId}/teams/${target.teamId}/scheduled/${ts}-${rand}.${ext}`;
    } else if (target.clubId) {
      icpPath = `clubs/${target.clubId}/scheduled/${ts}-${rand}.${ext}`;
    } else {
      icpPath = `general/scheduled/${ts}-${rand}.${ext}`;
    }
    const blobUpload = await tryUploadMediaToBlobStore({
      storagePath: icpPath,
      file: toUpload,
      mime: contentType,
    });
    if (!blobUpload) {
      throw new Error("Media uploads are not available yet for Internet Identity accounts");
    }
    publicUrl = blobUpload.url;
  } else {
    if (target.teamId && !target.clubId) {
      const { data: team, error } = await supabase.from("teams").select("club_id").eq("id", target.teamId).maybeSingle();
      if (error || !team?.club_id) throw new Error("Could not check this team's club storage. Please try again.");
      target = { ...target, clubId: team.club_id };
    }
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) throw new Error("Not authenticated");

    let path: string;
    if (target.clubId && target.teamId) {
      path = `clubs/${target.clubId}/teams/${target.teamId}/${user.id}/scheduled-${ts}.${ext}`;
    } else if (target.clubId) {
      path = `clubs/${target.clubId}/${user.id}/scheduled-${ts}.${ext}`;
    } else {
      path = `general/${user.id}/scheduled-${ts}.${ext}`;
    }

    const { error } = await uploadWithinClubMediaAllowance(target.clubId, toUpload.size, () => supabase.storage
      .from("chat-attachments")
      .upload(path, toUpload, { contentType, upsert: false, cacheControl: "31536000" }), supabase, target.teamId, { bucket: "chat-attachments", path, file: toUpload });
    if (error) throw new Error(error.message || "Upload failed");

    const { data } = supabase.storage.from("chat-attachments").getPublicUrl(path);
    publicUrl = data.publicUrl;
  }

  try {
    const dims = await measureImageDimensions(toUpload);
    if (dims) {
      publicUrl = appendDimensionsToUrl(publicUrl, dims.width, dims.height);
      setCachedImageAspectRatio([publicUrl], dims.width / dims.height);
    }
  } catch (e) {
    console.warn("[scheduledUpload] dimension measurement failed", e);
  }

  return publicUrl;
}
