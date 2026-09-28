import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { UseMutationResult } from "@tanstack/react-query";
import type { FolderView } from "@/features/vault/useVaultExport";

const AddLinkDialog = lazyWithRetry(() =>
  import("@/components/vault/AddLinkDialog").then((m) => ({ default: m.AddLinkDialog })),
);
const GoogleDriveImportDialog = lazyWithRetry(() =>
  import("@/components/vault/GoogleDriveImportDialog").then((m) => ({ default: m.GoogleDriveImportDialog })),
);
const LinkDriveFolderDialog = lazyWithRetry(() =>
  import("@/components/vault/LinkDriveFolderDialog").then((m) => ({ default: m.LinkDriveFolderDialog })),
);

// Every dialog in this cluster only ever renders once `currentView` has
// resolved past the Vault root (the page renders none of them on the root
// picker screen), so club/team/mini-league's `clubId`/`folderId` are always
// present here.
type NonRootFolderView = Exclude<FolderView, { type: "root" }>;

export interface VaultDriveLinkDialogsProps {
  currentView: NonRootFolderView;

  addLinkDialogOpen: boolean;
  onAddLinkDialogOpenChange: (open: boolean) => void;
  addLinkMutation: UseMutationResult<void, unknown, { url: string; name: string }>;

  googleDriveImportOpen: boolean;
  onGoogleDriveImportOpenChange: (open: boolean) => void;

  linkDriveFolderOpen: boolean;
  onLinkDriveFolderOpenChange: (open: boolean) => void;

  /** Shared by the import-complete and folder-link-changed callbacks — both
   * refresh the same files/vault-folders caches today. */
  onDriveChanged: () => void;
}

function vaultDriveLinkTargetName(currentView: NonRootFolderView): string {
  return (
    currentView.folderName ||
    (currentView.type === "team"
      ? currentView.teamName
      : currentView.type === "club"
        ? currentView.clubName
        : "Vault")
  );
}

/**
 * Owns Vault's Add Link / Google Drive import / Drive folder-link dialogs.
 * Each dialog's open/close and confirm wiring is driven by the narrow
 * callback contract from `useVaultDriveLinkWorkflow`; this component holds
 * no state of its own beyond the target-name/target-scope derivations that
 * only this cluster's dialogs need.
 */
export function VaultDriveLinkDialogs({
  currentView,
  addLinkDialogOpen,
  onAddLinkDialogOpenChange,
  addLinkMutation,
  googleDriveImportOpen,
  onGoogleDriveImportOpenChange,
  linkDriveFolderOpen,
  onLinkDriveFolderOpenChange,
  onDriveChanged,
}: VaultDriveLinkDialogsProps) {
  return (
    <>
      <Suspense fallback={null}>
        <AddLinkDialog
          open={addLinkDialogOpen}
          onOpenChange={onAddLinkDialogOpenChange}
          onAddLink={(url, name) => addLinkMutation.mutate({ url, name })}
          isAdding={addLinkMutation.isPending}
          targetName={vaultDriveLinkTargetName(currentView)}
        />
      </Suspense>

      <Suspense fallback={null}>
        <GoogleDriveImportDialog
          open={googleDriveImportOpen}
          onOpenChange={onGoogleDriveImportOpenChange}
          onImportComplete={onDriveChanged}
          targetFolderId={currentView.type === "team" || currentView.type === "mini-league" ? (currentView.folderId || null) : null}
          targetTeamId={currentView.type === "team" ? currentView.teamId : null}
          targetClubId={currentView.clubId}
        />
      </Suspense>

      {'clubId' in currentView && (
        <Suspense fallback={null}>
          <LinkDriveFolderDialog
            open={linkDriveFolderOpen}
            onOpenChange={onLinkDriveFolderOpenChange}
            vaultFolderId={currentView.folderId ?? null}
            clubId={currentView.clubId}
            teamId={currentView.type === "team" ? currentView.teamId : null}
            onChanged={onDriveChanged}
          />
        </Suspense>
      )}
    </>
  );
}
