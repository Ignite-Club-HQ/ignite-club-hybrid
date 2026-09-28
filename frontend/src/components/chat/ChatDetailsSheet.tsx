import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

import { ChevronRight, X, ImageIcon, Play, Loader2, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from "@/components/ui/sheet";
import { ConversationAvatar } from "@/components/chat/ConversationAvatar";
import { ChatParticipantsList } from "@/components/chat/ChatParticipantsList";
import { ChatGroupJoinRequests } from "@/components/chat/ChatGroupJoinRequests";
import { ChatMediaViewer } from "@/components/chat/ChatMediaViewer";
import { FullscreenImageViewer } from "@/components/chat/FullscreenImageViewer";
import { SecureImage } from "@/components/SecureImage";
import { useChatSharedMedia, type ChatSharedMediaType, type SharedMediaItem } from "@/hooks/useChatSharedMedia";
import { useIsMobile } from "@/hooks/use-mobile";
import { useAuth } from "@/hooks/useAuth";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { isVideoUrl } from "@/lib/videoUtils";
import { cn } from "@/lib/utils";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

export type ChatDetailsType = ChatSharedMediaType | "support";

interface ChatDetailsSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  chatType: ChatDetailsType;
  chatId: string;
  name: string;
  sublabel?: string | null;
  avatarUrl?: string | null;
  /** For team or group chats — enables "View team page" link */
  teamId?: string;
  /** For club, team, or group chats — enables "View club page" link */
  clubId?: string;
  /** For DM threads — used to render both participants */
  otherUserId?: string;
  /** For group chats — controls participant filtering */
  groupAllowedRoles?: string[];
  groupCreatedBy?: string | null;
  groupMembershipMode?: string | null;
  /** For mini-league chats — enables league-scoped participant query */
  miniLeagueId?: string;
  /** For competition chats — enables "View competition" link */
  competitionId?: string;
  /** Mini-league invite handler — shows an "Invite people" action when provided */
  onInviteToMiniLeague?: () => void;
  /** Team invite handler — shows an "Invite people" action when provided */
  onInviteToTeam?: () => void;
}

export function ChatDetailsSheet({
  open,
  onOpenChange,
  chatType,
  chatId,
  name,
  sublabel,
  avatarUrl,
  teamId,
  clubId,
  otherUserId,
  groupAllowedRoles,
  groupCreatedBy,
  groupMembershipMode,
  miniLeagueId,
  competitionId,
  onInviteToMiniLeague,
  onInviteToTeam,
}: ChatDetailsSheetProps) {
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const navigate = useNavigate();
  const isMobile = useIsMobile();
  const [mediaViewerOpen, setMediaViewerOpen] = useState(false);
  const [activeMedia, setActiveMedia] = useState<SharedMediaItem | null>(null);

  // Map "support" to "dm" for media + participant queries.
  const mediaType: ChatSharedMediaType =
    chatType === "support" ? "dm" : (chatType as ChatSharedMediaType);

  const { data: sharedMedia = [], isLoading: mediaLoading } = useChatSharedMedia(
    mediaType,
    chatId,
    // Scan a wider window of recent messages so the preview strip can show
    // up to 8 photos even when recent messages are mostly text/links.
    { limit: 80, enabled: open && !useIcpLab },
  );

  const close = () => onOpenChange(false);

  const handleNavigate = (path: string) => {
    onOpenChange(false);
    // Defer navigation slightly so the sheet can begin closing without
    // Radix dismiss handlers swallowing the click on touch devices.
    setTimeout(() => navigate(path), 80);
  };

  const showContextLinks = chatType === "team" || chatType === "club" || chatType === "group";
  const showParticipants =
    chatType === "team" || chatType === "club" || chatType === "group";

  // Resolve a clubId for Pro gating when not explicitly provided (e.g. team chats).
  const resolvedTeamIdForClub = chatType === "team" ? chatId : teamId;
  const { data: derivedClubId } = useQuery({
    queryKey: ["chat-details-sheet-club-id", resolvedTeamIdForClub, clubId, chatType, chatId],
    enabled: open && !useIcpLab && !clubId && (chatType === "team" || (chatType === "group" && !!resolvedTeamIdForClub)),
    staleTime: 60_000,
    queryFn: async () => {
      if (!resolvedTeamIdForClub) return null;
      const { data } = await supabase
        .from("teams")
        .select("club_id")
        .eq("id", resolvedTeamIdForClub)
        .maybeSingle();
      return data?.club_id ?? null;
    },
  });
  const proClubId =
    (chatType === "club" ? chatId : clubId) || derivedClubId || null;
  const { hasPro, hasProFootball } = useClubProAccess(proClubId, { enabled: open });

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent
          side={isMobile ? "bottom" : "right"}
          className={cn(
            "flex min-h-0 flex-col overflow-hidden p-0 gap-0",
            isMobile
              ? "h-[85vh] max-h-[85vh] rounded-t-2xl"
              : "w-[400px] sm:max-w-md",
          )}
          hideCloseButton
          enableDragToClose={isMobile}
          data-lock-keyboard-scroll="true"
          data-allow-scroll
          style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
        >
          <SheetTitle className="sr-only">{name} chat details</SheetTitle>
          <SheetDescription className="sr-only">
            View shared media, notification settings, and participants for this conversation.
          </SheetDescription>

          {/* Identity */}
          <div className="relative px-5 pt-6 pb-4 border-b">
            <Button
              variant="ghost"
              size="icon"
              className="absolute right-3 top-3 h-9 w-9"
              onClick={close}
              aria-label="Close"
            >
              <X className="h-5 w-5" />
            </Button>

            <div className="flex flex-col items-center text-center">
              <ConversationAvatar
                type={chatType === "support" ? "support" : (chatType as any)}
                name={name}
                avatarUrl={avatarUrl}
                className="h-16 w-16 ring-1 ring-border/60 shadow"
              />
              <h2 className="mt-3 text-lg font-bold tracking-tight">{name}</h2>
              {sublabel && (
                <p className="text-sm text-muted-foreground mt-0.5">{sublabel}</p>
              )}
            </div>
          </div>

          <div
            className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6"
            data-chat-scroll-lock="true"
            style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
          >
            {/* Context links */}
            {showContextLinks && (
              <div className="pt-3">
                {(teamId || chatType === "team") && (
                  <NavRow
                    label="View team page"
                    onClick={() => handleNavigate(`/teams/${chatType === "team" ? chatId : teamId}`)}
                  />
                )}
                {(teamId || chatType === "team") && hasProFootball && (
                  <NavRow
                    label="Open pitch board"
                    onClick={() =>
                      handleNavigate(
                        `/teams/${chatType === "team" ? chatId : teamId}?openBoard=1`,
                      )
                    }
                  />
                )}
                {(teamId || chatType === "team") && onInviteToTeam && (
                  <button
                    type="button"
                    onClick={onInviteToTeam}
                    className="w-full flex items-center gap-2.5 py-3 px-1 text-left active:opacity-70 transition-opacity"
                  >
                    <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                      <UserPlus className="h-4 w-4 text-primary" strokeWidth={2.25} />
                    </div>
                    <span className="flex-1 text-[15px] font-medium text-primary">
                      Invite people to team
                    </span>
                    <ChevronRight className="h-4 w-4 text-primary/70 shrink-0" />
                  </button>
                )}
                {competitionId && (
                  <NavRow
                    label="View competition"
                    onClick={() => handleNavigate(`/competitions/${competitionId}`)}
                  />
                )}
                {miniLeagueId ? (
                  <>
                    <NavRow
                      label="View mini-league page"
                      onClick={() => handleNavigate(`/mini-leagues/${miniLeagueId}`)}
                    />
                    {onInviteToMiniLeague && (
                      <button
                        type="button"
                        onClick={onInviteToMiniLeague}
                        className="w-full flex items-center gap-2.5 py-3 px-1 text-left active:opacity-70 transition-opacity"
                      >
                        <div className="h-7 w-7 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
                          <UserPlus className="h-4 w-4 text-primary" strokeWidth={2.25} />
                        </div>
                        <span className="flex-1 text-[15px] font-medium text-primary">
                          Invite people to mini-league
                        </span>
                        <ChevronRight className="h-4 w-4 text-primary/70 shrink-0" />
                      </button>
                    )}
                  </>
                ) : (clubId || chatType === "club") && (
                  <NavRow
                    label="View club page"
                    onClick={() => handleNavigate(`/clubs/${chatType === "club" ? chatId : clubId}`)}
                  />
                )}
                {(() => {
                  const resolvedTeamId = chatType === "team" ? chatId : teamId;
                  const resolvedClubId = chatType === "club" ? chatId : clubId;
                  const isGroup = chatType === "group";
                  const fallbackHref = miniLeagueId
                    ? `/vault?miniLeague=${miniLeagueId}`
                    : resolvedTeamId
                    ? `/vault?team=${resolvedTeamId}`
                    : resolvedClubId
                    ? `/vault?club=${resolvedClubId}`
                    : null;
                  // Club chats should NOT expose the vault link — vault access
                  // is gated separately and not granted merely by chat membership.
                  if (chatType === "club") return null;
                  // File vault is a Pro feature — hide entirely for free clubs.
                  if (!hasPro) return null;
                  // For a group, we only show the row if it has a club/team/league
                  // context (so the auto-created folder or a fallback target exists).
                  // Personal groups (no club_id) have nothing to open and should
                  // not show a dead row.
                  if (isGroup && !fallbackHref) return null;
                  if (!fallbackHref && !isGroup) return null;
                  return (
                    <NavRow
                      label="View file vault"
                      onClick={async () => {
                        if (isGroup) {
                          // Look up folder linked to this group chat first
                          const { data: folder } = await supabase
                            .from("vault_folders")
                            .select("id")
                            .eq("chat_group_id", chatId)
                            .is("deleted_at", null)
                            .limit(1)
                            .maybeSingle();
                          if (folder?.id) {
                            handleNavigate(`/vault/folder/${folder.id}`);
                            return;
                          }
                        }
                        if (fallbackHref) handleNavigate(fallbackHref);
                      }}
                    />
                  );
                })()}
                <Separator className="my-2" />
              </div>
            )}

            {/* Shared in chat */}
            <Section
              title="Shared in chat"
              action={
                sharedMedia.length > 0 && (
                  <button
                    type="button"
                    className="text-xs font-medium text-primary active:opacity-70"
                    onClick={() => setMediaViewerOpen(true)}
                  >
                    View all →
                  </button>
                )
              }
            >
              {mediaLoading ? (
                <div className="flex items-center justify-center h-24">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : sharedMedia.filter((m) => m.kind === "photo").length === 0 ? (
                <EmptyMedia />
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1 snap-x">
                  {sharedMedia
                    .filter((m) => m.kind === "photo")
                    .slice(0, 8)
                    .map((item) => {
                      const isVideo = isVideoUrl(item.image_url);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => setMediaViewerOpen(true)}
                          className="relative shrink-0 h-20 w-20 rounded-lg overflow-hidden bg-muted snap-start active:opacity-80 transition-opacity"
                        >
                          <SecureImage
                            src={item.image_url}
                            alt="Shared media"
                            className="absolute inset-0 h-full w-full object-cover"
                          />
                          {isVideo && (
                            <div className="absolute inset-0 flex items-center justify-center bg-black/20 pointer-events-none">
                              <div className="h-7 w-7 rounded-full bg-black/60 flex items-center justify-center">
                                <Play className="h-3 w-3 text-white fill-white" />
                              </div>
                            </div>
                          )}
                        </button>
                      );
                    })}
                </div>
              )}
            </Section>

            {/* Notifications */}
            <Section title="Notifications">
              <NotificationsToggle chatType={mediaType} chatId={chatId} disabled={chatType === "support"} />
            </Section>

            {/* Participants */}
            {showParticipants && (
              <Section title="" noPadding>
                {chatType === "group" && (
                  <ChatGroupJoinRequests groupId={chatId} enabled={open} />
                )}
                <ChatParticipantsList
                  chatType={chatType as "team" | "club" | "group"}
                  chatId={chatId}
                  chatName={name}
                  teamId={teamId}
                  clubId={clubId}
                  miniLeagueId={miniLeagueId}
                  groupAllowedRoles={groupAllowedRoles}
                  groupCreatedBy={groupCreatedBy}
                  groupMembershipMode={groupMembershipMode}
                  enabled={open}
                  onBeforeNavigate={close}
                  inline
                />
              </Section>
            )}

            {/* DM participant summary */}
            {(chatType === "dm" || chatType === "support") && otherUserId && (
              <Section title="Participants · 2">
                <DMParticipants otherUserId={otherUserId} otherName={name} otherAvatar={avatarUrl} />
              </Section>
            )}
          </div>
        </SheetContent>
      </Sheet>

      <ChatMediaViewer
        open={mediaViewerOpen}
        onOpenChange={setMediaViewerOpen}
        chatType={mediaType}
        chatId={chatId}
        title="Shared in chat"
      />

      {activeMedia && (
        <FullscreenImageViewer
          src={activeMedia.image_url}
          alt="Shared media"
          onClose={() => setActiveMedia(null)}
        />
      )}
    </>
  );
}

function Section({
  title,
  action,
  children,
  noPadding,
}: {
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  noPadding?: boolean;
}) {
  return (
    <div className={cn("pt-4", noPadding && "pt-3")}>
      {title && (
        <div className="flex items-center justify-between mb-2 px-1">
          <h3 className="text-sm font-semibold">{title}</h3>
          {action}
        </div>
      )}
      {children}
    </div>
  );
}

function NavRow({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center justify-between rounded-lg px-3 py-3 text-left transition-colors hover:bg-muted/50 active:bg-muted touch-manipulation"
    >
      <span className="text-sm font-medium">{label}</span>
      <ChevronRight className="h-4 w-4 text-muted-foreground" />
    </button>
  );
}

function EmptyMedia() {
  return (
    <div className="flex flex-col items-center justify-center py-6 px-4 rounded-lg bg-muted/40 text-center">
      <ImageIcon className="h-5 w-5 text-muted-foreground mb-1.5" />
      <p className="text-xs text-muted-foreground">No media shared in this chat yet</p>
    </div>
  );
}

function NotificationsToggle({
  chatType,
  chatId,
  disabled,
}: {
  chatType: ChatSharedMediaType;
  chatId: string;
  disabled?: boolean;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const muteType = chatType === "broadcast" ? "team" : chatType; // broadcast not tracked individually; UI-only

  const { data: muteData, isLoading } = useQuery({
    queryKey: ["chat-mute", muteType, chatId, user?.id],
    queryFn: async () => {
      const { data } = await supabase
        .from("chat_mute_preferences")
        .select("id, muted_until")
        .eq("user_id", user!.id)
        .eq("chat_type", muteType as any)
        .eq("chat_id", chatId)
        .maybeSingle();
      return data;
    },
    enabled: !!user && !disabled && chatType !== "broadcast",
  });

  const isMuted = !!muteData && (muteData.muted_until === null || new Date(muteData.muted_until) > new Date());
  const notificationsOn = !isMuted;

  const toggleMutation = useMutation({
    mutationFn: async (enable: boolean) => {
      if (enable) {
        await supabase
          .from("chat_mute_preferences")
          .delete()
          .eq("user_id", user!.id)
          .eq("chat_type", muteType as any)
          .eq("chat_id", chatId);
      } else {
        await supabase
          .from("chat_mute_preferences")
          .delete()
          .eq("user_id", user!.id)
          .eq("chat_type", muteType as any)
          .eq("chat_id", chatId);
        await supabase.from("chat_mute_preferences").insert({
          user_id: user!.id,
          chat_type: muteType as any,
          chat_id: chatId,
          muted_until: null,
        });
      }
    },
    onSuccess: (_, enable) => {
      queryClient.invalidateQueries({ queryKey: ["chat-mute", muteType, chatId, user?.id] });
      toast.success(enable ? "Notifications enabled" : "Notifications muted");
    },
    onError: () => toast.error("Failed to update notification settings"),
  });

  if (chatType === "broadcast" || disabled) {
    return (
      <div className="flex items-center justify-between rounded-lg border bg-muted/30 px-4 py-3">
        <div>
          <p className="text-sm font-medium">Notifications</p>
          <p className="text-xs text-muted-foreground">Always on for this chat</p>
        </div>
        <Switch checked disabled />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-between rounded-lg border bg-card px-4 py-3">
      <div>
        <p className="text-sm font-medium">Notifications</p>
        <p className="text-xs text-muted-foreground">
          {notificationsOn ? "You'll be notified of new messages" : "Muted — no notifications"}
        </p>
      </div>
      <Switch
        checked={notificationsOn}
        disabled={isLoading || toggleMutation.isPending}
        onCheckedChange={(checked) => toggleMutation.mutate(checked)}
      />
    </div>
  );
}

function DMParticipants({
  otherUserId,
  otherName,
  otherAvatar,
}: {
  otherUserId: string;
  otherName: string;
  otherAvatar?: string | null;
}) {
  const { user, profile } = useAuth();
  return (
    <div className="space-y-1 px-1">
      <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
        <ConversationAvatar
          type="dm"
          name={profile?.display_name || "You"}
          avatarUrl={profile?.avatar_url}
          className="h-9 w-9"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">You</p>
        </div>
      </div>
      <div className="flex items-center gap-3 rounded-lg px-2 py-2 hover:bg-muted/50">
        <ConversationAvatar
          type="dm"
          name={otherName}
          avatarUrl={otherAvatar}
          className="h-9 w-9"
        />
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium truncate">{otherName}</p>
        </div>
      </div>
      {/* Suppress unused warnings */}
      <span className="hidden">{user?.id}{otherUserId}</span>
    </div>
  );
}
