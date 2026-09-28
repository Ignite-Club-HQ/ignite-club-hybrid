import { Suspense } from "react";
import { Search, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { useNavigate } from "react-router-dom";
import { ChatHeaderShell } from "@/components/chat/ChatHeaderShell";
import { ChatDetailsSheet } from "@/components/chat/ChatDetailsSheet";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { ChatSearchBar } from "@/components/chat/ChatSearch";
import { Button } from "@/components/ui/button";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const AddTeamMemberSheet = lazyWithRetry(() => import("@/components/AddTeamMemberSheet"));

interface TeamChatHeaderTeam {
  id: string;
  name: string;
  logo_url?: string | null;
  club_id?: string | null;
  clubs?: { name?: string | null; logo_url?: string | null } | null;
  team_type?: string | null;
}

interface TeamChatPinnedVault {
  record: unknown;
  remove: () => void;
}

interface TeamChatHeaderSectionProps {
  team: TeamChatHeaderTeam;
  teamId: string;
  teamHeaderSublabel?: string;
  isAdmin: boolean;
  searchOpen: boolean;
  onSearchOpenChange: (open: boolean) => void;
  onSearch: (query: string) => void;
  isSearchFetching: boolean;
  membersOpen: boolean;
  onMembersOpenChange: (open: boolean) => void;
  inviteSheetOpen: boolean;
  onInviteSheetOpenChange: (open: boolean) => void;
  onManualRefresh: () => Promise<void>;
  isAnyRefreshing: boolean;
  scheduleMessageAvailable: boolean;
  onOpenScheduleDialog: () => void;
  scheduleMessageLocked: boolean;
  summarizeAvailable: boolean;
  onSummarizeMessages: () => void;
  summarizeLocked: boolean;
  pinnedVault: TeamChatPinnedVault;
  pinnedVaultLocked: boolean;
  onOpenPinVaultSheet: () => void;
}

/**
 * The team chat header: the ChatHeaderShell (search bar, invite/search
 * buttons, overflow menu), the "chat details" member sheet it opens, and the
 * lazily-loaded invite-member sheet. Extracted from TeamChatPage so the page
 * keeps only its state and mutation/query-driven callbacks; this component
 * owns the header's own open/close and locked-feature wiring.
 */
export function TeamChatHeaderSection({
  team,
  teamId,
  teamHeaderSublabel,
  isAdmin,
  searchOpen,
  onSearchOpenChange,
  onSearch,
  isSearchFetching,
  membersOpen,
  onMembersOpenChange,
  inviteSheetOpen,
  onInviteSheetOpenChange,
  onManualRefresh,
  isAnyRefreshing,
  scheduleMessageAvailable,
  onOpenScheduleDialog,
  scheduleMessageLocked,
  summarizeAvailable,
  onSummarizeMessages,
  summarizeLocked,
  pinnedVault,
  pinnedVaultLocked,
  onOpenPinVaultSheet,
}: TeamChatHeaderSectionProps) {
  const navigate = useNavigate();

  return (
    <>
      <ChatHeaderShell
        type="team"
        name={team.name}
        sublabel={teamHeaderSublabel}
        avatarUrl={team.logo_url || team.clubs?.logo_url}
        onOpenDetails={() => onMembersOpenChange(true)}
        leftSlot={
          <ChatSearchBar onSearch={onSearch} isOpen={searchOpen} onOpenChange={onSearchOpenChange} isSearching={isSearchFetching} />
        }
        rightSlot={
          <>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => onSearchOpenChange(true)} aria-label="Search messages">
              <Search className="h-4 w-4" />
            </Button>
            {isAdmin && (
              <Button
                variant="ghost"
                size="icon"
                className="h-9 w-9"
                onClick={() => onInviteSheetOpenChange(true)}
                aria-label={`Invite members to ${team.name}`}
              >
                <UserPlus className="h-[18px] w-[18px]" />
              </Button>
            )}
            <ChatHeaderMenu
              onRefresh={onManualRefresh}
              isRefreshing={isAnyRefreshing}
              onScheduleMessage={scheduleMessageAvailable ? onOpenScheduleDialog : undefined}
              scheduleMessageLocked={scheduleMessageLocked}
              onSummarizeMessages={summarizeAvailable ? onSummarizeMessages : undefined}
              summarizeLocked={summarizeLocked}
              onManagePinnedVault={
                isAdmin
                  ? () => {
                      if (pinnedVaultLocked) {
                        toast.info("Pinned vault is a Pro feature");
                        if (team?.club_id) navigate(`/clubs/${team.club_id}/upgrade`);
                        return;
                      }
                      onOpenPinVaultSheet();
                    }
                  : undefined
              }
              pinnedVaultLocked={!!isAdmin && pinnedVaultLocked}
              onUnpinVault={
                pinnedVault.record && isAdmin && !pinnedVaultLocked ? () => pinnedVault.remove() : undefined
              }
            />
          </>
        }
      />
      <ChatDetailsSheet
        open={membersOpen}
        onOpenChange={onMembersOpenChange}
        chatType="team"
        chatId={teamId}
        name={team.name}
        sublabel={team.clubs?.name ?? undefined}
        avatarUrl={team.logo_url || team.clubs?.logo_url}
        clubId={team.club_id || undefined}
        onInviteToTeam={() => {
          onMembersOpenChange(false);
          setTimeout(() => onInviteSheetOpenChange(true), 80);
        }}
      />
      {inviteSheetOpen && (
        <Suspense fallback={null}>
          <AddTeamMemberSheet
            teamId={teamId}
            teamName={team.name}
            clubId={team.club_id}
            teamType={(team.team_type as "junior" | "senior" | "mixed" | undefined) || "mixed"}
            canBulkInvite={!!isAdmin}
            triggerVariant="none"
            externalOpen={inviteSheetOpen}
            onExternalOpenChange={onInviteSheetOpenChange}
          />
        </Suspense>
      )}
    </>
  );
}
