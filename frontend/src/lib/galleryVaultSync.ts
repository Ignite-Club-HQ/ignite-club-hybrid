import { supabase } from "@/integrations/supabase/client";

/**
 * One-way sync: media gallery photo upload → vault_files.
 *
 * Folder strategy:
 *   - Team upload  → team-level "Gallery Uploads" folder
 *   - Club-wide upload (no team) → club-level "Gallery Uploads" folder
 *   - Mini-league uploads are treated as club-level (folder still "Gallery Uploads",
 *     stamped with mini_league_id on the file row).
 *
 * Strictly one-way: vault deletions / edits do not touch the photos table,
 * and vault uploads are NEVER mirrored back into the media gallery.
 *
 * Called fire-and-forget after a photo row is inserted.
 */
export async function syncGalleryPhotoToVault({
  fileUrl,
  fileName,
  fileSize,
  fileType,
  userId,
  clubId,
  teamId,
  miniLeagueId,
}: {
  fileUrl: string;
  fileName: string;
  fileSize: number | null;
  fileType: string | null;
  userId: string;
  clubId: string;
  teamId?: string | null;
  miniLeagueId?: string | null;
}) {
  try {
    if (!clubId || !fileUrl) return;

    // Pro-gate: free clubs do not mirror gallery photos to the vault.
    // Vault is a Pro feature; keeping the gallery as the sole store on Free
    // also prevents inflating the vault file count against Free caps.
    const { data: isPro } = await supabase.rpc("has_active_pro_for_club", {
      _club_id: clubId,
    });
    if (isPro !== true) return;

    // Dedupe — the photo storage URL is unique, so if it's already in the
    // vault we skip (covers retries and the "already mirrored" case).
    const { data: existing } = await supabase
      .from("vault_files")
      .select("id")
      .eq("club_id", clubId)
      .eq("file_url", fileUrl)
      .limit(1)
      .maybeSingle();
    if (existing) return;

    const folderId = await getOrCreateGalleryFolder(clubId, userId, teamId || null);

    const row: any = {
      file_url: fileUrl,
      name: fileName,
      file_type: fileType,
      file_size: fileSize,
      is_external_link: false,
      club_id: clubId,
      team_id: teamId || null,
      mini_league_id: miniLeagueId || null,
      uploaded_by: userId,
      folder_id: folderId,
    };

    const { error } = await supabase.from("vault_files").insert(row);
    if (error) console.warn("galleryVaultSync insert failed:", error);
  } catch (err) {
    console.warn("galleryVaultSync error:", err);
  }
}

const folderCache = new Map<string, string>();

async function getOrCreateGalleryFolder(
  clubId: string,
  userId: string,
  teamId: string | null
): Promise<string | null> {
  const cacheKey = `${clubId}:${teamId || "club"}:gallery-uploads`;
  if (folderCache.has(cacheKey)) return folderCache.get(cacheKey)!;

  const folderName = "Gallery Uploads";

  let query = supabase
    .from("vault_folders")
    .select("id")
    .eq("club_id", clubId)
    .eq("name", folderName)
    .is("parent_id", null)
    .is("chat_group_id", null)
    .is("restricted_roles", null);

  if (teamId) query = query.eq("team_id", teamId);
  else query = query.is("team_id", null);

  const { data } = await query.maybeSingle();
  if (data) {
    folderCache.set(cacheKey, data.id);
    return data.id;
  }

  const { data: newFolder, error } = await supabase
    .from("vault_folders")
    .insert({
      club_id: clubId,
      name: folderName,
      created_by: userId,
      team_id: teamId,
    } as any)
    .select("id")
    .single();

  if (error || !newFolder) {
    console.warn("galleryVaultSync: failed to create folder:", error);
    return null;
  }

  folderCache.set(cacheKey, newFolder.id);
  return newFolder.id;
}
