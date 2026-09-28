import { useCallback, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { collectVaultExportContents, fetchVaultFolderContents } from "./vaultExportRepository";
import { excludeVaultExportFolders, resolveSelectedVaultExportItems, summarizeVaultExport, toggleVaultExportSelection } from "./vaultExportSelection";
import { runZipExport, summarizeZipExport, type ZipExportItem } from "./vaultZipExport";

export type FolderView =
  | { type: "root" }
  | { type: "club"; clubId: string; clubName: string; folderId?: string; folderName?: string }
  | { type: "team"; clubId: string; clubName: string; teamId: string; teamName: string; folderId?: string; folderName?: string }
  | { type: "mini-league"; clubId: string; clubName: string; miniLeagueId: string; miniLeagueName: string; folderId?: string; folderName?: string };

export interface VaultExportPhoto {
  id: string;
  file_url: string;
  title?: string | null;
  path?: string | null;
  [key: string]: unknown;
}

export interface VaultExportFile {
  id: string;
  file_url: string;
  name: string;
  path?: string | null;
  [key: string]: unknown;
}

export interface VaultExportPreviewData {
  photos: VaultExportPhoto[];
  files: VaultExportFile[];
  folderBreakdown: { path: string; photoCount: number; fileCount: number }[];
  loading: boolean;
}

export interface VaultFolderExportData {
  folderId: string;
  folderName: string;
  photos: VaultExportPhoto[];
  files: VaultExportFile[];
  selectedPhotos: Set<string>;
  selectedFiles: Set<string>;
  loading: boolean;
}

export type VaultExportAction = { type: "zip" | "download" | "zipAll"; includeSubfolders?: boolean };
export type VaultExportProgress = { current: number; total: number };

export interface UseVaultExportOptions {
  currentView: FolderView;
  photos: VaultExportPhoto[];
  files: VaultExportFile[];
  selectionMode: boolean;
  selectedPhotos: ReadonlySet<string>;
  selectedFiles: ReadonlySet<string>;
  exitSelectionMode: () => void;
  downloadPhotoFile: (url: string, filename?: string) => Promise<void>;
}

async function createZipArchive() {
  const { default: JSZip } = await import("jszip");
  return new JSZip();
}

const scopeForView = (currentView: FolderView) => ({
  folderId: currentView.type === "root" ? null : currentView.folderId || null,
  clubId: currentView.type === "root" ? null : currentView.clubId,
  teamId: currentView.type === "team" ? currentView.teamId : null,
});

const folderNameForView = (currentView: FolderView, selected = false) => {
  if (selected) return "selected-files";
  if (currentView.type === "root") return "vault";
  return currentView.folderName || (currentView.type === "team" ? currentView.teamName : currentView.clubName) || "export";
};

export function useVaultExport({
  currentView,
  photos,
  files,
  selectionMode,
  selectedPhotos,
  selectedFiles,
  exitSelectionMode,
  downloadPhotoFile,
}: UseVaultExportOptions) {
  const [isExporting, setIsExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<VaultExportProgress>({ current: 0, total: 0 });
  const exportAbortController = useRef<AbortController | null>(null);
  const [exportPreviewOpen, setExportPreviewOpen] = useState(false);
  const [exportPreviewData, setExportPreviewData] = useState<VaultExportPreviewData>({
    photos: [], files: [], folderBreakdown: [], loading: false,
  });
  const [excludedFolders, setExcludedFolders] = useState<Set<string>>(new Set());
  const [exportConfirmOpen, setExportConfirmOpen] = useState(false);
  const [pendingExportAction, setPendingExportAction] = useState<VaultExportAction | null>(null);
  const [folderExportDialogOpen, setFolderExportDialogOpen] = useState(false);
  const [folderExportData, setFolderExportData] = useState<VaultFolderExportData | null>(null);

  const downloadFile = useCallback(async (url: string, filename: string) => {
    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch file (${response.status})`);
      const blob = await response.blob();
      const blobUrl = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = filename;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
    } catch {
      toast.error("Failed to download file");
    }
  }, []);

  const getSelectedItems = useCallback(() => resolveSelectedVaultExportItems(
    photos, files, selectedPhotos, selectedFiles,
  ), [files, photos, selectedFiles, selectedPhotos]);

  const exportCurrentFolder = useCallback(async () => {
    const selected = getSelectedItems();
    const photosToExport = selectionMode ? selected.photos : photos;
    const filesToExport = selectionMode ? selected.files : files;
    if (!photosToExport.length && !filesToExport.length) {
      toast.error(selectionMode ? "No files selected" : "No files to export");
      return;
    }

    exportAbortController.current = new AbortController();
    const signal = exportAbortController.current.signal;
    const totalFiles = photosToExport.length + filesToExport.length;
    setExportProgress({ current: 0, total: totalFiles });
    setIsExporting(true);
    try {
      let downloadCount = 0;
      for (const photo of photosToExport) {
        if (signal.aborted) throw new Error("Export cancelled");
        await downloadPhotoFile(photo.file_url, photo.title || `photo-${photo.id}.jpg`);
        downloadCount++;
        setExportProgress({ current: downloadCount, total: totalFiles });
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      for (const file of filesToExport) {
        if (signal.aborted) throw new Error("Export cancelled");
        await downloadFile(file.file_url, file.name);
        downloadCount++;
        setExportProgress({ current: downloadCount, total: totalFiles });
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      toast.success(`Exported ${downloadCount} files`);
      if (selectionMode) exitSelectionMode();
    } catch (error) {
      if (error instanceof Error && error.message === "Export cancelled") toast.info("Export cancelled");
      else toast.error("Export failed");
    } finally {
      setIsExporting(false);
      setExportProgress({ current: 0, total: 0 });
      exportAbortController.current = null;
    }
  }, [downloadFile, downloadPhotoFile, exitSelectionMode, files, getSelectedItems, photos, selectionMode]);

  const cancelExport = useCallback(() => {
    exportAbortController.current?.abort();
  }, []);

  const openExportPreview = useCallback(async () => {
    const scope = scopeForView(currentView);
    setExportPreviewData({ photos: [], files: [], folderBreakdown: [], loading: true });
    setExcludedFolders(new Set());
    setExportPreviewOpen(true);
    try {
      const allContents = await collectVaultExportContents(scope, "", []);
      setExportPreviewData({
        photos: allContents.photos,
        files: allContents.files,
        folderBreakdown: allContents.folderBreakdown,
        loading: false,
      });
    } catch (error) {
      console.error("Failed to fetch folder contents:", error);
      toast.error("Failed to scan folders");
      setExportPreviewOpen(false);
    }
  }, [currentView]);

  const openFolderExportDialog = useCallback(async (folder: { id: string; name: string }) => {
    const scope = scopeForView(currentView);
    setFolderExportData({
      folderId: folder.id, folderName: folder.name, photos: [], files: [],
      selectedPhotos: new Set(), selectedFiles: new Set(), loading: true,
    });
    setFolderExportDialogOpen(true);
    try {
      const contents = await fetchVaultFolderContents({ ...scope, folderId: folder.id }, "");
      setFolderExportData({
        folderId: folder.id,
        folderName: folder.name,
        photos: contents.photos,
        files: contents.files,
        selectedPhotos: new Set(contents.photos.map((item: VaultExportPhoto) => item.id)),
        selectedFiles: new Set(contents.files.map((item: VaultExportFile) => item.id)),
        loading: false,
      });
    } catch (error) {
      console.error("Failed to fetch folder contents for export:", error);
      toast.error("Failed to load folder contents");
      setFolderExportDialogOpen(false);
    }
  }, [currentView]);

  const toggleFolderExportPhotoSelection = useCallback((photoId: string) => {
    setFolderExportData(current => current ? {
      ...current,
      selectedPhotos: toggleVaultExportSelection(current.selectedPhotos, photoId),
    } : current);
  }, []);

  const toggleFolderExportFileSelection = useCallback((fileId: string) => {
    setFolderExportData(current => current ? {
      ...current,
      selectedFiles: toggleVaultExportSelection(current.selectedFiles, fileId),
    } : current);
  }, []);

  const selectAllFolderExportItems = useCallback(() => {
    setFolderExportData(current => current ? {
      ...current,
      selectedPhotos: new Set(current.photos.map(({ id }) => id)),
      selectedFiles: new Set(current.files.map(({ id }) => id)),
    } : current);
  }, []);

  const deselectAllFolderExportItems = useCallback(() => {
    setFolderExportData(current => current ? {
      ...current, selectedPhotos: new Set(), selectedFiles: new Set(),
    } : current);
  }, []);

  const exportSelectedFolderItems = useCallback(async () => {
    if (!folderExportData) return;
    const photosToExport = folderExportData.photos.filter(({ id }) => folderExportData.selectedPhotos.has(id));
    const filesToExport = folderExportData.files.filter(({ id }) => folderExportData.selectedFiles.has(id));
    if (!photosToExport.length && !filesToExport.length) {
      toast.error("No items selected for export");
      return;
    }
    setFolderExportDialogOpen(false);
    const totalItems = photosToExport.length + filesToExport.length;
    if (totalItems > 1) {
      exportAbortController.current = new AbortController();
      const signal = exportAbortController.current.signal;
      setExportProgress({ current: 0, total: totalItems });
      setIsExporting(true);
      try {
        const zip = await createZipArchive();
        const items: ZipExportItem[] = [
          ...photosToExport.map(photo => ({ id: photo.id, kind: "photo" as const, url: photo.file_url, filename: photo.title || `photo-${photo.id}.jpg` })),
          ...filesToExport.map(file => ({ id: file.id, kind: "file" as const, url: file.file_url, filename: file.name })),
        ];
        const result = await runZipExport(items, {
          signal,
          isAborted: () => signal.aborted,
          fetchBlob: async (url, sig) => {
            const response = await fetch(url, { signal: sig });
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            return response.blob();
          },
          addToZip: (filename, blob) => zip.file(filename, blob),
          onProgress: processed => setExportProgress({ current: processed, total: totalItems }),
        });
        const { outcome, message, shouldDownload } = summarizeZipExport(result);
        if (shouldDownload) {
          const zipBlob = await zip.generateAsync({ type: "blob" });
          const blobUrl = window.URL.createObjectURL(zipBlob);
          const link = document.createElement("a");
          link.href = blobUrl;
          link.download = `${folderExportData.folderName}.zip`;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          window.URL.revokeObjectURL(blobUrl);
        }
        if (outcome === "cancelled") toast.info(message);
        else if (outcome === "failure") toast.error(message);
        else if (outcome === "partial") toast.warning(message);
        else toast.success(message);
      } catch (error) {
        if (signal.aborted || (error instanceof Error && error.message === "Export cancelled")) toast.info("Export cancelled");
        else toast.error("Export failed");
      } finally {
        setIsExporting(false);
        setExportProgress({ current: 0, total: 0 });
        exportAbortController.current = null;
      }
    } else {
      const photo = photosToExport[0];
      const file = filesToExport[0];
      if (photo) await downloadPhotoFile(photo.file_url, photo.title || `photo-${photo.id}.jpg`);
      else if (file) await downloadFile(file.file_url, file.name || "file");
      if (photo || file) toast.success("Downloaded file");
    }
    setFolderExportData(null);
  }, [downloadFile, downloadPhotoFile, folderExportData]);

  const filteredExportData = useMemo(() => excludeVaultExportFolders(
    exportPreviewData.photos,
    exportPreviewData.files,
    excludedFolders,
  ), [excludedFolders, exportPreviewData.files, exportPreviewData.photos]);

  const toggleFolderExclusion = useCallback((folderPath: string) => {
    setExcludedFolders(current => toggleVaultExportSelection(current, folderPath));
  }, []);

  const exportSummary = useMemo(() => summarizeVaultExport(
    selectionMode, photos, files, selectedPhotos, selectedFiles,
  ), [files, photos, selectedFiles, selectedPhotos, selectionMode]);

  const exportAsZip = useCallback(async (includeSubfolders = false) => {
    const scope = scopeForView(currentView);
    let photosToExport: VaultExportPhoto[] = [];
    let filesToExport: VaultExportFile[] = [];
    if (selectionMode) {
      const selected = getSelectedItems();
      photosToExport = selected.photos.map(photo => ({ ...photo, path: "" }));
      filesToExport = selected.files.map(file => ({ ...file, path: "" }));
    } else if (includeSubfolders && currentView.type !== "root") {
      toast.info("Scanning folders...");
      const allContents = await collectVaultExportContents(scope, "");
      photosToExport = allContents.photos;
      filesToExport = allContents.files;
    } else {
      photosToExport = photos.map(photo => ({ ...photo, path: "" }));
      filesToExport = files.map(file => ({ ...file, path: "" }));
    }
    if (!photosToExport.length && !filesToExport.length) {
      toast.error(selectionMode ? "No files selected" : "No files to export");
      return;
    }
    exportAbortController.current = new AbortController();
    const signal = exportAbortController.current.signal;
    const totalFiles = photosToExport.length + filesToExport.length;
    setExportProgress({ current: 0, total: totalFiles });
    setIsExporting(true);
    try {
      const zip = await createZipArchive();
      let fileCount = 0;
      for (const photo of photosToExport) {
        if (signal.aborted) throw new Error("Export cancelled");
        try {
          const response = await fetch(photo.file_url, { signal });
          const blob = await response.blob();
          zip.file(photo.path ? `${photo.path}/${photo.title || `photo-${photo.id}.jpg`}` : photo.title || `photo-${photo.id}.jpg`, blob);
          fileCount++;
          setExportProgress({ current: fileCount, total: totalFiles });
        } catch (error) {
          if (error instanceof Error && (error.name === "AbortError" || signal.aborted)) throw new Error("Export cancelled");
          console.error(`Failed to fetch photo: ${photo.id}`, error);
        }
      }
      for (const file of filesToExport) {
        if (signal.aborted) throw new Error("Export cancelled");
        try {
          const response = await fetch(file.file_url, { signal });
          const blob = await response.blob();
          zip.file(file.path ? `${file.path}/${file.name}` : file.name, blob);
          fileCount++;
          setExportProgress({ current: fileCount, total: totalFiles });
        } catch (error) {
          if (error instanceof Error && (error.name === "AbortError" || signal.aborted)) throw new Error("Export cancelled");
          console.error(`Failed to fetch file: ${file.id}`, error);
        }
      }
      if (fileCount === 0) {
        toast.error("No files could be added to ZIP");
        return;
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const blobUrl = window.URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${folderNameForView(currentView, selectionMode)}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success(`Exported ${fileCount} files as ZIP`);
      if (selectionMode) exitSelectionMode();
    } catch (error) {
      if (error instanceof Error && error.message === "Export cancelled") toast.info("Export cancelled");
      else {
        console.error("ZIP export failed:", error);
        toast.error("Failed to create ZIP file");
      }
    } finally {
      setIsExporting(false);
      setExportProgress({ current: 0, total: 0 });
      exportAbortController.current = null;
    }
  }, [currentView, exitSelectionMode, files, getSelectedItems, photos, selectionMode]);

  const confirmExportWithSubfolders = useCallback(async () => {
    setExportPreviewOpen(false);
    const { photos: photosToExport, files: filesToExport } = filteredExportData;
    if (!photosToExport.length && !filesToExport.length) {
      toast.error("No files to export");
      return;
    }
    exportAbortController.current = new AbortController();
    const signal = exportAbortController.current.signal;
    const totalFiles = photosToExport.length + filesToExport.length;
    setExportProgress({ current: 0, total: totalFiles });
    setIsExporting(true);
    try {
      const zip = await createZipArchive();
      let fileCount = 0;
      for (const photo of photosToExport) {
        if (signal.aborted) throw new Error("Export cancelled");
        try {
          const response = await fetch(photo.file_url, { signal });
          const blob = await response.blob();
          zip.file(photo.path ? `${photo.path}/${photo.title || `photo-${photo.id}.jpg`}` : photo.title || `photo-${photo.id}.jpg`, blob);
          fileCount++;
          setExportProgress({ current: fileCount, total: totalFiles });
        } catch (error) {
          if (error instanceof Error && (error.name === "AbortError" || signal.aborted)) throw new Error("Export cancelled");
          console.error(`Failed to fetch photo: ${photo.id}`, error);
        }
      }
      for (const file of filesToExport) {
        if (signal.aborted) throw new Error("Export cancelled");
        try {
          const response = await fetch(file.file_url, { signal });
          const blob = await response.blob();
          zip.file(file.path ? `${file.path}/${file.name}` : file.name, blob);
          fileCount++;
          setExportProgress({ current: fileCount, total: totalFiles });
        } catch (error) {
          if (error instanceof Error && (error.name === "AbortError" || signal.aborted)) throw new Error("Export cancelled");
          console.error(`Failed to fetch file: ${file.id}`, error);
        }
      }
      if (fileCount === 0) {
        toast.error("No files could be added to ZIP");
        return;
      }
      const zipBlob = await zip.generateAsync({ type: "blob" });
      const folderName = folderNameForView(currentView);
      const blobUrl = window.URL.createObjectURL(zipBlob);
      const link = document.createElement("a");
      link.href = blobUrl;
      link.download = `${folderName}.zip`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(blobUrl);
      toast.success(`Exported ${fileCount} files as ZIP`);
    } catch (error) {
      if (error instanceof Error && error.message === "Export cancelled") toast.info("Export cancelled");
      else {
        console.error("ZIP export failed:", error);
        toast.error("Failed to create ZIP file");
      }
    } finally {
      setIsExporting(false);
      setExportProgress({ current: 0, total: 0 });
      exportAbortController.current = null;
    }
  }, [currentView, filteredExportData]);

  const handleExportConfirm = useCallback(() => {
    if (!pendingExportAction) return;
    setExportConfirmOpen(false);
    if (pendingExportAction.type === "zip") void exportAsZip(false);
    else if (pendingExportAction.type === "download") void exportCurrentFolder();
    else if (pendingExportAction.type === "zipAll") void openExportPreview();
    setPendingExportAction(null);
  }, [exportAsZip, exportCurrentFolder, openExportPreview, pendingExportAction]);

  const initiateExport = useCallback((type: VaultExportAction["type"]) => {
    setPendingExportAction({ type });
    setExportConfirmOpen(true);
  }, []);

  return {
    isExporting,
    exportProgress,
    exportPreviewOpen,
    setExportPreviewOpen,
    exportPreviewData,
    excludedFolders,
    exportConfirmOpen,
    setExportConfirmOpen,
    pendingExportAction,
    setPendingExportAction,
    folderExportDialogOpen,
    setFolderExportDialogOpen,
    folderExportData,
    setFolderExportData,
    filteredExportData,
    exportSummary,
    cancelExport,
    initiateExport,
    handleExportConfirm,
    exportCurrentFolder,
    exportAsZip,
    openExportPreview,
    openFolderExportDialog,
    toggleFolderExclusion,
    confirmExportWithSubfolders,
    toggleFolderExportPhotoSelection,
    toggleFolderExportFileSelection,
    selectAllFolderExportItems,
    deselectAllFolderExportItems,
    exportSelectedFolderItems,
  };
}
