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

  // Show the item in the list straight away (local copy) while the real
  // upload finishes in the background, like chat photos.
  const matchesView = (key: readonly unknown[]) =>
    key[0] === "vault-files" && JSON.stringify(key[1]) === JSON.stringify(currentView);
  const addPlaceholder = (file: File, name: string, kind: "photo" | "file") => {
    const id = `pending-${crypto.randomUUID()}`;
    const row = {
      id,
      name: kind === "file" ? `${name} · uploading…` : name,
      file_url: URL.createObjectURL(file),
      file_type: file.type || null,
      file_size: file.size,
      folder_id: getCurrentFolderId(),
      club_id: currentView.type === "root" ? null : currentView.clubId,
      team_id: currentView.type === "team" ? currentView.teamId : null,
      mini_league_id: currentView.type === "mini-league" ? currentView.miniLeagueId : null,
      uploaded_by: userId ?? null,
      is_external_link: false,
      created_at: new Date().toISOString(),
      deleted_at: null,
    };
    queryClient.setQueriesData({ predicate: (q) => matchesView(q.queryKey) }, (old: unknown) =>
      Array.isArray(old) ? [row, ...old] : old,
    );
    return { id, url: row.file_url };
  };
  const removePlaceholder = (p: { id: string; url: string } | undefined) => {
    if (!p) return;
    queryClient.setQueriesData({ predicate: (q) => matchesView(q.queryKey) }, (old: unknown) =>
      Array.isArray(old) ? old.filter((r: { id?: string }) => r?.id !== p.id) : old,
    );
    setTimeout(() => URL.revokeObjectURL(p.url), 60_000);
  };

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
    onMutate: (file: File) => {
      setUploadDialogOpen(false);
      return addPlaceholder(file, file.name, "photo");
    },
    onSuccess: (_d, _v, placeholder) => {
      invalidateVaultCache(queryClient, ["files", "clubs", "storageBreakdown"]);
      removePlaceholder(placeholder);
      // No toast for successful photo uploads
    },
    onError: (error: any, _v, placeholder) => {
      removePlaceholder(placeholder);
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
    onMutate: ({ file, customFileName }) => {
      const placeholder = addPlaceholder(file, customFileName || fileName || file.name, "file");
      setUploadDialogOpen(false);
      setFileName("");
      return placeholder;
    },
    onSuccess: (_d, _v, placeholder) => {
      invalidateVaultCache(queryClient, ["files", "clubs", "storageBreakdown"]);
      invalidateVaultCache(queryClient, ["clubFreeUsage"]);
      removePlaceholder(placeholder);
      toast.success("File uploaded successfully!");
    },
    onError: (error: any, _v, placeholder) => {
      removePlaceholder(placeholder);
      toast.error(error.message || "Failed to upload file");
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Background upload: the item shows immediately, errors surface as a toast.
    if (uploadType === "photo") {
      uploadPhotoMutation.mutate(file);
    } else {
      uploadFileMutation.mutate({ file });
    }
  };

  const handleDialogUpload = async (file: File, type: "photo" | "file", customFileName?: string) => {
    if (type === "photo") {
      uploadPhotoMutation.mutate(file);
    } else {
      uploadFileMutation.mutate({ file, customFileName });
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
