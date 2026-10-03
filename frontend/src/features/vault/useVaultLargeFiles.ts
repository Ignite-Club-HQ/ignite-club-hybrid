import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { permanentlyDeleteVaultItems } from "@/lib/vaultDelete";
import { invalidateVaultCache } from "./vaultQueryKeys";
import { summarizeVaultDeletion, buildVaultDeleteMessage } from "./vaultDeleteReporting";
import { fetchVaultLargeFiles } from "./vaultLargeFileRepository";
import { prepareVaultLargeFileDeletion, sortVaultLargeFileItems, type VaultLargeFileItem, type VaultLargeFileSort } from "./vaultLargeFileManagement";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";

export interface UseVaultLargeFilesOptions {
  currentClubId?: string;
  queryClient: Parameters<typeof invalidateVaultCache>[0];
  formatStorageSize: (bytes: number) => string;
}

export function useVaultLargeFiles({ currentClubId, queryClient, formatStorageSize }: UseVaultLargeFilesOptions) {
  const [largeFilesDialogOpen, setLargeFilesDialogOpen] = useState(false);
  const [largeFilesData, setLargeFilesData] = useState<{ loading: boolean; items: VaultLargeFileItem[] }>({ loading: false, items: [] });
  const [selectedLargeFiles, setSelectedLargeFiles] = useState<Set<string>>(new Set());
  const [deletingLargeFiles, setDeletingLargeFiles] = useState(false);
  const [largeFilesSortBy, setLargeFilesSortBy] = useState<VaultLargeFileSort>("size");

  const fetchLargeFiles = useCallback(async () => {
    if (!currentClubId) return;
    // Large-files listing reads Supabase storage rows with no canister
    // counterpart — silently empty for ICP-routed clubs.
    if (isFeatureRoutedToIcp("vault")) {
      setLargeFilesData({ loading: false, items: [] });
      return;
    }
    setLargeFilesData({ loading: true, items: [] });
    setSelectedLargeFiles(new Set());
    try {
      const items = await fetchVaultLargeFiles(currentClubId);
      setLargeFilesData({ loading: false, items });
    } catch (error) {
      console.error("Failed to fetch large files:", error);
      setLargeFilesData({ loading: false, items: [] });
      toast.error("Failed to load large files");
    }
  }, [currentClubId]);

  const openLargeFiles = useCallback(() => {
    setLargeFilesDialogOpen(true);
    void fetchLargeFiles();
  }, [fetchLargeFiles]);

  const handleLargeFilesDialogChange = useCallback((open: boolean) => {
    setLargeFilesDialogOpen(open);
    if (!open) setSelectedLargeFiles(new Set());
  }, []);

  const toggleLargeFileSelection = useCallback((id: string) => {
    setSelectedLargeFiles(current => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const deleteSelectedLargeFiles = useCallback(async () => {
    if (selectedLargeFiles.size === 0) return;
    // Fail closed: permanent-delete-photos is a Supabase edge function with
    // no canister equivalent — never fire it for an ICP-routed club.
    if (isFeatureRoutedToIcp("vault")) return;
    setDeletingLargeFiles(true);
    try {
      const deletion = prepareVaultLargeFileDeletion(largeFilesData.items, selectedLargeFiles);
      const result = await permanentlyDeleteVaultItems({ photoIds: deletion.photoIds, fileIds: deletion.fileIds });
      const summary = summarizeVaultDeletion(
        deletion.items.map(item => ({ id: item.id, type: item.type, size: item.size })),
        result,
      );
      const { outcome, message } = buildVaultDeleteMessage(summary, formatStorageSize);
      if (summary.deletedCount > 0) {
        invalidateVaultCache(queryClient, ["files"]);
        invalidateVaultCache(queryClient, ["storageBreakdown"]);
        invalidateVaultCache(queryClient, ["photos"]);
      }
      const deletedIds = new Set(summary.deletedIds);
      setSelectedLargeFiles(current => new Set([...current].filter(id => !deletedIds.has(id))));
      if (outcome === "failure") toast.error(message);
      else toast.success(message);
      void fetchLargeFiles();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete files");
    } finally {
      setDeletingLargeFiles(false);
    }
  }, [fetchLargeFiles, largeFilesData.items, queryClient, selectedLargeFiles]);

  const sortedLargeFiles = useMemo(
    () => sortVaultLargeFileItems(largeFilesData.items, largeFilesSortBy),
    [largeFilesData.items, largeFilesSortBy],
  );
  const selectedBytes = useMemo(
    () => largeFilesData.items
      .filter(item => selectedLargeFiles.has(item.id))
      .reduce((sum, item) => sum + item.size, 0),
    [largeFilesData.items, selectedLargeFiles],
  );

  return {
    largeFilesDialogOpen,
    largeFilesData,
    selectedLargeFiles,
    deletingLargeFiles,
    largeFilesSortBy,
    setLargeFilesSortBy,
    sortedLargeFiles,
    selectedBytes,
    openLargeFiles,
    handleLargeFilesDialogChange,
    toggleLargeFileSelection,
    deleteSelectedLargeFiles,
  };
}
