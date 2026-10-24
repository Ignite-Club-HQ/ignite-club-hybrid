import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { permanentlyDeleteVaultItems } from "@/lib/vaultDelete";
import { invalidateVaultCache } from "./vaultQueryKeys";
import { summarizeVaultDeletion, buildVaultDeleteMessage } from "./vaultDeleteReporting";
import { fetchVaultLargeFiles } from "./vaultLargeFileRepository";
import { isVaultImage } from "./vaultReadRepository";
import { prepareVaultLargeFileDeletion, sortVaultLargeFileItems, type VaultLargeFileItem, type VaultLargeFileSort } from "./vaultLargeFileManagement";
import { isFeatureRoutedToIcp } from "@/live/loadBackendRouting";
import { withFeatureBackend } from "@/live/featureRouter";
import { listLiveVaultClubFiles } from "@/live/features/vault";
import { vaultDeletionCandidates } from "./vaultDeletionCandidates";

/** Same final cap the Supabase path applies in `buildVaultLargeFileItems`. */
const LARGE_FILES_LIMIT = 50;

export interface UseVaultLargeFilesOptions {
  currentClubId?: string;
  queryClient: Parameters<typeof invalidateVaultCache>[0];
  formatStorageSize: (bytes: number) => string;
}

/**
 * Maps a VaultFile canister record onto the large-files item shape. The
 * canister has no separate photos table, so "photo" vs "file" is derived
 * with the same `isVaultImage` heuristic the Supabase partition uses.
 */
function mapIcpVaultFileToLargeItem(file: any): VaultLargeFileItem {
  return {
    id: file.id,
    type: isVaultImage({ file_type: file.mime, name: file.name, file_url: file.file_url }) ? "photo" : "file",
    name: file.name || "File",
    size: Number(file.size ?? 0),
    url: file.file_url,
    createdAt: new Date(Number(file.created_at_ms)).toISOString(),
  };
}

export function useVaultLargeFiles({ currentClubId, queryClient, formatStorageSize }: UseVaultLargeFilesOptions) {
  const [largeFilesDialogOpen, setLargeFilesDialogOpen] = useState(false);
  const [largeFilesData, setLargeFilesData] = useState<{ loading: boolean; items: VaultLargeFileItem[] }>({ loading: false, items: [] });
  const [selectedLargeFiles, setSelectedLargeFiles] = useState<Set<string>>(new Set());
  const [deletingLargeFiles, setDeletingLargeFiles] = useState(false);
  const [largeFilesSortBy, setLargeFilesSortBy] = useState<VaultLargeFileSort>("size");

  const fetchLargeFiles = useCallback(async () => {
    if (!currentClubId) return;
    setLargeFilesData({ loading: true, items: [] });
    setSelectedLargeFiles(new Set());
    try {
      const items = await withFeatureBackend("vault", {
        supabase: () => fetchVaultLargeFiles(currentClubId),
        // Provisional: no folder/team-name join on the canister, and no
        // per-table size threshold — matches the Supabase path's final cap.
        icp: async (ctx) => {
          const files = await listLiveVaultClubFiles(ctx, currentClubId, null, null);
          const mapped = (files as any[]).map(mapIcpVaultFileToLargeItem);
          return sortVaultLargeFileItems(mapped, "size").slice(0, LARGE_FILES_LIMIT);
        },
      }, { clubId: currentClubId });
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
    setDeletingLargeFiles(true);
    try {
      const deletion = prepareVaultLargeFileDeletion(largeFilesData.items, selectedLargeFiles);
      // The canister has no separate photos table — every selected id is a
      // vault_domain file row regardless of the UI's photo/file split, so
      // route them all as fileIds rather than splitting by (UI-only) type.
      const result = isFeatureRoutedToIcp("vault")
        ? await permanentlyDeleteVaultItems({ fileIds: [...deletion.photoIds, ...deletion.fileIds] })
        : await permanentlyDeleteVaultItems({ photoIds: deletion.photoIds, fileIds: deletion.fileIds });
      const summary = summarizeVaultDeletion(
        vaultDeletionCandidates(deletion.items, isFeatureRoutedToIcp("vault")),
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
