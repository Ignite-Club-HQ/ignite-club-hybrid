import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import {
  buildVaultStorageUrl,
  compensateVaultUpload,
  reserveVaultStorage,
  settleVaultStorage,
} from "@/lib/vaultUpload";
import { tryUploadMediaToBlobStore } from "@/live/mediaUpload";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { registerLiveVaultFile } from "@/live/features/vault";
import type { VaultFolderView } from "./types";

type IgniteSupabaseClient = SupabaseClient<Database>;
type VaultFileInsert = Database["public"]["Tables"]["vault_files"]["Insert"];

export function getVaultUploadScope(view: VaultFolderView): Pick<
  VaultFileInsert,
  "club_id" | "team_id" | "mini_league_id"
> {
  if (view.type === "club") return { club_id: view.clubId };
  if (view.type === "team") return { club_id: view.clubId, team_id: view.teamId };
  if (view.type === "mini-league") {
    return { club_id: view.clubId, mini_league_id: view.miniLeagueId };
  }
  return {};
}

export function buildVaultUploadPath(options: {
  view: VaultFolderView;
  userId: string;
  fileName: string;
  timestamp?: number;
  randomValue?: number;
}): string {
  const fileExt = options.fileName.split(".").pop();
  const timestamp = options.timestamp ?? Date.now();
  const randomSuffix = (options.randomValue ?? Math.random()).toString(36).substring(7);
  const leaf = `${options.userId}/${timestamp}-${randomSuffix}.${fileExt}`;

  if (options.view.type === "team") {
    return `clubs/${options.view.clubId}/teams/${options.view.teamId}/${leaf}`;
  }
  if (options.view.type === "club") {
    return `clubs/${options.view.clubId}/${leaf}`;
  }
  if (options.view.type === "mini-league") {
    return `clubs/${options.view.clubId}/mini-leagues/${options.view.miniLeagueId}/${leaf}`;
  }
  return `unassigned/${leaf}`;
}

export async function createVaultExternalLink(
  options: {
    url: string;
    name: string;
    userId: string;
    folderId: string | null;
    view: VaultFolderView;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  const insert: VaultFileInsert = {
    file_url: options.url,
    uploaded_by: options.userId,
    name: options.name,
    folder_id: options.folderId,
    is_external_link: true,
    file_size: 0,
    ...getVaultUploadScope(options.view),
  };
  const { error } = await client.from("vault_files").insert(insert);
  if (error) throw error;
}

export interface VaultUploadDependencies {
  reserveStorage: typeof reserveVaultStorage;
  settleStorage: typeof settleVaultStorage;
  compensateUpload: typeof compensateVaultUpload;
  buildStorageUrl: typeof buildVaultStorageUrl;
  /**
   * Optional on-chain upload path (ICP media_blob_store). Returns null when
   * no blob store is configured or there is no Internet Identity session —
   * the Supabase storage upload then runs unchanged.
   */
  tryBlobUpload?: typeof tryUploadMediaToBlobStore;
}

const defaultUploadDependencies: VaultUploadDependencies = {
  reserveStorage: reserveVaultStorage,
  settleStorage: settleVaultStorage,
  compensateUpload: compensateVaultUpload,
  buildStorageUrl: buildVaultStorageUrl,
  tryBlobUpload: tryUploadMediaToBlobStore,
};

export async function uploadVaultItem(
  options: {
    kind: "photo" | "file";
    file: File;
    name: string;
    userId: string;
    folderId: string | null;
    view: VaultFolderView;
  },
  client: IgniteSupabaseClient = supabase,
  dependencies: VaultUploadDependencies = defaultUploadDependencies,
): Promise<void> {
  const storagePath = buildVaultUploadPath({
    view: options.view,
    userId: options.userId,
    fileName: options.file.name,
  });
  const clubId = "clubId" in options.view ? options.view.clubId ?? null : null;

  // ICP mode: bytes go to the media_blob_store canister (encrypted) and the
  // metadata row to vault_domain — no Supabase writes at all. Fail closed
  // when the blob store is not configured (the upload UI is hidden upstream
  // via isIcpMediaUploadUnavailable; this is the defence-in-depth guard).
  // Quota reserve/settle are Supabase-only and intentionally skipped:
  // storage accounting is hard-zeroed for ICP (vaultAccessRepository).
  if (isFeatureRoutedToIcp("vault")) {
    const blobUpload = dependencies.tryBlobUpload
      ? await dependencies.tryBlobUpload({
          storagePath,
          file: options.file,
          mime: options.file.type || "application/octet-stream",
        })
      : null;
    if (!blobUpload) {
      throw new Error("Vault uploads are not available for Internet Identity members until the media canisters are configured");
    }
    if (!clubId) {
      throw new Error("Vault uploads need a club scope on the ICP backend");
    }
    await withFeatureBackend("vault", {
      supabase: () => {
        throw new Error("unreachable: vault routing checked above");
      },
      icp: async (ctx) => {
        await registerLiveVaultFile(
          ctx,
          crypto.randomUUID(),
          options.folderId ?? "",
          clubId,
          options.view.type === "team" ? options.view.teamId : null,
          options.name,
          blobUpload.url,
          options.file.size,
          options.file.type || "application/octet-stream",
          false,
          blobUpload.blobRef,
          options.view.type === "mini-league" ? options.view.miniLeagueId : null,
        );
      },
    });
    return;
  }

  const reservationId = await dependencies.reserveStorage(clubId, options.file.size);

  // ICP blob store (future on-chain media): bytes go on-chain when a
  // media_blob_store canister is configured and the member is signed in with
  // Internet Identity; otherwise Supabase storage, unchanged.
  const blobUpload = dependencies.tryBlobUpload
    ? await dependencies.tryBlobUpload({
        storagePath,
        file: options.file,
        mime: options.file.type || "application/octet-stream",
      })
    : null;

  if (!blobUpload) {
    // icp-guard: allow media bytes stay on Supabase storage by design; II
    // uploaders are gated upstream (isIcpMediaUploadUnavailable) until the
    // blob-store canister ID is configured, so this fallback is unreachable
    // for Internet Identity members in practice.
    const { error: uploadError } = await client.storage
      .from("photos")
      .upload(storagePath, options.file, { cacheControl: "31536000" });
    if (uploadError) {
      await dependencies.settleStorage(reservationId, false);
      throw uploadError;
    }
  }

  const insert: VaultFileInsert = {
    file_url: blobUpload ? blobUpload.url : dependencies.buildStorageUrl(storagePath),
    // On-chain bytes do not live in the Supabase bucket.
    storage_bucket: blobUpload ? null : "photos",
    storage_path: storagePath,
    uploaded_by: options.userId,
    name: options.name,
    folder_id: options.folderId,
    file_size: options.file.size,
    ...getVaultUploadScope(options.view),
  };
  if (options.kind === "photo") insert.file_type = options.file.type;

  const { error: insertError } = await client.from("vault_files").insert(insert);
  if (insertError) {
    // Compensate: never leave an orphaned object billed against the club.
    await dependencies.compensateUpload(storagePath);
    await dependencies.settleStorage(reservationId, false);
    throw insertError;
  }

  await dependencies.settleStorage(reservationId, true);
}
