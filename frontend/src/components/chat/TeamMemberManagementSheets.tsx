import { Suspense } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import AddRoleToMemberDialog from "@/components/AddRoleToMemberDialog";

const MemberDetailSheet = lazyWithRetry(() => import("@/components/MemberDetailSheet"));

export interface TeamChatSelectedMember {
  userId: string;
  displayName: string;
  avatarUrl?: string | null;
  roles: { id: string; role: string }[];
}

export interface TeamChatAddRoleMember {
  userId: string;
  userName: string;
  existingRoles: string[];
}

interface TeamMemberManagementSheetsProps {
  teamId: string;
  teamName: string;
  clubId?: string | null;
  currentUserId?: string;
  selectedMember: TeamChatSelectedMember | null;
  onSelectedMemberChange: (member: TeamChatSelectedMember | null) => void;
  addRoleMember: TeamChatAddRoleMember | null;
  onAddRoleMemberChange: (member: TeamChatAddRoleMember | null) => void;
  onRemoveMember: () => void;
  onRemoveRole: (roleItem: { id: string; role: string }) => void;
  onRoleDialogClosed: () => void;
}

/**
 * Wires up the "view member" and "add role to member" sheets/dialogs shared by
 * team chat's member-management flow. Extracted from TeamChatPage so the page
 * only owns the state and mutation callbacks; this component owns the
 * presentation and open/close wiring between the two.
 */
export function TeamMemberManagementSheets({
  teamId,
  teamName,
  clubId,
  currentUserId,
  selectedMember,
  onSelectedMemberChange,
  addRoleMember,
  onAddRoleMemberChange,
  onRemoveMember,
  onRemoveRole,
  onRoleDialogClosed,
}: TeamMemberManagementSheetsProps) {
  return (
    <>
      {selectedMember && (
        <Suspense fallback={null}>
          <MemberDetailSheet
            open={!!selectedMember}
            onOpenChange={(open) => {
              if (!open) onSelectedMemberChange(null);
            }}
            userId={selectedMember.userId}
            displayName={selectedMember.displayName}
            avatarUrl={selectedMember.avatarUrl}
            roles={selectedMember.roles}
            canManage={true}
            canMove={false}
            isSelf={selectedMember.userId === currentUserId}
            showMoveAction={false}
            showRemoveAction={false}
            onAddRole={() =>
              onAddRoleMemberChange({
                userId: selectedMember.userId,
                userName: selectedMember.displayName,
                existingRoles: selectedMember.roles.map((r) => r.role),
              })
            }
            onMove={() => {}}
            onRemove={onRemoveMember}
            onRemoveRole={onRemoveRole}
          />
        </Suspense>
      )}

      {addRoleMember && (
        <AddRoleToMemberDialog
          userId={addRoleMember.userId}
          userName={addRoleMember.userName}
          teamId={teamId}
          teamName={teamName}
          clubId={clubId}
          existingRoles={addRoleMember.existingRoles}
          open={!!addRoleMember}
          onOpenChange={(open) => {
            if (!open) {
              onAddRoleMemberChange(null);
              onRoleDialogClosed();
            }
          }}
        />
      )}
    </>
  );
}
