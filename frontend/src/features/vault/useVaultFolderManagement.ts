import { useCallback, useState } from "react";
import { useMutation, type QueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  createVaultFolder,
  deleteVaultFolder,
  moveVaultFile,
  renameVaultFolder,
  renameVaultItem,
} from "./vaultMutationRepository";
import { invalidateVaultCache } from "./vaultQueryKeys";
import { abbreviateVaultOrganisationName } from "./vaultScope";
import type { FolderView } from "./useVaultExport";

export interface VaultFolderPathEntry {
  id: string;
  name: string;
}

export interface VaultFileToMove {
  id: string;
  name: string;
  folder_id: string | null;
  team_id?: string | null;
}

// Looser than `VaultFileToMove`: callers such as `ContentSectionProps`'s
// `VaultFile` only guarantee `folder_id`/`team_id` through an index
// signature, not as an explicit required property.
export interface VaultMoveFileSource {
  id: string;
  name: string;
  folder_id?: string | null;
  team_id?: string | null;
}

export interface VaultFolderHierarchyNode {
  key: string;
  label: string;
  onClick?: () => void;
}

export interface UseVaultFolderManagementOptions {
  currentView: FolderView;
  setCurrentView: (view: FolderView) => void;
  fromChat: boolean;
  navigate: (delta: number) => void;
  getCurrentFolderId: () => string | null;
  userId: string | undefined;
  queryClient: QueryClient;
}

/**
 * Owns Vault's folder/file management: the `folderPath` breadcrumb trail,
 * create/delete/rename/move dialog state and mutations, and the navigation
 * helpers that transition `currentView` alongside `folderPath`.
 *
 * `currentView` itself stays owned by the page — it is also driven by
 * URL/query-param deep links and the root club/team/mini-league picker — so
 * this hook receives it and its setter as a stable input/output contract
 * instead of owning that state itself. `setFolderPath` is likewise exposed so
 * the page's URL-driven folder loader (which resolves a deep-linked folder's
 * full parent chain) can seed the breadcrumb trail directly.
 */
export function useVaultFolderManagement({
  currentView,
  setCurrentView,
  fromChat,
  navigate,
  getCurrentFolderId,
  userId,
  queryClient,
}: UseVaultFolderManagementOptions) {
  const [folderPath, setFolderPath] = useState<VaultFolderPathEntry[]>([]);
  const [newFolderDialogOpen, setNewFolderDialogOpen] = useState(false);
  const [deleteFolderId, setDeleteFolderId] = useState<string | null>(null);
  const [renameFolderId, setRenameFolderId] = useState<string | null>(null);
  const [renameFolderName, setRenameFolderName] = useState("");
  const [renameFileId, setRenameFileId] = useState<string | null>(null);
  const [renameFileName, setRenameFileName] = useState("");
  const [renamePhotoId, setRenamePhotoId] = useState<string | null>(null);
  const [renamePhotoName, setRenamePhotoName] = useState("");
  const [moveFileDialogOpen, setMoveFileDialogOpen] = useState(false);
  const [fileToMove, setFileToMove] = useState<VaultFileToMove | null>(null);

  const createFolderMutation = useMutation({
    mutationFn: async (name: string) => {
      await createVaultFolder({
        name,
        userId: userId!,
        parentFolderId: getCurrentFolderId(),
        view: currentView,
      });
    },
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["subfolders"]);
      setNewFolderDialogOpen(false);
      toast.success("Folder created!");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to create folder");
    },
  });

  const deleteFolderMutation = useMutation({
    mutationFn: async (folderId: string) => {
      await deleteVaultFolder(folderId);
    },
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["subfolders"]);
      setDeleteFolderId(null);
      toast.success("Folder deleted");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to delete folder");
    },
  });

  const renameFolderMutation = useMutation({
    mutationFn: async ({ folderId, newName }: { folderId: string; newName: string }) => {
      await renameVaultFolder(folderId, newName);
    },
    onSuccess: (_, variables) => {
      invalidateVaultCache(queryClient, ["subfolders"]);
      // Update folder path if renamed folder is in the path
      setFolderPath(prev => prev.map(f => f.id === variables.folderId ? { ...f, name: variables.newName } : f));
      setRenameFolderId(null);
      setRenameFolderName("");
      toast.success("Folder renamed");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to rename folder");
    },
  });

  const renameFileMutation = useMutation({
    mutationFn: async ({ fileId, newName }: { fileId: string; newName: string }) => {
      await renameVaultItem(fileId, newName);
    },
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["files"]);
      setRenameFileId(null);
      setRenameFileName("");
      toast.success("File renamed");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to rename file");
    },
  });

  // Vault photos are stored in vault_files, so rename updates vault_files.name
  const renamePhotoMutation = useMutation({
    mutationFn: async ({ photoId, newName }: { photoId: string; newName: string }) => {
      await renameVaultItem(photoId, newName);
    },
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["files"]);
      setRenamePhotoId(null);
      setRenamePhotoName("");
      toast.success("Photo renamed");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to rename photo");
    },
  });

  const moveFileMutation = useMutation({
    mutationFn: async ({ fileId, targetFolderId, targetTeamId }: { fileId: string; targetFolderId: string | null; targetTeamId?: string | null }) => {
      await moveVaultFile({ fileId, targetFolderId, targetTeamId });
    },
    onSuccess: () => {
      invalidateVaultCache(queryClient, ["files"]);
      setMoveFileDialogOpen(false);
      setFileToMove(null);
      toast.success("File moved successfully");
    },
    onError: (error: any) => {
      toast.error(error.message || "Failed to move file");
    },
  });

  const requestDeleteFolder = useCallback((folder: { id: string }) => {
    setDeleteFolderId(folder.id);
  }, []);

  const cancelDeleteFolder = useCallback(() => {
    setDeleteFolderId(null);
  }, []);

  const confirmDeleteFolder = useCallback(() => {
    if (deleteFolderId) deleteFolderMutation.mutate(deleteFolderId);
  }, [deleteFolderId, deleteFolderMutation]);

  const startRenameFolder = useCallback((folder: { id: string; name: string }) => {
    setRenameFolderId(folder.id);
    setRenameFolderName(folder.name);
  }, []);

  const cancelRenameFolder = useCallback(() => {
    setRenameFolderId(null);
    setRenameFolderName("");
  }, []);

  const confirmRenameFolder = useCallback(() => {
    if (renameFolderId) renameFolderMutation.mutate({ folderId: renameFolderId, newName: renameFolderName });
  }, [renameFolderId, renameFolderName, renameFolderMutation]);

  const startRenameFile = useCallback((file: { id: string; name: string }) => {
    setRenameFileId(file.id);
    setRenameFileName(file.name);
  }, []);

  const cancelRenameFile = useCallback(() => {
    setRenameFileId(null);
    setRenameFileName("");
  }, []);

  const confirmRenameFile = useCallback(() => {
    if (renameFileId) renameFileMutation.mutate({ fileId: renameFileId, newName: renameFileName });
  }, [renameFileId, renameFileName, renameFileMutation]);

  const startRenamePhoto = useCallback((photo: { id: string; title?: string | null }) => {
    setRenamePhotoId(photo.id);
    setRenamePhotoName(photo.title || "");
  }, []);

  const cancelRenamePhoto = useCallback(() => {
    setRenamePhotoId(null);
    setRenamePhotoName("");
  }, []);

  const confirmRenamePhoto = useCallback(() => {
    if (renamePhotoId) renamePhotoMutation.mutate({ photoId: renamePhotoId, newName: renamePhotoName });
  }, [renamePhotoId, renamePhotoName, renamePhotoMutation]);

  const startMoveFile = useCallback((file: VaultMoveFileSource) => {
    setFileToMove({ id: file.id, name: file.name, folder_id: file.folder_id ?? null, team_id: file.team_id });
    setMoveFileDialogOpen(true);
  }, []);

  const confirmMoveFile = useCallback((fileId: string, targetFolderId: string | null, targetTeamId?: string | null) => {
    moveFileMutation.mutate({ fileId, targetFolderId, targetTeamId });
  }, [moveFileMutation]);

  const navigateToFolder = useCallback((folder: VaultFolderPathEntry) => {
    if (currentView.type === "club") {
      setFolderPath([...folderPath, folder]);
      setCurrentView({
        ...currentView,
        folderId: folder.id,
        folderName: folder.name,
      });
    } else if (currentView.type === "team") {
      setFolderPath([...folderPath, folder]);
      setCurrentView({
        ...currentView,
        folderId: folder.id,
        folderName: folder.name,
      });
    }
  }, [currentView, folderPath, setCurrentView]);

  const goBack = useCallback(() => {
    if (fromChat) {
      navigate(-1);
      return;
    }
    if (folderPath.length > 0) {
      const newPath = [...folderPath];
      newPath.pop();
      setFolderPath(newPath);
      const parentFolder = newPath[newPath.length - 1];

      if (currentView.type === "club") {
        setCurrentView({
          ...currentView,
          folderId: parentFolder?.id,
          folderName: parentFolder?.name,
        });
      } else if (currentView.type === "team") {
        setCurrentView({
          ...currentView,
          folderId: parentFolder?.id,
          folderName: parentFolder?.name,
        });
      } else if (currentView.type === "mini-league") {
        setCurrentView({
          ...currentView,
          folderId: parentFolder?.id,
          folderName: parentFolder?.name,
        });
      }
    } else if (currentView.type === "team") {
      setCurrentView({ type: "club", clubId: currentView.clubId, clubName: currentView.clubName });
    } else if (currentView.type === "mini-league") {
      setCurrentView({ type: "club", clubId: currentView.clubId, clubName: currentView.clubName });
    } else {
      setCurrentView({ type: "root" });
    }
  }, [fromChat, navigate, folderPath, currentView, setCurrentView]);

  const navigateToRoot = useCallback(() => {
    setFolderPath([]);
    setCurrentView({ type: "root" });
  }, [setCurrentView]);

  const navigateToClub = useCallback(() => {
    if (currentView.type === "club" || currentView.type === "team" || currentView.type === "mini-league") {
      setFolderPath([]);
      setCurrentView({
        type: "club",
        clubId: currentView.clubId,
        clubName: currentView.clubName,
      });
    }
  }, [currentView, setCurrentView]);

  const navigateToMiniLeague = useCallback(() => {
    if (currentView.type === "mini-league") {
      setFolderPath([]);
      setCurrentView({
        type: "mini-league",
        clubId: currentView.clubId,
        clubName: currentView.clubName,
        miniLeagueId: currentView.miniLeagueId,
        miniLeagueName: currentView.miniLeagueName,
      });
    }
  }, [currentView, setCurrentView]);

  const navigateToTeam = useCallback(() => {
    if (currentView.type === "team") {
      setFolderPath([]);
      setCurrentView({
        type: "team",
        clubId: currentView.clubId,
        clubName: currentView.clubName,
        teamId: currentView.teamId,
        teamName: currentView.teamName,
      });
    }
  }, [currentView, setCurrentView]);

  const navigateToFolderAtIndex = useCallback((index: number) => {
    const newPath = folderPath.slice(0, index + 1);
    const targetFolder = newPath[index];
    setFolderPath(newPath);

    if (currentView.type === "club") {
      setCurrentView({
        ...currentView,
        folderId: targetFolder.id,
        folderName: targetFolder.name,
      });
    } else if (currentView.type === "team") {
      setCurrentView({
        ...currentView,
        folderId: targetFolder.id,
        folderName: targetFolder.name,
      });
    }
  }, [folderPath, currentView, setCurrentView]);

  // Mobile-first hierarchy: returns an ordered list of nodes that represent
  // the current vault location. The last node is the "current" page (rendered
  // as a large title); the rest become clickable chips in the secondary path.
  const getHierarchyNodes = useCallback((): VaultFolderHierarchyNode[] => {
    const nodes: VaultFolderHierarchyNode[] = [];

    // Vault root chip — only shown when we're past it.
    nodes.push({ key: "vault", label: "Vault", onClick: navigateToRoot });

    if (currentView.type === "club" || currentView.type === "team") {
      nodes.push({
        key: "club",
        label: abbreviateVaultOrganisationName(currentView.clubName || "Club"),
        onClick: navigateToClub,
      });
    }

    if (currentView.type === "team") {
      nodes.push({
        key: "team",
        label: currentView.teamName || "Team",
        onClick: navigateToTeam,
      });
    }

    if (currentView.type === "mini-league") {
      nodes.push({
        key: "mini-league",
        label: currentView.miniLeagueName || "League",
        onClick: navigateToMiniLeague,
      });
    }

    folderPath.forEach((folder, index) => {
      nodes.push({
        key: `folder-${folder.id}`,
        label: folder.name,
        onClick: () => navigateToFolderAtIndex(index),
      });
    });

    return nodes;
  }, [currentView, folderPath, navigateToRoot, navigateToClub, navigateToTeam, navigateToMiniLeague, navigateToFolderAtIndex]);

  return {
    folderPath,
    setFolderPath,

    newFolderDialogOpen,
    setNewFolderDialogOpen,

    deleteFolderId,
    requestDeleteFolder,
    cancelDeleteFolder,
    confirmDeleteFolder,

    renameFolderId,
    renameFolderName,
    setRenameFolderName,
    startRenameFolder,
    cancelRenameFolder,
    confirmRenameFolder,

    renameFileId,
    renameFileName,
    setRenameFileName,
    startRenameFile,
    cancelRenameFile,
    confirmRenameFile,

    renamePhotoId,
    renamePhotoName,
    setRenamePhotoName,
    startRenamePhoto,
    cancelRenamePhoto,
    confirmRenamePhoto,

    moveFileDialogOpen,
    setMoveFileDialogOpen,
    fileToMove,
    startMoveFile,
    confirmMoveFile,

    createFolderMutation,
    deleteFolderMutation,
    renameFolderMutation,
    renameFileMutation,
    renamePhotoMutation,
    moveFileMutation,

    navigateToFolder,
    goBack,
    navigateToRoot,
    navigateToClub,
    navigateToMiniLeague,
    navigateToTeam,
    navigateToFolderAtIndex,
    getHierarchyNodes,
  };
}
