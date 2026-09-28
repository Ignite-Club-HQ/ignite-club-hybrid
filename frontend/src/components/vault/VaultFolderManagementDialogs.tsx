import { Suspense } from "react";
import { CreateFolderDialog } from "@/components/vault/CreateFolderDialog";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

// Kept lazy to preserve the pre-extraction Move File chunk boundary — this
// component only relocates the existing import, it does not add a new one.
const MoveFileDialog = lazyWithRetry(() =>
  import("@/components/vault/MoveFileDialog").then((m) => ({ default: m.MoveFileDialog })),
);

interface VaultFileToMoveTarget {
  id: string;
  name: string;
  folder_id: string | null;
  team_id?: string | null;
}

export interface VaultFolderManagementDialogsProps {
  newFolderDialogOpen: boolean;
  onNewFolderDialogOpenChange: (open: boolean) => void;
  onCreateFolder: (name: string) => void;
  isCreatingFolder: boolean;

  deleteFolderId: string | null;
  onCancelDeleteFolder: () => void;
  onConfirmDeleteFolder: () => void;

  renameFolderId: string | null;
  renameFolderName: string;
  onRenameFolderNameChange: (name: string) => void;
  onCancelRenameFolder: () => void;
  onConfirmRenameFolder: () => void;

  renameFileId: string | null;
  renameFileName: string;
  onRenameFileNameChange: (name: string) => void;
  onCancelRenameFile: () => void;
  onConfirmRenameFile: () => void;

  renamePhotoId: string | null;
  renamePhotoName: string;
  onRenamePhotoNameChange: (name: string) => void;
  onCancelRenamePhoto: () => void;
  onConfirmRenamePhoto: () => void;

  moveFileDialogOpen: boolean;
  onMoveFileDialogOpenChange: (open: boolean) => void;
  fileToMove: VaultFileToMoveTarget | null;
  moveTeamId: string | null;
  moveClubId: string | null;
  onMoveFile: (fileId: string, targetFolderId: string | null, targetTeamId?: string | null) => void;
  isMovingFile: boolean;
}

/**
 * Owns Vault's folder/file management dialogs: create folder, delete folder
 * confirmation, rename folder/file/photo, and move file. Each dialog's
 * open/close and confirm wiring is driven by the narrow callback contract
 * from `useVaultFolderManagement`; this component holds no state of its own.
 */
export function VaultFolderManagementDialogs({
  newFolderDialogOpen,
  onNewFolderDialogOpenChange,
  onCreateFolder,
  isCreatingFolder,
  deleteFolderId,
  onCancelDeleteFolder,
  onConfirmDeleteFolder,
  renameFolderId,
  renameFolderName,
  onRenameFolderNameChange,
  onCancelRenameFolder,
  onConfirmRenameFolder,
  renameFileId,
  renameFileName,
  onRenameFileNameChange,
  onCancelRenameFile,
  onConfirmRenameFile,
  renamePhotoId,
  renamePhotoName,
  onRenamePhotoNameChange,
  onCancelRenamePhoto,
  onConfirmRenamePhoto,
  moveFileDialogOpen,
  onMoveFileDialogOpenChange,
  fileToMove,
  moveTeamId,
  moveClubId,
  onMoveFile,
  isMovingFile,
}: VaultFolderManagementDialogsProps) {
  return (
    <>
      <CreateFolderDialog
        open={newFolderDialogOpen}
        onOpenChange={onNewFolderDialogOpenChange}
        onCreateFolder={onCreateFolder}
        isCreating={isCreatingFolder}
      />

      <AlertDialog open={!!deleteFolderId} onOpenChange={() => onCancelDeleteFolder()}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Folder</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete this folder? Files inside will be moved to the parent folder.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={onConfirmDeleteFolder}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rename Folder Dialog */}
      <Dialog open={!!renameFolderId} onOpenChange={(open) => {
        if (!open) onCancelRenameFolder();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Folder</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Folder Name</Label>
              <Input
                value={renameFolderName}
                onChange={(e) => onRenameFolderNameChange(e.target.value)}
                placeholder="Enter new folder name"
              />
            </div>
            <Button
              onClick={onConfirmRenameFolder}
              disabled={!renameFolderName.trim()}
              className="w-full"
            >
              Rename Folder
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename File Dialog */}
      <Dialog open={!!renameFileId} onOpenChange={(open) => {
        if (!open) onCancelRenameFile();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename File</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>File Name</Label>
              <Input
                value={renameFileName}
                onChange={(e) => onRenameFileNameChange(e.target.value)}
                placeholder="Enter new file name"
              />
            </div>
            <Button
              onClick={onConfirmRenameFile}
              disabled={!renameFileName.trim()}
              className="w-full"
            >
              Rename File
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Rename Photo Dialog */}
      <Dialog open={!!renamePhotoId} onOpenChange={(open) => {
        if (!open) onCancelRenamePhoto();
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Rename Photo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label>Photo Title</Label>
              <Input
                value={renamePhotoName}
                onChange={(e) => onRenamePhotoNameChange(e.target.value)}
                placeholder="Enter new photo title"
              />
            </div>
            <Button
              onClick={onConfirmRenamePhoto}
              disabled={!renamePhotoName.trim()}
              className="w-full"
            >
              Rename Photo
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Move File Dialog */}
      <Suspense fallback={null}>
        <MoveFileDialog
          open={moveFileDialogOpen}
          onOpenChange={onMoveFileDialogOpenChange}
          file={fileToMove}
          teamId={moveTeamId}
          clubId={moveClubId}
          onMove={onMoveFile}
          isMoving={isMovingFile}
        />
      </Suspense>
    </>
  );
}
