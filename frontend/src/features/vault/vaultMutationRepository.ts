import type { SupabaseClient } from "@supabase/supabase-js";
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { VaultFolderView } from "./types";
import { getVaultScope } from "./vaultScope";
import { withFeatureBackend } from "@/live/featureRouter";
import {
  createLiveVaultFolder,
  deleteLiveVaultFolder,
  moveLiveVaultFile,
  permanentlyDeleteLiveVaultFile,
  renameLiveVaultFile,
  restoreLiveVaultFile,
  registerLiveVaultFile,
  trashLiveVaultFile,
  updateLiveVaultFolder,
} from "@/live/features/vault";

type IgniteSupabaseClient = SupabaseClient<Database>;

async function updateName(
  table: "vault_folders" | "vault_files",
  id: string,
  name: string,
  client: IgniteSupabaseClient,
): Promise<void> {
  const { error } = await client.from(table).update({ name }).eq("id", id);
  if (error) throw error;
}

export function renameVaultFolder(
  folderId: string,
  newName: string,
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return withFeatureBackend("vault", {
    supabase: () => updateName("vault_folders", folderId, newName, client),
    icp: async (ctx) => {
      // Provisional mapping: restricted_roles are not tracked by this
      // Supabase-side rename call, so the canister folder's role list is
      // reset to empty here — verify against the live canister post-deploy.
      await updateLiveVaultFolder(ctx, folderId, newName, []);
    },
  });
}

export function renameVaultItem(
  fileId: string,
  newName: string,
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return withFeatureBackend("vault", {
    supabase: () => updateName("vault_files", fileId, newName, client),
    icp: (ctx) => renameLiveVaultFile(ctx, fileId, newName),
  });
}

export async function moveVaultFile(
  options: {
    fileId: string;
    targetFolderId: string | null;
    targetTeamId?: string | null;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const update: { folder_id: string | null; team_id?: string | null } = {
        folder_id: options.targetFolderId,
      };
      if (options.targetTeamId !== undefined) update.team_id = options.targetTeamId;

      const { error } = await client
        .from("vault_files")
        .update(update)
        .eq("id", options.fileId);
      if (error) throw error;
    },
    icp: async (ctx) => {
      // Provisional mapping: the canister adopts the target folder's team
      // scope, so targetTeamId has no canister parameter; the vault root is
      // the empty folder id. Verify against the live canister post-deploy.
      await moveLiveVaultFile(ctx, options.fileId, options.targetFolderId ?? "");
    },
  });
}

export async function createVaultFolder(
  options: {
    name: string;
    userId: string;
    parentFolderId: string | null;
    view: VaultFolderView;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const insert: Database["public"]["Tables"]["vault_folders"]["Insert"] = {
        name: options.name,
        created_by: options.userId,
        parent_id: options.parentFolderId,
      };
      if (options.view.type === "club") {
        insert.club_id = options.view.clubId;
      } else if (options.view.type === "team") {
        insert.club_id = options.view.clubId;
        insert.team_id = options.view.teamId;
      }

      const { error } = await client.from("vault_folders").insert(insert);
      if (error) throw error;
    },
    icp: async (ctx) => {
      // Provisional mapping: mini-league views pass a placeholder club id
      // (the canister scopes by mini_league_id) — verify the club/team id
      // mapping against the live canister post-deploy.
      const clubId = options.view.type === "club" || options.view.type === "team"
        ? options.view.clubId
        : "";
      const teamId = options.view.type === "team" ? options.view.teamId : null;
      await createLiveVaultFolder(
        ctx,
        crypto.randomUUID(),
        clubId,
        teamId,
        options.parentFolderId,
        options.name,
        [],
        options.view.type === "mini-league" ? options.view.miniLeagueId : null,
      );
    },
  });
}

/**
 * Inserts an external-link Vault "file" row (`is_external_link: true`,
 * `file_size: 0` — links have no storage size) scoped to the given view via
 * the already-tested `getVaultScope`, matching the same club/team/mini-league
 * scoping the upload flow's file insert uses.
 */
export async function createVaultLinkFile(
  options: {
    url: string;
    name: string;
    userId: string;
    folderId: string | null;
    view: VaultFolderView;
  },
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  const scope = getVaultScope(options.view);

  return withFeatureBackend("vault", {
    supabase: async () => {
      const insert: any = {
        file_url: options.url,
        uploaded_by: options.userId,
        name: options.name,
        folder_id: options.folderId,
        is_external_link: true,
        file_size: 0,
      };
      if (scope.clubId) insert.club_id = scope.clubId;
      if (scope.teamId) insert.team_id = scope.teamId;
      if (scope.miniLeagueId) insert.mini_league_id = scope.miniLeagueId;

      const { error } = await client.from("vault_files").insert(insert);
      if (error) throw error;
    },
    icp: async (ctx) => {
      // Provisional mapping: mini-league views pass a placeholder club id
      // (the canister scopes by mini_league_id) — verify against the live
      // canister post-deploy, matching createVaultFolder's convention above.
      const clubId = options.view.type === "club" || options.view.type === "team"
        ? options.view.clubId
        : "";
      const teamId = options.view.type === "team" ? options.view.teamId : null;
      await registerLiveVaultFile(
        ctx,
        crypto.randomUUID(),
        options.folderId ?? "",
        clubId,
        teamId,
        options.name,
        options.url,
        0,
        "link/external",
        true,
        null,
        options.view.type === "mini-league" ? options.view.miniLeagueId : null,
      );
    },
  });
}

export async function deleteVaultFolder(
  folderId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { error } = await client.from("vault_folders").delete().eq("id", folderId);
      if (error) throw error;
    },
    icp: async (ctx) => {
      await deleteLiveVaultFolder(ctx, folderId);
    },
  });
}

export async function softDeleteVaultItem(
  itemId: string,
  deletedBy: string | undefined,
  deletedAt: Date = new Date(),
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { error } = await client
        .from("vault_files")
        .update({ deleted_at: deletedAt.toISOString(), deleted_by: deletedBy })
        .eq("id", itemId);
      if (error) throw error;
      return itemId;
    },
    icp: async (ctx) => {
      // The canister records the deleting principal (and timestamp)
      // canister-side on trash.
      await trashLiveVaultFile(ctx, itemId);
      return itemId;
    },
  });
}

export async function restoreVaultItem(
  itemId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { error } = await client
        .from("vault_files")
        .update({ deleted_at: null, deleted_by: null })
        .eq("id", itemId);
      if (error) throw error;
      return itemId;
    },
    icp: async (ctx) => {
      await restoreLiveVaultFile(ctx, itemId);
      return itemId;
    },
  });
}

export async function permanentlyDeleteVaultPhoto(
  itemId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<string> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const { data: vaultFile } = await client
        .from("vault_files")
        .select("file_url")
        .eq("id", itemId)
        .maybeSingle();

      const photoIds: string[] = [];
      if (vaultFile?.file_url) {
        const { data: photoRecord } = await client
          .from("photos")
          .select("id")
          .eq("image_url", vaultFile.file_url)
          .maybeSingle();
        if (photoRecord) photoIds.push(photoRecord.id);
      }

      const response = await client.functions.invoke("permanent-delete-photos", {
        body: { photoIds, fileIds: [itemId], deletionType: "permanent" },
      });
      if (response.error) throw new Error(response.error.message);
      return itemId;
    },
    icp: async (ctx) => {
      // The canister hard-deletes the metadata row. The linked photos row and
      // file bytes live in Supabase (the ICP blob store is not built yet), so
      // byte cleanup stays with the storage layer — provisional.
      await permanentlyDeleteLiveVaultFile(ctx, itemId);
      return itemId;
    },
  });
}

export async function permanentlyDeleteVaultFile(
  itemId: string,
  client: IgniteSupabaseClient = supabase,
): Promise<void> {
  return withFeatureBackend("vault", {
    supabase: async () => {
      const response = await client.functions.invoke("permanent-delete-photos", {
        body: { fileIds: [itemId], deletionType: "permanent" },
      });
      if (response.error) throw new Error(response.error.message);
    },
    icp: async (ctx) => {
      // The canister hard-deletes the metadata row. File bytes live in
      // Supabase storage (the ICP blob store is not built yet), so byte
      // cleanup stays with the storage layer — provisional.
      await permanentlyDeleteLiveVaultFile(ctx, itemId);
    },
  });
}
