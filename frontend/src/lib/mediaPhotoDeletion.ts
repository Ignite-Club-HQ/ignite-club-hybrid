/**
 * Media photo deletion — "Remove from feed only" vs "Delete from feed and vault".
 *
 * Authorization and atomicity live in the database: `public.delete_media_photo`
 * is a SECURITY DEFINER routine that derives the caller from `auth.uid()`,
 * verifies the caller may delete the stored photo (app admin / uploader /
 * club admin or committee member of the photo's club / team admin of the
 * photo's exact team) and updates `photos` + `vault_files` in one transaction.
 *
 * A client-side fallback exists only for deployments where the RPC has not
 * been rolled out yet. It performs the same sequence of updates and, crucially,
 * surfaces EVERY Supabase error instead of ignoring it — a partial failure must
 * never be reported to the UI as success.
 */

import type { SupabaseClient } from "@supabase/supabase-js";

export type MediaDeletionMode = "feed_only" | "feed_and_vault";

export interface DeleteMediaPhotoArgs {
  photoId: string;
  mode: MediaDeletionMode;
  /** Used only by the client-side fallback path for `deleted_by`. */
  callerId?: string | null;
}

export interface DeleteMediaPhotoResult {
  photoId: string;
  mode: MediaDeletionMode;
  vaultFileId: string | null;
  vaultUpdated: boolean;
}

// Postgres reports a missing function as PGRST202 (PostgREST) or 42883.
function isMissingFunction(error: { code?: string | null; message?: string | null } | null) {
  if (!error) return false;
  const code = error.code ?? "";
  if (code === "PGRST202" || code === "42883") return true;
  return /could not find the function|does not exist/i.test(error.message ?? "");
}

function toError(error: { message?: string | null } | null, fallback: string): Error {
  return new Error(error?.message || fallback);
}

export async function deleteMediaPhoto(
  supabase: SupabaseClient<any, any, any>,
  { photoId, mode, callerId }: DeleteMediaPhotoArgs,
): Promise<DeleteMediaPhotoResult> {
  if (!photoId) throw new Error("photoId is required");
  if (mode !== "feed_only" && mode !== "feed_and_vault") {
    throw new Error("Unsupported deletion mode");
  }

  const { data, error } = await supabase.rpc("delete_media_photo", {
    _photo_id: photoId,
    _mode: mode,
  });

  if (!error) {
    const row = (Array.isArray(data) ? data[0] : data) as
      | { vault_file_id?: string | null; vault_updated?: boolean }
      | null
      | undefined;
    return {
      photoId,
      mode,
      vaultFileId: row?.vault_file_id ?? null,
      vaultUpdated: Boolean(row?.vault_updated),
    };
  }

  if (!isMissingFunction(error)) {
    throw toError(error, "Failed to delete photo");
  }

  return deleteMediaPhotoFallback(supabase, { photoId, mode, callerId });
}

/**
 * Non-transactional fallback. Every step is checked; any failure throws so the
 * UI cannot report success while the Vault copy is still active.
 */
async function deleteMediaPhotoFallback(
  supabase: SupabaseClient<any, any, any>,
  { photoId, mode, callerId }: DeleteMediaPhotoArgs,
): Promise<DeleteMediaPhotoResult> {
  const now = new Date().toISOString();

  if (mode === "feed_only") {
    // Feed-only must never read or mutate vault_files.
    const { error } = await supabase
      .from("photos")
      .update({ show_in_feed: false })
      .eq("id", photoId);
    if (error) throw toError(error, "Failed to remove photo from the feed");
    return { photoId, mode, vaultFileId: null, vaultUpdated: false };
  }

  const { error: photoError } = await supabase
    .from("photos")
    .update({ deleted_at: now, show_in_feed: false })
    .eq("id", photoId);
  if (photoError) throw toError(photoError, "Failed to delete photo");

  const { data: photoData, error: lookupError } = await supabase
    .from("photos")
    .select("file_url, image_url")
    .eq("id", photoId)
    .single();
  if (lookupError) throw toError(lookupError, "Failed to locate the photo's vault copy");

  const url = photoData?.file_url || photoData?.image_url || null;
  // Legacy photos genuinely have neither URL — nothing to mirror into the Vault.
  if (!url) return { photoId, mode, vaultFileId: null, vaultUpdated: false };

  const { data: vaultRows, error: vaultError } = await supabase
    .from("vault_files")
    .update({ deleted_at: now, deleted_by: callerId ?? null })
    .eq("file_url", url)
    .select("id");
  if (vaultError) throw toError(vaultError, "Failed to delete the photo from the vault");

  const vaultFileId = Array.isArray(vaultRows) && vaultRows.length > 0 ? vaultRows[0].id : null;
  return { photoId, mode, vaultFileId, vaultUpdated: vaultFileId !== null };
}
