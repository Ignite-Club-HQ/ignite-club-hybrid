import { supabase } from "@/integrations/supabase/client";
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
 * Upload an image attachment for a scheduled message into the chat-attachments
 * bucket. Mirrors the path layout used by ChatImageInput so the worker can
 * reuse the resulting public URL when the message is delivered.
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

  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error("Not authenticated");

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
  let path: string;
  if (target.clubId && target.teamId) {
    path = `clubs/${target.clubId}/teams/${target.teamId}/${user.id}/scheduled-${ts}.${ext}`;
  } else if (target.clubId) {
    path = `clubs/${target.clubId}/${user.id}/scheduled-${ts}.${ext}`;
  } else {
    path = `general/${user.id}/scheduled-${ts}.${ext}`;
  }

  const { error } = await supabase.storage
    .from("chat-attachments")
    .upload(path, toUpload, { contentType, upsert: false, cacheControl: "31536000" });
  if (error) throw new Error(error.message || "Upload failed");

  const { data } = supabase.storage.from("chat-attachments").getPublicUrl(path);
  let publicUrl = data.publicUrl;

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

