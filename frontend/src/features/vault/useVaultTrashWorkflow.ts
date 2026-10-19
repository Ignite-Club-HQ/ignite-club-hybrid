import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { permanentlyDeleteVaultItems } from "@/lib/vaultDelete";
import { removePhotoFromCache } from "@/lib/mediaCache";
import { resolveEmptyTrashOutcome } from "@/lib/vaultTrashOutcome";
import {
  permanentlyDeleteVaultFile,
  permanentlyDeleteVaultPhoto,
  restoreVaultItem,
  softDeleteVaultItem,
} from "./vaultMutationRepository";
import { invalidateVaultCache, vaultKeys } from "./vaultQueryKeys";
import type { VaultFolderView } from "./types";
import {
  fetchVaultTrashItems,
  partitionVaultTrashItems,
  type VaultTrashFile,
  type VaultTrashItems,
} from "./vaultTrashRepository";
import { mapLiveVaultFile } from "./vaultReadRepository";
import { supabase } from "@/integrations/supabase/client";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveVaultTrashWithFolder } from "@/live/features/vault";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

type VaultTrashWorkflowOptions = {
  currentView: VaultFolderView;
  showTrash: boolean;
  userId: string | undefined;
  isClubAdmin: boolean;
  isCoachOrTeamAdmin: boolean;
  onPhotoSoftDeleteStart: () => void;
  onFileSoftDeleteSuccess: () => void;
};

function getClubId(view: VaultFolderView): string | null {
  return view.type === "root" ? null : view.clubId;
}

export function getVaultTrashQueryScope(
  currentView: VaultFolderView,
  showTrash: boolean,
): { clubId: string | null; competitionId: string | null; enabled: boolean } {
  const clubId = getClubId(currentView);
  return {
    clubId,
    competitionId: currentView.type === "competition" ? currentView.competitionId : null,
    enabled: showTrash && currentView.type !== "root",
  };
}

/**
 * Maps a `VaultFileWithFolder` canister record onto the same
 * `{ ...file, folder, team }` shape the Supabase trash query returns.
 * Provisional: the canister has no team-name join, so `team` stays null.
 */
function mapIcpTrashEntry(entry: any): VaultTrashFile {
  const file = entry?.file ?? entry;
  const folderNameRaw = entry?.folder_name;
  const folderName = Array.isArray(folderNameRaw) ? folderNameRaw[0] : folderNameRaw;
  const mapped = mapLiveVaultFile(file) as VaultTrashFile;
  return {
    ...mapped,
    folder: folderName ? { id: mapped.folder_id ?? "", name: folderName } : null,
    team: null,
  };
}

async function fetchVaultTrashForClub(clubId: string, competitionId: string | null): Promise<VaultTrashItems> {
  return withFeatureBackend("vault", {
    supabase: () => fetchVaultTrashItems(clubId, undefined, competitionId),
    icp: async (ctx) => {
      const trashed = await listLiveVaultTrashWithFolder(ctx, clubId);
      const mapped = (trashed as any[])
        .map(mapIcpTrashEntry)
        .filter((file) => !competitionId || file.competition_id === competitionId);
      return partitionVaultTrashItems(mapped);
    },
  }, competitionId ? { competitionId } : { clubId });
}

export function useVaultTrashWorkflow({
  currentView,
  showTrash,
  userId,
  isClubAdmin,
  isCoachOrTeamAdmin,
  onPhotoSoftDeleteStart,
  onFileSoftDeleteSuccess,
}: VaultTrashWorkflowOptions) {
  const queryClient = useQueryClient();
  const { clubId, competitionId, enabled } = getVaultTrashQueryScope(currentView, showTrash);
  const { data: trashItems, isLoading: isLoadingTrash } = useQuery({
    queryKey: vaultKeys.trashForClub(clubId, competitionId),
  queryFn: () => fetchVaultTrashForClub(clubId!, competitionId),
    enabled,
  });

  const deletePhotoMutation = useMutation({
    mutationFn: (photoId: string) => softDeleteVaultItem(photoId, userId),
    onMutate: async (photoId: string) => {
      onPhotoSoftDeleteStart();
      await queryClient.cancelQueries({ queryKey: vaultKeys.files() });
      const queryKey = vaultKeys.filesForView(currentView, isClubAdmin, isCoachOrTeamAdmin);
      const previousItems = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(queryKey, (old: Array<{ id: string }> | undefined) =>
        old?.filter((item) => item.id !== photoId),
      );
      return { previousItems, queryKey };
    },
    onSuccess: (photoId) => {
      removePhotoFromCache(photoId);
    },
    onError: (error: Error, _, context) => {
      if (context?.previousItems) {
        queryClient.setQueryData(context.queryKey, context.previousItems);
      }
      toast.error(error.message || "Failed to delete photo");
    },
    onSettled: () => {
      invalidateVaultCache(queryClient, ["files", "storageBreakdown"]);
    },
  });

  const deleteFileMutation = useMutation({
    mutationFn: (fileId: string) => softDeleteVaultItem(fileId, userId),
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["files", "storageBreakdown"]);
      onFileSoftDeleteSuccess();
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to delete file");
    },
  });

  const restorePhotoMutation = useMutation({
    mutationFn: restoreVaultItem,
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["trash", "files"]);
      toast.success("Photo restored to original location");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to restore photo");
    },
  });

  const restoreFileMutation = useMutation({
    mutationFn: restoreVaultItem,
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["trash", "files"]);
      toast.success("File restored to original location");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to restore file");
    },
  });

  const permanentDeletePhotoMutation = useMutation({
    mutationFn: permanentlyDeleteVaultPhoto,
    onSuccess: (photoId) => {
      removePhotoFromCache(photoId);
      invalidateVaultCache(queryClient, ["trash", "files", "storageBreakdown", "photos"]);
      toast.success("Photo permanently deleted");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to permanently delete photo");
    },
  });

  const permanentDeleteFileMutation = useMutation({
    mutationFn: permanentlyDeleteVaultFile,
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["trash", "files", "storageBreakdown"]);
      toast.success("File permanently deleted");
    },
    onError: (error: Error) => {
      toast.error(error.message || "Failed to permanently delete file");
    },
  });

  const [isEmptyingTrash, setIsEmptyingTrash] = useState(false);
  const emptyTrash = async () => {
    if (!trashItems || isEmptyingTrash) return;

    setIsEmptyingTrash(true);
    try {
      const allPhotoIds = trashItems.photos.map((photo) => photo.id);
      const allFileIds = trashItems.files.map((file) => file.id);

      // The ICP vault_domain canister has no separate "photos" table — a
      // photos-row lookup there would just hit Supabase with no match, so
      // skip it and let permanentlyDeleteVaultItems route every id as a file.
      const photoTableIds: string[] = [];
      if (!isFeatureRoutedToIcp("vault")) {
        for (const photo of trashItems.photos) {
          if (!photo.file_url) continue;
          const { data: photoRecord, error } = await supabase
            .from("photos")
            .select("id")
            .eq("image_url", photo.file_url)
            .maybeSingle();
          if (error) throw error;
          if (photoRecord) photoTableIds.push(photoRecord.id);
        }
      }

      const result = await permanentlyDeleteVaultItems({
        photoIds: photoTableIds,
        fileIds: [...allPhotoIds, ...allFileIds],
      });
      const requestedKeys = new Set([
        ...photoTableIds.map((id) => `photo:${id}`),
        ...[...allPhotoIds, ...allFileIds].map((id) => `file:${id}`),
      ]);
      const failedKeys = new Set(result.failed.map((failure) => `${failure.kind}:${failure.id}`));
      const succeededKeys = new Set(
        result.succeeded
          .map((success) => `${success.kind}:${success.id}`)
          .filter((key) => requestedKeys.has(key) && !failedKeys.has(key)),
      );
      const outcome = resolveEmptyTrashOutcome({
        succeededCount: succeededKeys.size,
        failedCount: requestedKeys.size - succeededKeys.size,
      });

      invalidateVaultCache(queryClient, ["trash", "files", "storageBreakdown", "photos"]);
      toast[outcome.kind](outcome.message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to empty trash");
    } finally {
      setIsEmptyingTrash(false);
    }
  };

  return {
    trashItems: trashItems as VaultTrashItems | undefined,
    isLoadingTrash,
    isEmptyingTrash,
    deletePhotoMutation,
    deleteFileMutation,
    restorePhotoMutation,
    restoreFileMutation,
    permanentDeletePhotoMutation,
    permanentDeleteFileMutation,
    emptyTrash,
  };
}
