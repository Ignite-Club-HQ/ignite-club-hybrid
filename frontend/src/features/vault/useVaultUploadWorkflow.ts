import { useState } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { uploadVaultItem } from "./vaultUploadService";
import { invalidateVaultCache } from "./vaultQueryKeys";
import type { FolderView } from "./useVaultExport";

export interface UseVaultUploadWorkflowOptions {
  currentView: FolderView;
  getCurrentFolderId: () => string | null;
  userId: string | undefined;
  queryClient: QueryClient;
}

/**
 * Owns Vault's upload/file-name/quota-reservation cluster: the upload
 * dialog's open/uploading/upload-type/file-name state, the photo and file
 * upload mutations (each of which reserves quota before any bytes are
 * written via the tested `uploadVaultItem`, then settles or compensates the
 * reservation depending on the storage-upload/metadata-insert outcome), and
 * both the raw-file-input and dialog upload handlers.
 *
 * `currentView` stays page-owned (it is shared with folder navigation, Drive
 * import, and export) — this hook receives it as a readonly input instead of
 * owning it, matching the contract used by the other extracted Vault
 * workflow hooks.
 */
export function useVaultUploadWorkflow({
  currentView,
  getCurrentFolderId,
  userId,
  queryClient,
}: UseVaultUploadWorkflowOptions) {
  const [uploadDialogOpen, setUploadDialogOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadType, setUploadType] = useState<"photo" | "file">("photo");
  const [fileName, setFileName] = useState("");

  // Vault photo uploads go to vault_files ONLY (not photos table).
  // This keeps vault photos separate from the media gallery.
  const uploadPhotoMutation = useMutation({
    mutationFn: async (file: File) => {
      await uploadVaultItem({
        kind: "photo",
        file,
        name: file.name,
        userId: userId!,
        folderId: getCurrentFolderId(),
        view: currentView,
      });
    },
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["files", "clubs", "storageBreakdown"]);
      setUploadDialogOpen(false);
      // No toast for successful photo uploads
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to upload photo");
    },
  });

  const uploadFileMutation = useMutation({
    mutationFn: async ({ file, customFileName }: { file: File; customFileName?: string }) => {
      await uploadVaultItem({
        kind: "file",
        file,
        name: customFileName || fileName || file.name,
        userId: userId!,
        folderId: getCurrentFolderId(),
        view: currentView,
      });
      // Note: Storage tracking is now per team, handled by the storage breakdown query
    },
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["files", "clubs", "storageBreakdown"]);
      invalidateVaultCache(queryClient, ["clubFreeUsage"]);
      setUploadDialogOpen(false);
      setFileName("");
      toast.success("File uploaded successfully!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to upload file");
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setUploading(true);
    if (uploadType === "photo") {
      await uploadPhotoMutation.mutateAsync(file);
    } else {
      await uploadFileMutation.mutateAsync({ file });
    }
    setUploading(false);
  };

  const handleDialogUpload = async (file: File, type: "photo" | "file", customFileName?: string) => {
    setUploading(true);
    try {
      if (type === "photo") {
        await uploadPhotoMutation.mutateAsync(file);
      } else {
        await uploadFileMutation.mutateAsync({ file, customFileName });
      }
    } finally {
      setUploading(false);
    }
  };

  return {
    uploadDialogOpen,
    setUploadDialogOpen,
    uploading,
    uploadType,
    setUploadType,
    fileName,
    setFileName,
    uploadPhotoMutation,
    uploadFileMutation,
    handleFileUpload,
    handleDialogUpload,
  };
}
