import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type { RecapScopeRef } from "@/components/chat/GlobalChatRecapSheet";

const GlobalChatRecapSheet = lazyWithRetry(() =>
  import("@/components/chat/GlobalChatRecapSheet").then((module) => ({
    default: module.GlobalChatRecapSheet,
  })),
);
const StartDMDialog = lazyWithRetry(() =>
  import("@/components/chat/StartDMDialog").then((module) => ({
    default: module.StartDMDialog,
  })),
);
const CreateGroupDialog = lazyWithRetry(() => import("@/components/chat/CreateGroupDialog"));
const NewMessageSheet = lazyWithRetry(() =>
  import("@/components/chat/NewMessageSheet").then((module) => ({
    default: module.NewMessageSheet,
  })),
);

interface MessagesPageDialogsProps {
  showGlobalRecap: boolean;
  recapScopes: RecapScopeRef[];
  onShowGlobalRecapChange: (open: boolean) => void;
  showNewMessageSheet: boolean;
  onShowNewMessageSheetChange: (open: boolean) => void;
  canCreateGroups: boolean;
  canCreateCustomGroup: boolean;
  hasPro: boolean;
  isAppAdmin: boolean;
  upgradeClubId: string | null;
  onPickDM: () => void;
  onPickCustomGroup: () => void;
  onPickTeamGroup: () => void;
  onPickRoleGroup: () => void;
  showDMDialog: boolean;
  onShowDMDialogChange: (open: boolean) => void;
  showCustomGroupDialog: boolean;
  onShowCustomGroupDialogChange: (open: boolean) => void;
  showGroupDialog: boolean;
  onShowGroupDialogChange: (open: boolean) => void;
  groupDialogType: "role" | "team";
}

export function MessagesPageDialogs({
  showGlobalRecap,
  recapScopes,
  onShowGlobalRecapChange,
  showNewMessageSheet,
  onShowNewMessageSheetChange,
  canCreateGroups,
  canCreateCustomGroup,
  hasPro,
  isAppAdmin,
  upgradeClubId,
  onPickDM,
  onPickCustomGroup,
  onPickTeamGroup,
  onPickRoleGroup,
  showDMDialog,
  onShowDMDialogChange,
  showCustomGroupDialog,
  onShowCustomGroupDialogChange,
  showGroupDialog,
  onShowGroupDialogChange,
  groupDialogType,
}: MessagesPageDialogsProps) {
  return (
    <>
      {showGlobalRecap && (
        <Suspense fallback={null}>
          <GlobalChatRecapSheet
            open={showGlobalRecap}
            onOpenChange={onShowGlobalRecapChange}
            scopes={recapScopes}
          />
        </Suspense>
      )}

      {showNewMessageSheet && (
        <Suspense fallback={null}>
          <NewMessageSheet
            open={showNewMessageSheet}
            onOpenChange={onShowNewMessageSheetChange}
            canCreateGroups={canCreateGroups}
            canCreateCustomGroup={canCreateCustomGroup}
            hasPro={hasPro}
            isAppAdmin={isAppAdmin}
            upgradeClubId={upgradeClubId}
            onPickDM={onPickDM}
            onPickCustom={onPickCustomGroup}
            onPickTeam={onPickTeamGroup}
            onPickRole={onPickRoleGroup}
          />
        </Suspense>
      )}

      {(hasPro || isAppAdmin) && showDMDialog && (
        <Suspense fallback={null}>
          <StartDMDialog open={showDMDialog} onOpenChange={onShowDMDialogChange} mode="dm" />
        </Suspense>
      )}
      {(hasPro || isAppAdmin) && showCustomGroupDialog && (
        <Suspense fallback={null}>
          <StartDMDialog
            open={showCustomGroupDialog}
            onOpenChange={onShowCustomGroupDialogChange}
            mode="custom-group"
            allowCategory={canCreateGroups}
          />
        </Suspense>
      )}
      {canCreateGroups && showGroupDialog && (
        <Suspense fallback={null}>
          <CreateGroupDialog
            open={showGroupDialog}
            onOpenChange={onShowGroupDialogChange}
            groupType={groupDialogType}
          />
        </Suspense>
      )}
    </>
  );
}
