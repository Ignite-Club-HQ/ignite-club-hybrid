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
  type VaultTrashItems,
} from "./vaultTrashRepository";
import { supabase } from "@/integrations/supabase/client";

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
): { clubId: string | null; enabled: boolean } {
  const clubId = getClubId(currentView);
  return {
    clubId,
    enabled: showTrash && currentView.type !== "root",
  };
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
  const { clubId, enabled } = getVaultTrashQueryScope(currentView, showTrash);
  const { data: trashItems, isLoading: isLoadingTrash } = useQuery({
    queryKey: vaultKeys.trashForClub(clubId),
    queryFn: () => fetchVaultTrashItems(clubId!),
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
      const photoTableIds: string[] = [];
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
