import { useCallback, useState } from "react";
import { toast } from "sonner";
import { removePhotoFromCache } from "@/lib/mediaCache";
import { invalidateVaultCache } from "./vaultQueryKeys";
import { softDeleteVaultSelection } from "./vaultBulkMutationService";

export interface VaultBulkSelectableItem {
  id: string;
}

export interface UseVaultBulkDeleteWorkflowOptions {
  photos: VaultBulkSelectableItem[];
  files: VaultBulkSelectableItem[];
  userId: string | undefined;
  queryClient: Parameters<typeof invalidateVaultCache>[0];
}

/**
 * Owns Vault's multi-select toolbar state and the bulk soft-delete (move to
 * trash) workflow. Export/download of the same selection is handled by
 * `useVaultExport`, which receives this hook's `selectionMode`/selected sets
 * and `exitSelectionMode` as inputs so both features share one selection.
 */
export function useVaultBulkDeleteWorkflow({
  photos,
  files,
  userId,
  queryClient,
}: UseVaultBulkDeleteWorkflowOptions) {
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedPhotos, setSelectedPhotos] = useState<Set<string>>(new Set());
  const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
  const [bulkDeleteDialogOpen, setBulkDeleteDialogOpen] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);

  const togglePhotoSelection = useCallback((photoId: string) => {
    setSelectedPhotos((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(photoId)) {
        newSet.delete(photoId);
      } else {
        newSet.add(photoId);
      }
      return newSet;
    });
  }, []);

  const toggleFileSelection = useCallback((fileId: string) => {
    setSelectedFiles((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(fileId)) {
        newSet.delete(fileId);
      } else {
        newSet.add(fileId);
      }
      return newSet;
    });
  }, []);

  const exitSelectionMode = useCallback(() => {
    setSelectionMode(false);
    setSelectedPhotos(new Set());
    setSelectedFiles(new Set());
  }, []);

  const selectAll = useCallback(() => {
    setSelectedPhotos(new Set(photos.map((p) => p.id)));
    setSelectedFiles(new Set(files.map((f) => f.id)));
  }, [photos, files]);

  const getSelectedItems = useCallback(() => {
    const selectedPhotoItems = photos.filter((p) => selectedPhotos.has(p.id));
    const selectedFileItems = files.filter((f) => selectedFiles.has(f.id));
    return { photos: selectedPhotoItems, files: selectedFileItems };
  }, [photos, files, selectedPhotos, selectedFiles]);

  const selectedCount = selectedPhotos.size + selectedFiles.size;

  // Bulk delete selected photos and files (soft delete).
  const deleteSelectedItems = useCallback(async () => {
    setIsDeletingSelected(true);
    const { photos: selectedPhotoItems, files: selectedFileItems } = getSelectedItems();

    try {
      const result = await softDeleteVaultSelection({
        photoIds: selectedPhotoItems.map((p) => p.id),
        fileIds: selectedFileItems.map((f) => f.id),
        deletedBy: userId,
      });

      for (const photoId of result.deletedPhotoIds) {
        removePhotoFromCache(photoId);
      }
      for (const failure of result.failed) {
        console.error(`Failed to soft-delete ${failure.kind}`, failure.id, failure.error);
      }

      const deletedCount = result.deletedPhotoIds.length + result.deletedFileIds.length;
      const errorCount = result.failed.length;

      invalidateVaultCache(queryClient, ["files", "photos", "storageBreakdown"]);

      if (errorCount === 0) {
        toast.success(`Moved ${deletedCount} items to trash`);
      } else {
        toast.warning(`Moved ${deletedCount} items to trash, ${errorCount} failed`);
      }
    } catch (error: any) {
      toast.error(error.message || "Failed to delete items");
    } finally {
      setIsDeletingSelected(false);
      setBulkDeleteDialogOpen(false);
      exitSelectionMode();
    }
  }, [exitSelectionMode, getSelectedItems, queryClient, userId]);

  return {
    selectionMode,
    setSelectionMode,
    selectedPhotos,
    selectedFiles,
    bulkDeleteDialogOpen,
    setBulkDeleteDialogOpen,
    isDeletingSelected,
    selectedCount,
    togglePhotoSelection,
    toggleFileSelection,
    exitSelectionMode,
    selectAll,
    deleteSelectedItems,
  };
}
