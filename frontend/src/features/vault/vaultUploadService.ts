import { vaultViewScope } from "@/live/featureScopes";
import { writeOnce } from "@/live/clubScope";
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
import { registerLiveVaultFile, beginLiveVaultUpload, acknowledgeLiveVaultUpload } from "@/live/features/vault";
import { candidOpt } from "@/live/features/candid";
import type { VaultFolderView } from "./types";
import { uploadWithinClubMediaAllowance } from "./clubMediaAllowance";

type IgniteSupabaseClient = SupabaseClient<Database>;
type VaultFileInsert = Database["public"]["Tables"]["vault_files"]["Insert"];

export function getVaultUploadScope(view: VaultFolderView): Pick<
  VaultFileInsert,
  "club_id" | "team_id" | "mini_league_id" | "competition_id"
> {
  if (view.type === "club") return { club_id: view.clubId };
  if (view.type === "team") return { club_id: view.clubId, team_id: view.teamId };
  if (view.type === "mini-league") {
    return { club_id: view.clubId, mini_league_id: view.miniLeagueId };
  }
  if (view.type === "competition") {
    return { club_id: view.clubId, competition_id: view.competitionId };
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
  if (options.view.type === "competition") {
    return `clubs/${options.view.clubId}/competitions/${options.view.competitionId}/${leaf}`;
  }
  return `unassigned/${leaf}`;
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
  const storageBucket = options.view.type === "competition" ? "competition-vault" : "photos";

  // ICP mode: bytes go to the media_blob_store canister (encrypted) and the
  // metadata row to vault_domain — no Supabase writes at all. Fail closed
  // when the blob store is not configured (the upload UI is hidden upstream
  // via isIcpMediaUploadUnavailable; this is the defence-in-depth guard).
  // Quota reserve/settle are Supabase-only and intentionally skipped:
  // storage accounting is hard-zeroed for ICP (vaultAccessRepository).
  if (isFeatureRoutedToIcp("vault")) {
    // Fail closed before any bytes are encrypted or uploaded.
    if (!clubId) {
      throw new Error("Vault uploads need a club scope on the ICP backend");
    }
    // Every on-chain byte costs upload time; shrink photos first (same
    // resize the gallery uses). Non-images pass through untouched.
    if (options.kind === "photo") {
      const { compressImage } = await import("@/lib/imageCompression");
      options = { ...options, file: (await compressImage(options.file)).file };
    }
    const registrationId = crypto.randomUUID();
    await withFeatureBackend("vault", {
      supabase: () => { throw new Error("unreachable: vault routing checked above"); },
      icp: async (ctx) => {
    const privatePath = storagePath.replace(/^(clubs\/[^/]+\/)/, "$1vault/");
    const name = (options.name.trim() || "Untitled").slice(0, 160);
    const mime = (options.file.type || "application/octet-stream").slice(0, 128);
    // Role-limited folders lock the file to their role audience (one key per
    // audience); unlimited folders keep the existing club grant path.
    const teamScope = options.view.type === "team" ? options.view.teamId : null;
    let audience: import("@/live/piiVetKeys").SharedAudience | undefined;
    if (options.folderId && options.view.type !== "competition") {
      const [{ getLiveVaultFolder }, { vaultRoleScope }] = await Promise.all([import("@/live/features/vault"), import("@/live/piiVetKeys")]);
      const folder = await getLiveVaultFolder(ctx, options.folderId);
      const roles = (folder?.restricted_roles ?? []).filter(Boolean);
      if (roles.length) audience = { kind: "vaultrole", scope: vaultRoleScope(clubId, teamScope, roles), club: clubId };
    }
    const blobUpload = dependencies.tryBlobUpload
      ? await dependencies.tryBlobUpload({
          context: ctx,
          // "vault/" segment lets the canister apply the vault free-plan cap.
          storagePath: privatePath,
          file: options.file,
          mime: options.file.type || "application/octet-stream",
          lock: "own",
          audience,
          competitionId: options.view.type === "competition" ? options.view.competitionId : undefined,
          beforeUpload: async (ref) => beginLiveVaultUpload(ctx, {
            id: registrationId, folder_id: options.folderId ?? "", club: clubId,
            team: candidOpt(options.view.type === "team" ? options.view.teamId : null),
            mini_league_id: candidOpt(options.view.type === "mini-league" ? options.view.miniLeagueId : null),
            competition_id: candidOpt(options.view.type === "competition" ? options.view.competitionId : null),
            name, mime, size: BigInt(options.file.size), uploaded_by: ctx.identity.getPrincipal(),
            file_url: `https://${ref.canister}.raw.icp0.io/${ref.path}`, blob_ref: [ref],
            is_external_link: false, created_at_ms: 0n, deleted_at_ms: [], deleted_by: [],
          }),
        })
      : null;
    if (!blobUpload) {
      throw new Error("Vault uploads are not available for Internet Identity members until the media canisters are configured");
    }
        await acknowledgeLiveVaultUpload(ctx, registrationId);
        await registerLiveVaultFile(
          ctx,
          registrationId,
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
          options.view.type === "competition" ? options.view.competitionId : null,
        );
      },
    }, writeOnce(vaultViewScope(options.view)));
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
        lock: "own",
        competitionId: options.view.type === "competition" ? options.view.competitionId : undefined,
      })
    : null;

  if (!blobUpload) {
    // icp-guard: allow media bytes stay on Supabase storage by design; II
    // uploaders are gated upstream (isIcpMediaUploadUnavailable) until the
    // blob-store canister ID is configured, so this fallback is unreachable
    // for Internet Identity members in practice.
    try {
      const { error: uploadError } = await uploadWithinClubMediaAllowance(clubId, options.file.size, () => client.storage
        .from(storageBucket)
        .upload(storagePath, options.file, { cacheControl: "31536000" }), client, options.view.type === "team" ? options.view.teamId : null, { bucket: storageBucket, path: storagePath, file: options.file, vault: true });
      if (uploadError) throw uploadError;
    } catch (error) {
      await dependencies.settleStorage(reservationId, false);
      throw error;
    }
  }

  const insert: VaultFileInsert = {
    file_url: blobUpload ? blobUpload.url : dependencies.buildStorageUrl(storagePath, storageBucket),
    // On-chain bytes do not live in the Supabase bucket.
    storage_bucket: blobUpload ? null : storageBucket,
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
    await dependencies.compensateUpload(storagePath, storageBucket);
    await dependencies.settleStorage(reservationId, false);
    throw insertError;
  }

  await dependencies.settleStorage(reservationId, true);
}
