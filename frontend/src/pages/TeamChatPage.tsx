import React, { useState, useEffect, useMemo, useCallback, useRef, useLayoutEffect, Suspense } from "react";
import { useChatLoadingLatch } from "@/hooks/useChatLoadingLatch";
import { resolveChatMetadataState } from "@/lib/chatMetadataGate";
import { ChatUnreachable } from "@/components/chat/ChatUnreachable";
import { consumePendingChatJump, getLastConsumedPendingChatJumpTs, subscribePendingChatJump, type PendingChatJumpPayload } from "@/lib/pendingChatJump";
import { resolveChatJumpTarget } from "@/lib/resolveChatJumpTarget";
import { fuzzyMatchesQuery } from "@/lib/fuzzySearch";
import { filterChatMessagesForSearch } from "@/features/messaging/thread/chatSearchPresentation";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import { findLocalReplyMessage } from "@/lib/chatRealtimeReply";
import { splitPageWindow } from "@/lib/chatPageWindow";
import { sortChatMessagesChronologically, compareChatMessagesChronologically } from "@/lib/chatMessageOrder";
import { useChatDraft, useChatDraftReply } from "@/hooks/useChatDraft";
import { useChatPageReady } from "@/hooks/useChatPageReady";
import { useSyncActiveClubToChat } from "@/hooks/useSyncActiveClubToChat";
import { useTeamChatAdminStatus } from "@/features/messaging/thread/useTeamChatAdminStatus";
import { useTeamChatTeamData } from "@/features/messaging/thread/useTeamChatTeamData";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { useMeasuredElementHeight } from "@/hooks/useMeasuredElementHeight";
import { keepComposerFocusedThroughSend } from "@/lib/chatComposerFocus";

import { ChatMessagesScroller } from "@/components/chat/ChatMessagesScroller";
import { ChatThreadSponsorStrip } from "@/components/chat/ChatThreadSponsorStrip";
import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";
import { useParams, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { SecureAvatar } from "@/components/SecureAvatar";
import { TeamChatHeaderSection } from "@/components/chat/TeamChatHeaderSection";
import { ChatCatchUp } from "@/components/chat/ChatCatchUp";
import { markChatOpened } from "@/hooks/useChatCatchUp";
import { useAICatchUpAvailability } from "@/hooks/useAICatchUpAvailability";
import { useUnreadMessageCounts } from "@/hooks/useUnreadMessageCounts";
import { useChatOnlineCount } from "@/hooks/useChatOnlineCount";
import { ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { createChatHistorySearchFetcher } from "@/features/messaging/thread/chatHistorySearchFetcher";
import { TEAM_CHAT_SCOPE } from "@/features/messaging/scopes/chatScopeAdapters";
import { fetchMessagesAround } from "@/lib/fetchMessagesAround";

import { PageLoading } from "@/components/ui/page-loading";
import { ChatPageSkeleton } from "@/components/chat/ChatPageSkeleton";
import { TeamMemberManagementSheets } from "@/components/chat/TeamMemberManagementSheets";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import * as fixtureData from "@/lab/fixtureDataLayer";
import { orderChatMessagesChronologically } from "@/lab/chatMessageOrdering";
import { selectHistoryChatPlaceholderSource } from "@/lab/chatThreadCacheHydration";
import {
  getLocalTeamUnreadCount,
  listLocalTeamMessages,
  markLocalTeamRead,
  sendLocalTeamMessage,
} from "@/lab/localMessagingService";
import {
  refreshChatManagedTeamMembership,
  refreshChatRemovedTeamMember,
} from "@/lab/teamMembershipCacheCompletion";
import { markChatScopeNotificationsRead } from "@/lib/markChatScopeRead";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { usePublishChatImage } from "@/hooks/usePublishChatImage";
import { useRecentMatchWindow } from "@/hooks/useRecentMatchWindow";
import { PinnedMessagesBanner } from "@/components/chat/PinnedMessagesBanner";
import { PinnedVaultBanner } from "@/components/chat/PinnedVaultBanner";
import { useChatPinnedVault } from "@/hooks/useChatPinnedVault";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useClubRealtimeMode } from "@/hooks/useClubRealtimeMode";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";
import { usePinnedMessages } from "@/hooks/usePinnedMessages";
import { jumpToMessageInVirtualizedChat } from "@/lib/jumpToMessage";
import { TeamChatComposerFooter } from "@/components/chat/TeamChatComposerFooter";

import { ChatEmptyState } from "@/components/chat/ChatEmptyState";

import { useMessageReads } from "@/hooks/useMessageReads";
import { useMarkVisibleChatMessagesRead } from "@/hooks/useMarkVisibleChatMessagesRead";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { fetchProfilesWithCache, fetchSingleProfileWithCache, getProfilesFromCache } from "@/lib/profileCache";
import { useProfiles } from "@/hooks/useProfiles";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueMessage } from "@/lib/messageQueue";
import { getCachedMessages, cacheMessages, shouldRefetchMessages } from "@/lib/messageCache";
import { useRealtimeReactionSync } from "@/hooks/useRealtimeReactionSync";
import {
  recordRealtimeMutation,
  reconcileMessages,
  applyMessageUpdate,
  removeMessage,
  isTombstoned,
  clearReconciliationScope,
} from "@/lib/chatMessageReconciliation";
import { createSendTempId, splitPollMarkup, restoreFailedSendComposer, authoritativeMessageExists, findSupersededOptimisticIndex, type FailedSendContext } from "@/lib/failedSendRestore";
import { deliveredSend, queuedSend, isConfirmedDelivery } from "@/lib/chatSendResult";
import { consumeFromNotificationFlag } from "@/lib/notificationPreload";
import { logChatOpenLatency } from "@/lib/chatOpenLatency";
import { useChatPerfMarks, markChatFetch } from "@/hooks/useChatPerfMarks";
import { useChatVaultDeliverySync } from "@/hooks/useChatVaultDeliverySync";
import { Capacitor } from "@capacitor/core";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { noteChatMount, noteChatUnmount } from "@/lib/chatPerfDiagnostics";
import { startChatRealtimeChannel } from "@/features/messaging/thread/chatRealtimeChannelLifecycle";
import { shouldSkipChatMountInvalidate } from "@/lib/chatMountInvalidate";
import { isChatEagerInvalidateEnabled, ensureSessionApplied } from "@/lib/chatEagerInvalidate";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const PinVaultSheet = lazyWithRetry(() => import("@/components/chat/PinVaultSheet").then(m => ({ default: m.PinVaultSheet })));
import {
  type TeamChatMessage as Message,
  formatTeamChatMessageDate as formatMessageDate,
  belongsToTeamChatThread as belongsToTeam,
  getCachedTeamChatMessages as getCachedTeamMessages,
} from "@/features/messaging/thread/teamChatMessageHelpers";


const MESSAGES_PER_PAGE = 30;

export default function TeamChatPage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("TeamChat", null);
    return () => noteChatUnmount("TeamChat", k, null);
  }, []);
  const { teamId } = useParams<{ teamId: string }>();
  const { user, profile, refreshUnreadCount, decrementUnreadCount, initialized } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const localIcpPersona = user?.id?.startsWith("icp-") ? user.id.slice(4) : "member";
  const notificationNudge = useNotificationNudge(user?.id, "chat");
  const swipeBack = useSwipeBack();
  const queryClient = useQueryClient();
  const authReady = !!user && initialized;
  const [searchParams] = useSearchParams();
  // Was this thread opened from a push notification within the last 60s? If
  // so, the prior React Query snapshot (`prev`) predates the new push and is
  // stale — fall through to the freshly-preloaded localStorage cache instead
  // so the new message renders at first paint.
  const openedFromNotificationRef = useRef<number | null>(
    teamId ? consumeFromNotificationFlag("team", teamId) : null,
  );
  const mountTsRef = useRef<number>(Date.now());
  const perfLoggedRef = useRef<boolean>(false);
  const [message, setMessage, clearDraft] = useChatDraft(teamId);
  // Gate non-critical chat-page queries (pinned, vault, club-pro, online count)
  // until after first paint + idle so they don't compete with the messages
  // fetch and visual-settle window on notification opens.
  const chatReady = useChatPageReady();
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [replyingTo, setReplyingTo] = useChatDraftReply<{ id: string; text: string; authorName: string | null }>(teamId);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [newsPickerOpen, setNewsPickerOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);
  const [pendingNewsId, setPendingNewsId] = useState<string | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const scheduleTarget: ScheduleTarget | null = teamId
    ? { chat_type: "team", team_id: teamId }
    : null;
  const [selectedMember, setSelectedMember] = useState<{ userId: string; displayName: string; avatarUrl?: string | null; roles: { id: string; role: string }[] } | null>(null);
  const [addRoleMember, setAddRoleMember] = useState<{ userId: string; userName: string; existingRoles: string[] } | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Persists the search text after tapping a result so highlights stay
  // visible on the jumped-to row; cleared when the highlight ring fades.
  const [highlightQuery, setHighlightQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [inviteSheetOpen, setInviteSheetOpen] = useState(false);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  useEffect(() => {
    if (!highlightedMessageId && highlightQuery) setHighlightQuery("");
  }, [highlightedMessageId, highlightQuery]);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [jumpRenderNonce, setJumpRenderNonce] = useState<number | string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  // publishing state moved to usePublishChatImage hook (declared after team load)
  const { isOnline } = useOnlineStatus();
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isNativePlatform = Capacitor.isNativePlatform();
  const useVirtualizedChat = true;

  // Mark team message notifications as read when opening this thread.
  // Uses optimistic + fire-and-forget to clear the bell badge immediately.
  useEffect(() => {
    if (useIcpLab || !user || !teamId) return;
    markChatScopeNotificationsRead({
      userId: user.id,
      scope: { kind: "team", teamId },
      queryClient,
      decrementUnreadCount,
      refreshUnreadCount,
    });
  }, [useIcpLab, user, teamId, refreshUnreadCount, decrementUnreadCount, queryClient]);

  // Record that the user opened this team chat (drives the AI catch-up trigger).
  useEffect(() => { if (teamId) markChatOpened("team", teamId); }, [teamId]);
  const summarizeTriggerRef = useRef<(() => void) | null>(null);
  const { featureDisabled: aiCatchUpDisabled } = useAICatchUpAvailability("team", teamId);
  const { data: supabaseTeamUnreadCount = 0 } = useUnreadMessageCounts<number>(user?.id ?? null, {
    enabled: !useIcpLab && !!teamId,
    select: (d) => (teamId ? d.teams[teamId] ?? 0 : 0),
  });
  const { data: localTeamUnreadCount = 0 } = useQuery({
    queryKey: ["local-team-unread-count", teamId, localIcpPersona],
    queryFn: () => getLocalTeamUnreadCount(localIcpPersona, teamId!),
    enabled: useIcpLab && !!teamId,
    refetchInterval: 30_000,
  });
  const teamUnreadCount = useIcpLab ? localTeamUnreadCount : supabaseTeamUnreadCount;

  const profileRef = useRef(profile);
  profileRef.current = profile;
  
  // Legacy DOM refs are no longer required (Virtuoso owns scroll), but keep
  // the declarations so any non-scroll code paths that still touch the names
  // continue to compile. The refs are never attached to anything live.
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const { elementRef: composerRef, height: composerHeight } = useMeasuredElementHeight<HTMLDivElement>(
    [replyingTo?.id, editingMessage?.id],
    56,
  );
  
  const chatHeight = useChatViewportHeight();
  const isKeyboardOpen = useKeyboardOpen();
  const nativeKbHeight = useNativeKeyboardBottomInset();

  const scrollToBottom = useCallback(() => {
    virtualHandleRef.current?.scrollToBottom("auto");
  }, []);

  const urlMessageId = searchParams.get("message");
  const [liveJump, setLiveJump] = useState<PendingChatJumpPayload | null>(null);
  useEffect(() => subscribePendingChatJump(setLiveJump), []);
  const liveJumpId = liveJump?.kind === "team" && liveJump.targetId === teamId ? liveJump.messageId : null;
  const urlJumpNonce = searchParams.get("jump");
  const [fallbackJumpId] = useState(() =>
    teamId ? consumePendingChatJump("team", teamId) : null,
  );
  const fallbackJumpTs = getLastConsumedPendingChatJumpTs(fallbackJumpId);
  const { messageId: targetMessageId, nonce: targetJumpNonce } = resolveChatJumpTarget({
    urlMessageId,
    urlJumpNonce,
    liveJumpId,
    liveJumpTs: liveJump?.ts,
    fallbackJumpId,
    fallbackJumpTs,
  });
  const targetParentId = searchParams.get("parent");
  const scrollerKey = targetMessageId
    ? `team-jump:${teamId}:${targetMessageId}:${jumpRenderNonce ?? targetJumpNonce ?? "initial"}`
    : `team:${teamId}`;

  // Scroll to and highlight the message referenced by ?message=… (push /
  // in-app notification deep links). Polls until the message renders so it
  // works even if messages load async or live below the initial page.
  // Optional ?parent=… provides a thread fallback so the user lands in the
  // correct context if the target reply is still off-window.
  useEffect(() => {
    if (!targetMessageId) return;
    const cancel = jumpToMessageInVirtualizedChat(
      targetMessageId,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      {
        tryLoadOlder: () => loadOlderMessagesRef.current?.(),
        refetchLatest: () => queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] }),
        parentMessageId: targetParentId ?? undefined,
      },
    );
    return cancel;
  }, [targetMessageId, targetParentId, targetJumpNonce]);

  // Pinned messages
  const {
    pins: pinnedMessages,
    pinnedMessageIds,
    pin: pinMessage,
    unpin: unpinMessage,
    canPinMore,
    isLoading: pinnedMessagesLoading,
  } = usePinnedMessages("team", teamId, { enabled: chatReady });
  const handleJumpToMessage = (mid: string) =>
    jumpToMessageInVirtualizedChat(
      mid,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { tryLoadOlder: () => loadOlderMessagesRef.current?.() },
    );

  // Clicking a search result jumps to the message in the full thread so the
  // user sees surrounding context. We first fetch a window of messages around
  // the match so the rows immediately before/after are present in the loaded
  // set (search alone merges only the matched row, leaving a gap).
  const handleSearchResultClick = async (mid: string) => {
    const target = (localMessagesRef.current ?? []).find((m) => m.id === mid);
    setHighlightQuery(searchQuery);
    setSearchQuery("");
    setSearchOpen(false);
    if (target?.created_at && teamId) {
      if (useIcpLab) {
        requestAnimationFrame(() => handleJumpToMessage(mid));
        return;
      }
      try {
        const ctx = await fetchMessagesAround({
          table: "team_messages",
          scope: { team_id: teamId },
          createdAt: target.created_at,
          selectColumns:
            "id, text, image_url, created_at, edited_at, author_id, team_id, reply_to_id, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label",
          hasAnnouncements: true,
        });
        if (ctx.length) {
          setLocalMessages((prev) => {
            const existing = new Set((prev || []).map((m) => m.id));
            const adds = ctx.filter((m) => !existing.has(m.id));
            return adds.length ? [...(prev || []), ...adds] : prev;
          });
        }
      } catch {
        // best-effort; fall through to jump
      }
    }
    requestAnimationFrame(() => handleJumpToMessage(mid));
  };

  const {
    team,
    loadingTeam,
    teamFetchStatus,
    teamIsError,
    teamStatus,
    refetchTeam,
    teamIsFetching,
  } = useTeamChatTeamData({
    supabaseClient: supabase,
    teamId,
    useIcpLab,
    getLocalLabChatTeam: fixtureData.getLocalLabChatTeam,
  });

  // Sync active club to this team's owning club so push-launched threads
  // don't leave the user inside the wrong club context.
  useSyncActiveClubToChat(team?.club_id);

  // Check if user is admin (team_admin, coach, club_admin, or app_admin) - parallelize queries
  const { data: isAdmin } = useTeamChatAdminStatus({
    supabaseClient: supabase,
    teamId,
    userId: user?.id,
    clubId: team?.club_id,
    enabled: authReady && !!user?.id && !useIcpLab,
  });

  const [pinVaultSheetOpen, setPinVaultSheetOpen] = useState(false);
  const pinnedVault = useChatPinnedVault("team", teamId, { enabled: chatReady });
  const { hasPro: clubHasPro, isLoading: clubProLoading } = useClubProAccess(team?.club_id ?? null, { enabled: chatReady });
  const pinnedVaultLocked = !clubProLoading && !clubHasPro;

  const handleMemberProfileTap = useCallback(async (memberUserId: string, displayName: string, avatarUrl?: string | null) => {
    if (!teamId || !isAdmin || memberUserId === user?.id) return;

    const { data: roles, error } = await supabase
      .from("user_roles")
      .select("id, role")
      .eq("user_id", memberUserId)
      .eq("team_id", teamId);

    if (error) {
      toast.error("Failed to load member roles");
      return;
    }

    setSelectedMember({
      userId: memberUserId,
      displayName,
      avatarUrl,
      roles: roles || [],
    });
  }, [teamId, isAdmin, user?.id]);

  const handleRemoveRoleFromSelectedMember = useCallback(async (roleItem: { id: string; role: string }) => {
    if (!teamId) return;

    const { error } = await supabase
      .from("user_roles")
      .delete()
      .eq("id", roleItem.id);

    if (error) {
      toast.error("Failed to remove role");
      return;
    }

    toast.success("Role removed");
    queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    refreshChatManagedTeamMembership(queryClient, teamId, "team", teamId);
    setSelectedMember(null);
  }, [teamId, queryClient]);

  const handleRemoveSelectedMemberFromTeam = useCallback(async () => {
    if (!teamId || !selectedMember) return;

    // Scoped RPC — see remove_team_member migration. Ensures guardian-derived
    // access (child_team_assignments) and team-chat group memberships are
    // revoked atomically alongside the user_roles row.
    const { error } = await supabase.rpc("remove_team_member", {
      _team_id: teamId,
      _user_id: selectedMember.userId,
    });

    if (error) {
      toast.error("Failed to remove member");
      return;
    }
    toast.success("Member removed from team");
    queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    refreshChatRemovedTeamMember(queryClient, teamId, "team", teamId);
    setSelectedMember(null);
  }, [teamId, selectedMember, queryClient]);

  // Force a fresh fetch whenever we land on this team chat. Push notifications
  // and inbox taps can land here while react-query still has stale data —
  // invalidating guarantees the latest message is fetched on entry.
  // Batch 3A: skip when cache is fresh + realtime up + not waking from background.
  // Batch 3B: fire on `user?.id` (eager) when per-surface flag enabled.
  const eagerInvalidateTeam = isChatEagerInvalidateEnabled("team");
  const invalidateGateTeam = eagerInvalidateTeam ? !!user?.id : authReady;
  useEffect(() => {
    if (!teamId || !invalidateGateTeam) return;
    const key = ["team-messages", teamId];
    if (shouldSkipChatMountInvalidate(queryClient, key, `team:${teamId}`)) return;
    let cancelled = false;
    (async () => {
      if (eagerInvalidateTeam) await ensureSessionApplied();
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: key });
    })();
    return () => { cancelled = true; };
  }, [teamId, invalidateGateTeam, queryClient, eagerInvalidateTeam]);

  const { data: messagesData, isLoading: loadingMessages, isFetching } = useQuery({
    queryKey: ["team-messages", teamId],
    queryFn: async () => {
      markChatFetch();
      if (useIcpLab && teamId && user?.id) {
        return {
          messages: await listLocalTeamMessages(localIcpPersona, teamId) as unknown as Message[],
          hasOlderMessages: false,
          fromCache: false,
        };
      }

      // If offline, return cached messages using the React Query online manager
      // so native app resume does not incorrectly fall back to stale cache.
      if (!isOnline) {
        const cached = getCachedMessages("team", teamId!);
        if (cached.length > 0) {
          // Transform cached messages to include team_id
          const messagesWithTeamId = cached.map(m => ({
            ...m,
            team_id: teamId!,
            profiles: m.profiles,
            reactions: m.reactions || [],
          }));
          return { messages: messagesWithTeamId as unknown as Message[], hasOlderMessages: false, fromCache: true };
        }
        throw new Error("No cached messages available offline");
      }

      // 15s overall budget so a hung request never leaves the chat blank
      const queryAbort = new AbortController();
      const queryTimeout = setTimeout(() => queryAbort.abort(), 15000);

      // Fetch messages - filter out soft-deleted messages using deleted_at
      const { data: rawMessages, error } = await supabase
        .from("team_messages")
        .select("id, text, image_url, created_at, edited_at, author_id, team_id, reply_to_id, deleted_at, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("team_id", teamId!)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1)
        .abortSignal(queryAbort.signal);
      if (error) {
        clearTimeout(queryTimeout);
        throw error;
      }
      
      if (!rawMessages?.length) {
        return { messages: [] as Message[], hasOlderMessages: false };
      }

      const { items: messagesToDisplay, hasMore } = splitPageWindow(rawMessages, MESSAGES_PER_PAGE);

      // Fetch reactions and reply_to data in parallel (profiles fetched separately for faster initial render)
      const messageIds = messagesToDisplay.map((m) => m.id);
      const replyToIds = messagesToDisplay
        .filter((m) => m.reply_to_id)
        .map((m) => m.reply_to_id as string);
      const authorIds: string[] = [...new Set(messagesToDisplay.map((m) => m.author_id))].filter(
        (authorId): authorId is string => typeof authorId === "string",
      );

      // Preserve cached reactions when the reactions query fails transiently.
      const cachedQueryData = queryClient.getQueryData(["team-messages", teamId]) as
        | { messages?: Message[] }
        | Message[]
        | undefined;
      const cachedMessages = Array.isArray(cachedQueryData)
        ? cachedQueryData
        : cachedQueryData?.messages || [];
      const cachedReactionsByMessage = new Map<string, Message["reactions"]>();
      cachedMessages.forEach((cachedMessage) => {
        if (cachedMessage.reactions?.length) {
          cachedReactionsByMessage.set(cachedMessage.id, cachedMessage.reactions);
        }
      });

      useEffect(() => {
        if (!useIcpLab || !teamId || !messagesData?.messages.length) return;
        const latestMessage = messagesData.messages[messagesData.messages.length - 1];
        let cancelled = false;
        markLocalTeamRead(localIcpPersona, teamId, latestMessage.id)
          .then(() => {
            if (!cancelled) {
              queryClient.setQueryData(["local-team-unread-count", teamId], 0);
            }
          })
          .catch((error) => {
            if (!cancelled) console.warn("[TeamChat] Failed to mark local messages read", error);
          });
        return () => {
          cancelled = true;
        };
      }, [useIcpLab, teamId, messagesData, queryClient]);
      
      // Fetch profiles with cache - will return cached data immediately if available, or fetch from DB
      // Use allSettled so a single hung/failing RPC cannot block the entire message render.
      const [reactionsSettled, replyToSettled, profilesSettled] = await Promise.allSettled([
        supabase
          .from("message_reactions")
          .select("id, user_id, reaction_type, team_message_id")
          .in("team_message_id", messageIds)
          .abortSignal(queryAbort.signal),
        replyToIds.length > 0
          ? supabase
              .from("team_messages")
              .select("id, text, author_id")
              .in("id", replyToIds)
              .abortSignal(queryAbort.signal)
          : Promise.resolve({ data: [] as any[], error: null }),
        fetchProfilesWithCache(authorIds),
      ]);
      clearTimeout(queryTimeout);

      const reactionsResult: any = reactionsSettled.status === "fulfilled"
        ? reactionsSettled.value
        : { data: null, error: reactionsSettled.reason };
      const replyToResult: any = replyToSettled.status === "fulfilled"
        ? replyToSettled.value
        : { data: [], error: replyToSettled.reason };
      const profilesMap: Map<string, any> = profilesSettled.status === "fulfilled"
        ? profilesSettled.value
        : new Map();

      if (reactionsResult.error) {
        console.warn("[TeamChat] Failed to fetch reactions, keeping cached reactions", reactionsResult.error);
      }
      if (replyToSettled.status === "rejected") {
        console.warn("[TeamChat] Failed to fetch reply-to messages", replyToSettled.reason);
      }
      if (profilesSettled.status === "rejected") {
        console.warn("[TeamChat] Failed to fetch profiles", profilesSettled.reason);
      }

      const replyToMap = new Map(
        (replyToResult.data || []).map((r: any) => [r.id, {
          ...r,
          profiles: profilesMap.get(r.author_id) ? { display_name: profilesMap.get(r.author_id)?.display_name } : null,
        }])
      );

      // Map to expected format - use fetched profiles
      const messages = messagesToDisplay.map((msg: any) => {
        const replyTo = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null;
        const profile = profilesMap.get(msg.author_id);
        const reactions = reactionsResult.error
          ? cachedReactionsByMessage.get(msg.id) || []
          : reactionsResult.data?.filter((r: any) => r.team_message_id === msg.id) || [];
        return {
          id: msg.id,
          team_id: msg.team_id,
          author_id: msg.author_id,
          text: msg.text,
          image_url: msg.image_url,
          reply_to_id: msg.reply_to_id,
          created_at: msg.created_at,
          is_club_announcement: msg.is_club_announcement || false,
          club_announcement_name: msg.club_announcement_name || null,
          is_system_message: msg.is_system_message || false,
          profiles: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
          reactions,
          reply_to: replyTo,
        };
      }) as Message[];

      // Cache messages for offline access
      cacheMessages("team", teamId!, messages.map(m => ({
        id: m.id,
        // Immutable thread scope so future cache reads can validate the row.
        team_id: m.team_id ?? teamId!,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        is_club_announcement: m.is_club_announcement,
        club_announcement_name: m.club_announcement_name,
        is_system_message: m.is_system_message,
        profiles: m.profiles,
        reactions: m.reactions,
        reply_to: m.reply_to,
      })));

      return { messages, hasOlderMessages: hasMore };
    },
    enabled: !!teamId && !!user?.id, // session token is sufficient; don't wait for profile fetch (`authReady`) to unblock first paint
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 60 * 24, // Keep in cache for 24 hours
    refetchOnMount: "always", // Force refetch on every mount (true is a no-op while staleTime is unmet) so reactions/messages added while away are picked up
    refetchOnReconnect: true,
    refetchOnWindowFocus: false,
    placeholderData: (prev: any) => {
      if (!teamId) return prev;
      const cachedMessages = getCachedTeamMessages(teamId);
      // When opened from a push notification, the cached message just written
      // by the preload handler is fresher than `prev`. Prefer it ONLY when
      // it actually contains a meaningful history window — otherwise a
      // single preloaded row replaces `prev` and the user sees one message
      // floating at the top of an empty viewport until the real fetch lands.
      // SECURITY (cross-team bleed): `prev` is whatever THIS hook instance last
      // rendered. If the route param changed without a remount it is the
      // PREVIOUS team's message list — returning it verbatim renders team A's
      // messages under team B's header and bakes them into team B's offline
      // cache. Only reuse `prev` when every row belongs to this team.
      const prevBelongsToThisTeam =
        !!prev &&
        Array.isArray(prev.messages) &&
        prev.messages.length > 0 &&
        prev.messages.every((m: any) => belongsToTeam(m, teamId));
      const source = selectHistoryChatPlaceholderSource({
        hasPrevious: prevBelongsToThisTeam,
        cachedMessageCount: cachedMessages.length,
        openedFromNotification: !!openedFromNotificationRef.current,
      });
      if (source === "previous") return prev;
      if (source === "cache") {
        return { messages: cachedMessages, hasOlderMessages: cachedMessages.length >= MESSAGES_PER_PAGE, fromCache: true };
      }

      return undefined;
    },
  });

  // Scope key for the realtime edit/soft-delete reconciliation registry.
  const reconcileScope = `team:${teamId ?? "none"}`;

  // Extract messages and hasOlderMessages from query data
  const messages = useMemo(() => {
    if (!messagesData) return undefined;
    const msgList = Array.isArray(messagesData)
      ? messagesData
      : (messagesData as any).messages || [];
    // SECURITY (cross-team bleed): last line of defence before render.
    const scoped = (msgList as any[]).filter((m) => belongsToTeam(m, teamId));
    // Sort by created_at to ensure proper ordering
    const sorted = sortChatMessagesChronologically(scoped);
    // Re-apply realtime edits/soft-deletes: an older in-flight fetch resolving
    // after a realtime UPDATE must never restore pre-edit text or resurrect a
    // deleted row.
    return reconcileMessages(reconcileScope, sorted) as Message[];
  }, [messagesData, reconcileScope, teamId]);


  // Local copy used for rendering so optimistic updates are instant.
  // A 1-item cache is almost certainly a notification preload, not real
  // history — seeding from it sets showLoading=false and renders one
  // message stranded at the top of the viewport.
  const [localMessages, setLocalMessages] = useState<Message[] | undefined>(() => {
    if (!teamId) return undefined;
    const cached = getCachedTeamMessages(teamId);
    return cached.length >= 2 ? cached : undefined;
  });
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  // Realtime reactions must reach BOTH stores (query cache + localMessages).
  const reactionQueryKey = useMemo(() => ["team-messages", teamId], [teamId]);
  const { applyRealtimeReaction, applyRealtimeReactionDelete } = useRealtimeReactionSync<Message>({
    scopeKey: reconcileScope,
    // Scope guard: message_reactions realtime events are unfiltered platform-wide.
    getLocalMessages: () => localMessagesRef.current,
    queryKey: reactionQueryKey,
    setLocalMessages,
  });
  const hasMeaningfulLocal = (localMessages?.length ?? 0) >= 2;
  const showLoadingRaw =
    (!authReady && !hasMeaningfulLocal) ||
    (loadingMessages && !messagesData && !hasMeaningfulLocal);
  // Latched: once this thread has painted, a transient local-cache reseed or a
  // realtime-driven refetch must not re-raise the skeleton.
  const showLoading = useChatLoadingLatch(showLoadingRaw, teamId);

  // Defer banner mounts until each banner's data has resolved. Banners
  // (notification nudge, pinned vault, pinned messages) resolve from async
  // queries and can pop in above the messages region post-pin, shrinking it
  // and causing a visible upward jolt. We wait until all three queries have
  // settled (with a 1500ms hard ceiling so a hanging query never blocks the
  // chat) before mounting any of them, so the messages region mounts at its
  // final height.
  const bannersDataReady =
    !notificationNudge.isLoading && !pinnedVault.isLoading && !pinnedMessagesLoading;
  const [bannersReady, setBannersReady] = useState(false);
  useEffect(() => {
    if (showLoading) {
      setBannersReady(false);
      return;
    }
    if (bannersDataReady) {
      // Yield one frame so the banner DOM commits before the scroller mounts.
      const raf = requestAnimationFrame(() => setBannersReady(true));
      return () => cancelAnimationFrame(raf);
    }
    // Hard ceiling — never let a slow query block the chat from appearing.
    const t = window.setTimeout(() => setBannersReady(true), 1500);
    return () => window.clearTimeout(t);
  }, [showLoading, bannersDataReady, teamId]);


  // Cold-start stage marks (chat_mount + chat_query_return).
  useChatPerfMarks(messagesData);

  // Log notification-tap → first-message-render latency once per mount.
  useEffect(() => {
    if (perfLoggedRef.current) return;
    if (!teamId || !user?.id) return;
    if (showLoading) return;
    if (!localMessages || localMessages.length === 0) return;
    perfLoggedRef.current = true;
    const tapTs = openedFromNotificationRef.current;
    void logChatOpenLatency({
      kind: "team",
      targetId: teamId,
      source: tapTs ? "notification" : "cold_open",
      startTs: tapTs ?? mountTsRef.current,
      messageCount: localMessages.length,
      fromCache: !messagesData,
      userId: user.id,
    });
  }, [teamId, user?.id, showLoading, localMessages, messagesData]);
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);
  
  // Reset per-thread scroll/message state when teamId changes so the initial
  // bottom-pin runs against the new chat, not stale messages from the last team.
  // Prefer in-memory React Query data on re-open within the same session, then fall back to local cache.
  useEffect(() => {
    if (!teamId) {
      setLocalMessages(undefined);
      setInfiniteScrollEnabled(false);
      return;
    }

    const cachedQueryData = queryClient.getQueryData(["team-messages", teamId]) as
      | { messages?: Message[] }
      | Message[]
      | undefined;
    const inMemoryMessages = (
      Array.isArray(cachedQueryData)
        ? cachedQueryData
        : cachedQueryData?.messages || []
    )
      // SECURITY (cross-team bleed): a placeholder object left behind by another
      // team must never seed this thread's render state.
      .filter((m: any) => belongsToTeam(m, teamId))
      .sort(compareChatMessagesChronologically);

    const seed = inMemoryMessages.length > 0 ? inMemoryMessages : getCachedTeamMessages(teamId);
    setLocalMessages((reconcileMessages(reconcileScope, seed) ?? []) as Message[]);

    setHasOlderMessages(true);
    setInfiniteScrollEnabled(false);

    return () => {
      // Tombstones/patches are per-thread; drop them when leaving the thread.
      clearReconciliationScope(`team:${teamId}`);
    };
  }, [teamId, queryClient, reconcileScope]);

  // Virtuoso owns initial bottom-pin and reveal; flip the infinite-scroll
  // gate on as soon as we have any messages so older-page loads can begin.
  const isPinned = true;
  useEffect(() => {
    if ((localMessages?.length ?? 0) > 0) setInfiniteScrollEnabled(true);
  }, [localMessages?.length]);

  // Reply/edit composer growth re-pin is handled inside ChatMessagesScroller
  // via the Virtuoso handle (see virtualHandleRef path). No-op here.
 
  // Pull-to-refresh
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  
  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    await queryClient.refetchQueries({ queryKey: ["team-messages", teamId], type: "active" });
  }, [queryClient, teamId]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await handleRefresh();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [handleRefresh]);

  const isAnyRefreshing = isManualRefreshing;

  useLayoutEffect(() => {
    // Sync local render state with query cache without dropping newer optimistic/realtime reactions.
    // Guard: never replace existing messages with an empty array (transient cache state during resume)
    if (!messages || !teamId || (messages.length === 0 && localMessages && localMessages.length > 0)) return;

    setLocalMessages((prev) => {
      const incomingIds = new Set(messages.map((message) => message.id));
      // Drop temp/queued optimistic messages once a real message with the same
      // author + text has arrived via realtime (prevents brief duplicate flash).
      const realByAuthorText = new Set(
        messages
          .filter((m) => !m.id.startsWith("temp-") && !m.id.startsWith("queued-"))
          .map((m) => `${m.author_id}::${m.text ?? ""}::${m.image_url ?? ""}`),
      );
      const previousOnly = (prev || []).filter((message) => {
        // SECURITY (cross-team bleed): this merge is deliberately fail-open — it
        // keeps prior rows absent from the incoming snapshot. A row left over
        // from another team's thread would otherwise be latched in permanently
        // and persisted into THIS team's offline cache. Never keep foreign rows.
        if (!belongsToTeam(message, teamId)) return false;
        if (incomingIds.has(message.id)) return false;

        // A realtime soft-delete already removed this row from the incoming
        // cache snapshot — never carry it over from the previous render state.
        if (isTombstoned(reconcileScope, message.id)) return false;
        if (message.id.startsWith("temp-") || message.id.startsWith("queued-")) {
          const key = `${message.author_id}::${message.text ?? ""}::${message.image_url ?? ""}`;
          if (realByAuthorText.has(key)) return false;
        }
        return true;
      });
      const mergedIncomingMessages = !prev
        ? messages
        : messages.map((message) => {
            const previousMessage = prev.find((item) => item.id === message.id);
            if (!previousMessage) return message;

            const previousReactions = previousMessage.reactions || [];
            const incomingReactions = message.reactions || [];

            const incomingByUser = new Map<string, typeof incomingReactions[number]>();
            incomingReactions.forEach((reaction) => {
              incomingByUser.set(reaction.user_id, reaction);
            });

            // Keep reactions from prev that are NOT in the incoming set:
            // - temp reactions whose user isn't already covered
            // - real reactions (arrived via realtime) whose id isn't in incoming
            const incomingIds = new Set(incomingReactions.map((r) => r.id));
            const missingFromIncoming = previousReactions.filter((reaction) => {
              if (incomingIds.has(reaction.id)) return false;
              if (reaction.id.startsWith("temp-")) return !incomingByUser.has(reaction.user_id);
              return !incomingByUser.has(reaction.user_id);
            });

            return {
              ...message,
              is_club_announcement:
                message.is_club_announcement ?? previousMessage.is_club_announcement ?? false,
              club_announcement_name:
                message.club_announcement_name ?? previousMessage.club_announcement_name ?? null,
              is_system_message:
                message.is_system_message ?? previousMessage.is_system_message ?? false,
              profiles: message.profiles ?? previousMessage.profiles,
              reply_to: message.reply_to ?? previousMessage.reply_to,
              reactions: [...incomingReactions, ...missingFromIncoming],
            };
          });
      const mergedMessages = (reconcileMessages(
        reconcileScope,
        orderChatMessagesChronologically([...previousOnly, ...mergedIncomingMessages]),
      ) ?? []) as Message[];

      cacheMessages("team", teamId, mergedMessages.map((m) => ({
        id: m.id,
        team_id: m.team_id ?? teamId,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        is_club_announcement: m.is_club_announcement,
        club_announcement_name: m.club_announcement_name,
        is_system_message: m.is_system_message,
        profiles: m.profiles,
        reactions: m.reactions,
        reply_to: m.reply_to,
      })));

      return mergedMessages;
    });
  }, [messages, teamId, reconcileScope]);

  // If messages unexpectedly dropped to 0 but we had cached messages, trigger a refetch
  useEffect(() => {
    if (!teamId || !authReady || loadingMessages || isFetching) return;
    
    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("team", teamId, fetchedCount)) {
      console.log("[TeamChat] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    }
  }, [teamId, authReady, messages, loadingMessages, isFetching, queryClient]);

  // Visibility change handler - refetch messages and profiles when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && teamId && authReady) {
        const timeSinceLastRefresh = Date.now() - lastRefresh;
        // Only refresh if it's been more than 30 seconds
        if (timeSinceLastRefresh > 30000) {
          console.log("[TeamChat] App became visible, refreshing messages");
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [teamId, authReady, queryClient]);

  // Always ensure profiles are loaded for messages with missing profile data
  useEffect(() => {
    if (!localMessages?.length) return;
    
    // Find messages with missing profile data
    const messagesWithMissingProfiles = localMessages.filter(m => !m.profiles?.display_name);
    if (messagesWithMissingProfiles.length === 0) return;
    
    const authorIds = [...new Set(messagesWithMissingProfiles.map(m => m.author_id).filter(Boolean))];
    if (authorIds.length === 0) return;
    
    // Fetch profiles and update local state
    fetchProfilesWithCache(authorIds).then(profilesMap => {
      setLocalMessages(prev => {
        if (!prev) return prev;
        let updated = false;
        const newMessages = prev.map(msg => {
          const profile = profilesMap.get(msg.author_id);
          if (profile && (!msg.profiles?.display_name || msg.profiles.display_name === "Unknown")) {
            updated = true;
            return {
              ...msg,
              profiles: { display_name: profile.display_name, avatar_url: profile.avatar_url },
            };
          }
          return msg;
        });
        return updated ? newMessages : prev;
      });
    });
  }, [localMessages]);

  // Update hasOlderMessages from fetched data
  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      const messageCount = ((messagesData as any).messages || []).length;
      const fromCache = !!(messagesData as any).fromCache;
      setHasOlderMessages(fromCache ? messageCount >= MESSAGES_PER_PAGE : (messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Keep a ref to localMessages so loadOlderMessages doesn't churn
  const localMessagesRef = useRef<Message[] | undefined>(localMessages);
  useEffect(() => {
    localMessagesRef.current = localMessages;
  }, [localMessages]);

  // Forward ref so the anchor hook can call the (yet-to-be-defined) loader.
  const loadOlderMessagesRef = useRef<(() => void) | null>(null);

  // Virtuoso owns scroll-anchoring on prepend natively (firstItemIndex +
  // followOutput). No DOM scrollTop math required — just commit the cache
  // mutation and let Virtuoso preserve the visible window.
  const queueAnchoredPrepend = useCallback((commit: () => void) => commit(), []);

  // Load older messages function with timeout protection
  const loadOlderMessages = useCallback(async () => {
    const currentMessages = localMessagesRef.current;
    if (!currentMessages?.length || isLoadingOlder || !hasOlderMessages) return;
    if (useIcpLab) {
      setHasOlderMessages(false);
      return;
    }

    setIsLoadingOlder(true);

    // Create abort controller for timeout (25s headroom for slow networks)
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const oldestMessage = currentMessages[0];

      const { data: olderData, error } = await supabase
        .from("team_messages")
        .select("id, text, image_url, created_at, edited_at, author_id, team_id, reply_to_id, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("team_id", teamId!)
        .is("deleted_at", null)
        .lt("created_at", oldestMessage.created_at)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1)
        .abortSignal(controller.signal);

      clearTimeout(timeoutId);

      if (error) throw error;
      if (!olderData?.length) {
        setHasOlderMessages(false);
        return;
      }

      const { items: dataToUse, hasMore } = splitPageWindow(olderData, MESSAGES_PER_PAGE);
      setHasOlderMessages(hasMore);

      // Reverse to get chronological order
      const reversedOlder = [...dataToUse].reverse();
      const messageIds = reversedOlder.map((m) => m.id);
      const replyToIds = reversedOlder.filter((m) => m.reply_to_id).map((m) => m.reply_to_id);
      const authorIds = [...new Set(reversedOlder.map((m) => m.author_id))];

      // Fetch reactions, reply-to messages, and profiles
      let reactionsData: any[] = [];
      let replyToData: any[] = [];
      let profilesMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();

      try {
        const secondaryController = new AbortController();
        const secondaryTimeout = setTimeout(() => secondaryController.abort(), 5000);

        const [reactionsResult, replyToResult, cachedProfiles] = await Promise.all([
          supabase
            .from("message_reactions")
            .select("id, user_id, reaction_type, team_message_id")
            .in("team_message_id", messageIds)
            .abortSignal(secondaryController.signal),
          replyToIds.length > 0
            ? supabase
                .from("team_messages")
                .select("id, text, author_id")
                .in("id", replyToIds)
                .abortSignal(secondaryController.signal)
            : Promise.resolve({ data: [] as any[], error: null }),
          fetchProfilesWithCache(authorIds),
        ]);

        clearTimeout(secondaryTimeout);
        reactionsData = reactionsResult.data || [];
        replyToData = replyToResult.data || [];
        cachedProfiles.forEach((p, id) => {
          profilesMap.set(id, { display_name: p.display_name, avatar_url: p.avatar_url });
        });
      } catch {
        // Continue without reactions/replies/profiles if they timeout
      }

      const olderMessages = reversedOlder.map((msg) => ({
        ...msg,
        is_club_announcement: msg.is_club_announcement || false,
        club_announcement_name: msg.club_announcement_name || null,
        is_system_message: msg.is_system_message || false,
        profiles: profilesMap.get(msg.author_id) || null,
        reactions: reactionsData.filter((r) => r.team_message_id === msg.id) || [],
        reply_to: replyToData.find((r) => r.id === msg.reply_to_id) || null,
      })) as Message[];

      // Prepend older messages to cache + restore scroll anchor synchronously
      // (no jolt). The hook flushSyncs the cache update and corrects scrollTop
      // in the same task, so the user never sees the intermediate state.
      // Functional merge keyed by message id — never replace the collection.
      const mergeOlder = (existing: Message[] | undefined): Message[] => {
        const byId = new Map<string, Message>();
        olderMessages.forEach((m) => byId.set(m.id, m));
        (existing || []).forEach((m) => byId.set(m.id, m)); // current state wins on boundary duplicates
        const sorted = sortChatMessagesChronologically([...byId.values()]);
        // An UPDATE received while this page was in flight must survive.
        return (reconcileMessages(reconcileScope, sorted) ?? []) as Message[];
      };

      queueAnchoredPrepend(() => {
        queryClient.setQueryData(["team-messages", teamId], (old: any) => ({
          ...(old || {}),
          messages: mergeOlder(old?.messages as Message[] | undefined),
          hasOlderMessages: hasMore,
        }));
        // Also converge the rendered local window on the same merged result —
        // the cache→local sync can otherwise be short-circuited by an in-flight
        // refetch replacing the cache with only the latest page.
        setLocalMessages((prev) => mergeOlder(prev));
      });
    } catch (err) {
      clearTimeout(timeoutId);
      console.error('Failed to load older messages:', err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [teamId, queryClient, isLoadingOlder, hasOlderMessages, queueAnchoredPrepend, useIcpLab]);

  // Keep the loader ref in sync for the anchor hook to call.
  useEffect(() => {
    loadOlderMessagesRef.current = loadOlderMessages;
  }, [loadOlderMessages]);

  // Notification deep-links must mount with the target row present. Team chat
  // pushes can arrive before the latest query contains the new row, especially
  // on Android cold-starts, so replace first paint with a small target window.
  useEffect(() => {
    if (!targetMessageId || !teamId || !authReady || useIcpLab) return;
    let cancelled = false;

    const hydrateTargetWindow = async () => {
      const { data: target, error } = await supabase
        .from("team_messages")
        .select("id, text, image_url, created_at, edited_at, author_id, team_id, reply_to_id, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("id", targetMessageId)
        .eq("team_id", teamId)
        .is("deleted_at", null)
        .maybeSingle();

      if (cancelled || error || !target?.created_at) return;

      const windowRows = await fetchMessagesAround({
        table: "team_messages",
        scope: { team_id: teamId },
        createdAt: target.created_at,
        selectColumns:
          "id, text, image_url, created_at, edited_at, author_id, team_id, reply_to_id, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label",
        hasAnnouncements: true,
        before: 12,
        after: 24,
      });

      if (cancelled || windowRows.length === 0) return;

      const targetTime = new Date(target.created_at).getTime();
      const existingNewer = (localMessagesRef.current || []).filter(
        (message) => new Date(message.created_at).getTime() > targetTime,
      );
      const byId = new Map<string, Message>();
      [...windowRows, ...existingNewer].forEach((message: any) => byId.set(message.id, message as Message));
      const anchoredWindow = sortChatMessagesChronologically([...byId.values()]);

      // Only force a scroller remount when the target row was NOT already
      // rendered. Bumping the nonce unconditionally remounts the virtualized
      // list over already-painted content — the "messages → blank → skeleton →
      // messages" flash. When the row is present, the merged window updates in
      // place and the existing jump/align path handles positioning.
      const targetAlreadyRendered = (localMessagesRef.current || []).some((m) => m.id === targetMessageId);
      setLocalMessages((reconcileMessages(reconcileScope, anchoredWindow) ?? []) as Message[]);
      setHasOlderMessages(windowRows.length >= 13);
      if (!targetAlreadyRendered) setJumpRenderNonce(`${targetJumpNonce ?? "jump"}:${Date.now()}`);
    };

    void hydrateTargetWindow();

    return () => {
      cancelled = true;
    };
  }, [targetMessageId, targetJumpNonce, teamId, authReady, reconcileScope]);

  // Free-tier polling switch (based on parent club's Pro status).
  const { mode: teamRealtimeMode, intervalMs: teamPollIntervalMs } = useClubRealtimeMode(team?.club_id ?? null);

  useEffect(() => {
    if (!teamId || useIcpLab || teamRealtimeMode !== "polling") return;
    const id = window.setInterval(() => {
      queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
    }, teamPollIntervalMs);
    return () => window.clearInterval(id);
  }, [teamId, teamRealtimeMode, teamPollIntervalMs, queryClient, useIcpLab]);

  useEffect(() => {
    if (!teamId || useIcpLab) return;
    if (teamRealtimeMode === "polling") return;

    const channel = supabase
      .channel(`team-messages-${teamId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "team_messages",
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          // SECURITY (cross-team bleed): never trust the server-side filter
          // alone. A resubscribed/misrouted channel payload for another team is
          // dropped before it can reach this thread's cache or render state.
          if (!belongsToTeam(newMsg, teamId)) return;

          
          // Get cached profile synchronously (instant, non-blocking)
          const { cached: cachedProfiles } = getProfilesFromCache([newMsg.author_id]);
          const cachedProfile = cachedProfiles.get(newMsg.author_id);
          const currentMessages = queryClient.getQueryData<{ messages: Message[] }>(["team-messages", teamId])?.messages;
          const localReplyMessage = findLocalReplyMessage(currentMessages, newMsg.reply_to_id);
          const localReply = localReplyMessage
            ? { text: localReplyMessage.text, profiles: localReplyMessage.profiles }
            : null;
          
          // IMMEDIATELY update cache with message (don't wait for profile fetch)
          queryClient.setQueryData(["team-messages", teamId], (old: any) => {
            const existingMessages: Message[] = old?.messages || [];
            
            // Check if message already exists with real ID
            if (existingMessages.some(m => m.id === newMsg.id)) {
              return old;
            }
            
            // Check for temp message to replace — match by author AND text to avoid
            // replacing the wrong temp message when a user sends multiple messages quickly
            const tempIndex = findSupersededOptimisticIndex(existingMessages, newMsg);
            
            const messageToAdd: Message = {
              ...newMsg,
              profiles: cachedProfile 
                ? { display_name: cachedProfile.display_name, avatar_url: cachedProfile.avatar_url }
                : null,
              reactions: [],
              reply_to: localReply,
            };
            
            if (tempIndex !== -1) {
              // Replace temp message with real one, preserving profile from temp message
              const updatedMessages = [...existingMessages];
              updatedMessages[tempIndex] = {
                ...messageToAdd,
                profiles: messageToAdd.profiles?.display_name 
                  ? messageToAdd.profiles 
                  : existingMessages[tempIndex].profiles,
                reply_to: existingMessages[tempIndex].reply_to,
              };
              return { ...old, messages: updatedMessages };
            }
            
            // Add new message (from other user)
            const updatedMessages = sortChatMessagesChronologically([...existingMessages, messageToAdd]);
            return { ...old, messages: updatedMessages };
          });
          
          // Asynchronously fetch profile and reply_to data if needed, then update
          const needsProfileFetch = !cachedProfile;
          const needsReplyFetch = !!newMsg.reply_to_id && !localReplyMessage;
          
          if (needsProfileFetch || needsReplyFetch) {
            Promise.all([
              needsProfileFetch 
                ? fetchSingleProfileWithCache(newMsg.author_id)
                : Promise.resolve(cachedProfile),
              needsReplyFetch
                ? supabase
                    .from("team_messages")
                    .select("text, profiles:author_id(display_name)")
                    .eq("id", newMsg.reply_to_id)
                    .single()
                : Promise.resolve({ data: null }),
            ]).then(([profileData, replyToResult]) => {
              // Update the message with fetched data
              queryClient.setQueryData(["team-messages", teamId], (old: any) => {
                const existingMessages: Message[] = old?.messages || [];
                return {
                  ...(old || {}),
                  messages: existingMessages.map(m => {
                    if (m.id !== newMsg.id) return m;
                    return {
                      ...m,
                      // Don't overwrite club announcement metadata
                      is_club_announcement: m.is_club_announcement || newMsg.is_club_announcement || false,
                      club_announcement_name: m.club_announcement_name || newMsg.club_announcement_name || null,
                      is_system_message: m.is_system_message || newMsg.is_system_message || false,
                      profiles: profileData 
                        ? { display_name: profileData.display_name, avatar_url: profileData.avatar_url }
                        : m.profiles,
                      reply_to: replyToResult?.data
                        ? { text: replyToResult.data.text, profiles: replyToResult.data.profiles }
                        : m.reply_to,
                    };
                  }),
                };
              });
            });
          }
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "team_messages",
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any).id;
          if (!deletedId) return;
          // Tombstone so an older in-flight fetch cannot resurrect the row.
          recordRealtimeMutation(reconcileScope, { id: deletedId, deleted_at: new Date().toISOString() });
          queryClient.setQueryData(["team-messages", teamId], (old: any) => ({
            ...(old || {}),
            messages: removeMessage((old?.messages || []) as Message[], deletedId),
          }));
          setLocalMessages((prev) => (prev ? removeMessage(prev, deletedId) : prev));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "team_messages",
          filter: `team_id=eq.${teamId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (!updated?.id) return;
          // SECURITY (cross-team bleed): drop UPDATE payloads for another team.
          if (!belongsToTeam(updated, teamId)) return;
          // Record first so any query response already in flight is reconciled
          // when it lands (stale-fetch resurrection guard). Idempotent.
          const outcome = recordRealtimeMutation(reconcileScope, updated);

          if (outcome === "deleted") {
            queryClient.setQueryData(["team-messages", teamId], (old: any) => ({
              ...(old || {}),
              messages: removeMessage((old?.messages || []) as Message[], updated.id),
            }));
            setLocalMessages((prev) => (prev ? removeMessage(prev, updated.id) : prev));
            return;
          }

          // Apply the edit to BOTH stores with the same pure helper so they
          // can never diverge. Fields absent from the payload are preserved.
          queryClient.setQueryData(["team-messages", teamId], (old: any) => ({
            ...(old || {}),
            messages: applyMessageUpdate((old?.messages || []) as Message[], updated),
          }));
          setLocalMessages((prev) => (prev ? applyMessageUpdate(prev, updated) : prev));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction?.team_message_id || !reaction.id) return;
          applyRealtimeReaction(reaction.team_message_id, reaction);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "message_reactions" },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction?.team_message_id || !reaction.id) return;
          applyRealtimeReaction(reaction.team_message_id, reaction);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          const deleted = payload.old as any;
          if (!deleted?.id) return;
          applyRealtimeReactionDelete(deleted.team_message_id ?? null, deleted.id);
        }
      );
    return startChatRealtimeChannel({
      channel,
      channelKey: `team-messages-${teamId}`,
      userId: user?.id,
      scope: { kind: "team", id: teamId },
    });
  }, [teamId, queryClient, teamRealtimeMode, user?.id, reconcileScope, applyRealtimeReaction, applyRealtimeReactionDelete]);

  const handleReply = useCallback((m: { id: string; text: string; authorName: string | null }) => {
    // Don't allow replying to optimistic or queued messages (temp/queued IDs)
    if (m.id.startsWith('temp-') || m.id.startsWith('queued-')) {
      toast.error("Please wait for the message to be sent before replying");
      return;
    }
    setReplyingTo(m);
    const ta = composerRef.current?.querySelector("textarea") as HTMLTextAreaElement | null;
    ta?.focus();
    // Re-pin in stages so the latest message stays above the composer as the
    // reply pill renders AND the Android keyboard finishes opening.
    [0, 180, 480].forEach((delay) => {
      setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), delay);
    });
  }, []);

  const queryKeyMemo = useMemo(() => ["team-messages", teamId!], [teamId]);

  // Vault mirroring runs ONLY for confirmed-delivered messages (see
  // `chatSendResult`). Fire-and-forget: a Vault failure must never turn a
  // delivered chat message into a failed send.
  const clubIdForVault = team?.club_id ?? null;
  const syncDeliveredMessageToVault = useChatVaultDeliverySync({
    userId: user?.id,
    scope: clubIdForVault && teamId ? { clubId: clubIdForVault, teamId } : null,
    surfaceLabel: "Team chat",
  });
  const syncSendToVault = useCallback(
    (vars: { text: string; image_url: string | null }) => {
      syncDeliveredMessageToVault({ text: vars.text, imageUrl: vars.image_url });
    },
    [syncDeliveredMessageToVault],
  );

  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, image_url, reply_to_id }: { text: string; image_url: string | null; reply_to_id: string | null }) => {
      // Lab mode: optimistic cache-only delivery, no backend write and no persistence.
      if (useIcpLab) {
        const localMessage = await sendLocalTeamMessage(
          localIcpPersona,
          teamId!,
          text,
          `team-${teamId}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
        );
        queryClient.setQueryData(["team-messages", teamId], (current: any) => ({
          ...(current ?? { hasOlderMessages: false, fromCache: false }),
          messages: [...(current?.messages ?? []), localMessage],
        }));
        return deliveredSend();
      }

      // If offline, queue the message instead
      if (!navigator.onLine) {
        queueMessage({
          type: "team",
          targetId: teamId!,
          authorId: user!.id,
          text,
          imageUrl: image_url,
          replyToId: reply_to_id,
          createdAt: new Date().toISOString(),
          vault: clubIdForVault ? { clubId: clubIdForVault, teamId } : null,
        });
        toast.info("Message queued - will send when online");
        return queuedSend();
      }
      
      const { error } = await supabase.from("team_messages").insert({
        team_id: teamId!,
        author_id: user!.id,
        text,
        image_url,
        reply_to_id,
      });
      if (error) throw error;
      return deliveredSend();
    },
    onMutate: async ({ text, image_url, reply_to_id }) => {
      const currentProfile = profileRef.current;

      await queryClient.cancelQueries({ queryKey: ["team-messages", teamId] });

      // Mutation-specific temp id so overlapping sends can be rolled back
      // independently (Date.now() alone collides on rapid double-sends).
      const tempId = createSendTempId();
      const sentAtMs = Date.now();
      const previousReplyingTo = replyingTo;
      const { baseText: unsentText, pollId: unsentPollId } = splitPollMarkup(text);


      const optimisticMessage: Message = {
        id: tempId,
        team_id: teamId!,
        author_id: user!.id,
        text,
        image_url,
        reply_to_id,
        created_at: new Date().toISOString(),
        profiles: {
          display_name: currentProfile?.display_name || "You",
          avatar_url: currentProfile?.avatar_url || null,
        },
        reactions: [],
        reply_to: replyingTo ? { text: replyingTo.text, profiles: { display_name: replyingTo.authorName } } : null,
      };

      // Update query cache directly (this will sync to localMessages via useEffect)
      queryClient.setQueryData(["team-messages", teamId], (old: any) => {
        const existingMessages: Message[] = old?.messages || [];
        return {
          ...(old || {}),
          messages: [...existingMessages, optimisticMessage],
        };
      });

      // Append to local render state in the SAME batch as the composer clear
      // below. React Query notifies subscribers on a setTimeout(0), so relying
      // on the cache→localMessages sync alone lands the new row a task AFTER
      // the composer has collapsed: frame 1 the thread drops with the
      // composer, frame 2 it rises for the row — the post-send "shake". The
      // later cache sync dedupes by id, so this never double-renders.
      setLocalMessages((prev) => (prev && !prev.some((m) => m.id === tempId) ? [...prev, optimisticMessage] : prev));

      // Clear input immediately
      setMessage("");
      setImageUrl(null);
      setReplyingTo(null);
      setPendingPollId(null);
      setPendingNewsId(null);
      
      // Scroll to bottom to show new message — force=true bypasses the
      // "user is touching viewport" guard, which can spuriously cancel the
      // post-send re-pin if the send-button tap is still in contact when
      // the deferred frames run (composer reflow + bottomPadding shrink
      // would otherwise leave the new bubble below the visible area).
      virtualHandleRef.current?.scrollToBottom("auto", { force: true });

      return {
        tempId,
        sentText: unsentText,
        sentImageUrl: image_url ?? null,
        previousReplyTarget: previousReplyingTo,
        pendingPollId: unsentPollId,
        sentAtMs,
      } satisfies FailedSendContext<typeof previousReplyingTo>;
    },
    onError: (err, variables, context) => {
      // If offline, don't revert - message is queued
      if (!navigator.onLine) return;

      // If the insert actually landed and arrived via realtime, treat it as a
      // success: no failure toast and no draft restoration.
      const current = queryClient.getQueryData<{ messages: Message[] }>(["team-messages", teamId]);
      if (authoritativeMessageExists(current?.messages, { authorId: user?.id, text: variables.text, imageUrl: variables.image_url ?? null, replyToId: variables.reply_to_id ?? null, sentAtMs: context?.sentAtMs })) {
        // Errored request, confirmed delivery: same Vault handling as success.
        syncSendToVault(variables);
        return;
      }

      const tempId = context?.tempId;
      if (tempId) {
        // Remove ONLY this mutation's optimistic row, regardless of whether a
        // previous cache snapshot existed. Never restore a whole snapshot —
        // that would discard newer realtime rows / concurrent optimistic sends.
        queryClient.setQueryData(["team-messages", teamId], (old: any) => {
          if (!old) return old;
          const existingMessages: Message[] = old?.messages || [];
          return { ...old, messages: existingMessages.filter((m) => m.id !== tempId) };
        });
        setLocalMessages((prev) => (prev ? prev.filter((m) => m.id !== tempId) : prev));
      }

      // Restore each composer field only when its slot is still empty.
      restoreFailedSendComposer({
        context,
        setText: setMessage,
        setImage: setImageUrl,
        setReply: setReplyingTo,
        setPoll: setPendingPollId,
      });

      console.error("Failed to send team message", err);
      toast.error("Failed to send message");
    },

    onSuccess: (result, variables) => {
      if (isConfirmedDelivery(result)) syncSendToVault(variables);
    },

    onSettled: (_, __, variables) => {
      if (useIcpLab) return;

      // Invalidate messages page preview so latest message shows
      queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages"] });
      // Award engagement points (fire and forget)
      if (user && team?.club_id && teamId) {
        import("@/lib/engagementPoints").then(({ awardEngagementPoints }) => {
          awardEngagementPoints({
            userId: user.id,
            clubId: team.club_id,
            action: "chat_message",
            scopeId: teamId,
          }).catch(() => {});
        });
      }
    },
  });

  const updateMessageMutation = useMutation({
    mutationFn: async () => {
      if (!editingMessage) return;
      if (useIcpLab) {
        throw new Error("Editing team messages is not available in the local ICP contract.");
      }
      const { error } = await supabase.from("team_messages").update({ text: message.trim() }).eq("id", editingMessage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("");
      setEditingMessage(null);
      if (useIcpLab) return;
      queryClient.invalidateQueries({ queryKey: queryKeyMemo });
      // silent success
    },
    onError: () => toast.error("Failed to update message"),
  });

  const handleSend = () => {
    try { window.dispatchEvent(new Event("chat:message-sent")); } catch { /* noop */ }
    // Keep the composer focused through the tap. NEVER blur-to-flush the IME
    // here: on Android a blur → refocus round-trip fires a real
    // keyboardWillHide/keyboardWillShow pair, which collapses and restores
    // the chat viewport (composer drops to the bottom nav, thread grows,
    // then snaps back) — the post-send "thread jumps up and back". Composer
    // state already mirrors every IME composition update, so reading it
    // directly sends exactly what the user sees. See src/lib/chatComposerFocus.ts.
    keepComposerFocusedThroughSend(composerRef.current);

    if (!message.trim() && !imageUrl && !pendingPollId && !pendingNewsId) return;
    if (!user?.id || !teamId) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
      return;
    }
    const baseText = message.trim();
    let finalText = pendingPollId
      ? (baseText ? `${baseText} [poll:${pendingPollId}]` : `[poll:${pendingPollId}]`)
      : baseText;
    if (pendingNewsId) {
      finalText = finalText ? `${finalText} [news:${pendingNewsId}]` : `[news:${pendingNewsId}]`;
    }
    const hadImage = !!imageUrl;
    sendMessageMutation.mutate({ text: finalText, image_url: imageUrl, reply_to_id: replyingTo?.id || null });
    if (hadImage) nudgeGalleryAfterSend();
  };


  const handleEdit = useCallback((msg: { id: string; text: string }) => {
    setEditingMessage(msg);
    setMessage(msg.text);
    setReplyingTo(null);
  }, []);

  const {
    publishingIds,
    publishedIds,
    publish: handlePublishToGallery,
    nudgeAfterSend: nudgeGalleryAfterSend,
  } = usePublishChatImage({
    uploaderId: user?.id,
    teamId: teamId ?? null,
    clubId: team?.club_id ?? null,
  });
  const { withinMatchWindow: galleryWindowOpen } = useRecentMatchWindow({
    teamId: teamId ?? null,
  });

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setMessage("");
  }, []);

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // Full-history server-side search: when the user types a query, fetch any
  // matching messages older than what's already loaded and merge them in so
  // the existing client-side filter + highlight covers the entire history.
  const { isSearching: isSearchFetching, canShowEmpty: searchCanShowEmpty } = useChatHistorySearch<Message>({
    searchQuery,
    loadedMessages: localMessages,
    setMessages: (updater) => setLocalMessages((prev) => updater(prev)),
    enabled: !!teamId,
    cacheKey: `team:${teamId ?? ""}`,
    fetcher: async (q, signal) =>
      useIcpLab
        ? (localMessagesRef.current ?? []).filter((row) => fuzzyMatchesQuery(row.text, q))
        : createChatHistorySearchFetcher<Message>({
            scope: TEAM_CHAT_SCOPE,
            scopeId: teamId,
            selectColumns:
              "id, text, image_url, created_at, edited_at, author_id, team_id, reply_to_id, is_club_announcement, club_announcement_name, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label",
            hasAnnouncements: true,
          })(q, signal),
  });

  const filteredMessages = useMemo(
    () => filterChatMessagesForSearch(localMessages, searchQuery),
    [localMessages, searchQuery],
  );

  const firstMatchId = searchQuery.trim() ? filteredMessages?.[0]?.id ?? null : null;
  const lastCenteredKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (isSearchFetching) return;
    if (!firstMatchId) {
      lastCenteredKeyRef.current = null;
      return;
    }
    const key = `${searchQuery}|${firstMatchId}`;
    if (lastCenteredKeyRef.current === key) return;
    const idx = (filteredMessages ?? []).findIndex((m) => m.id === firstMatchId);
    if (idx < 0) return;
    lastCenteredKeyRef.current = key;
    requestAnimationFrame(() => virtualHandleRef.current?.scrollToIndex(idx, "center"));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstMatchId, isSearchFetching, searchQuery]);

  // Message IDs for read tracking
  const messageIds = useMemo(() => 
    (filteredMessages || []).map(m => m.id).filter(id => !id.startsWith('temp-')),
    [filteredMessages]
  );

  // Read tracking
  const { readCounts, readFrontier, markMessagesAsRead } = useMessageReads(
    "team",
    teamId || "",
    messageIds,
    user?.id
  );

  // Typing indicator
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(
    `team-${teamId}`,
    user?.id,
    profile?.display_name || undefined
  );

  useMarkVisibleChatMessagesRead({
    messages: filteredMessages,
    userId: user?.id,
    markMessagesAsRead,
  });

  // Live online count for the team — only shown in the header sublabel when > 0.
  const teamOnlineCount = useChatOnlineCount("team", teamId, { enabled: chatReady });
  const onlineLabel = teamOnlineCount > 0 ? `${teamOnlineCount} online` : null;
  const teamHeaderSublabel = team?.clubs?.name
    ? onlineLabel
      ? `${team.clubs.name} · ${onlineLabel}`
      : team.clubs.name
    : onlineLabel || undefined;

  // `team` may come from the local metadata cache; only gate when it's absent.
  const teamMetadataState = resolveChatMetadataState({
    data: team,
    isLoading: loadingTeam,
    isError: teamIsError,
    fetchStatus: teamFetchStatus,
    status: teamStatus,
    isOnline: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  });

  if (teamMetadataState === "loading") {
    return <ChatPageSkeleton title="Team chat" />;
  }

  if (teamMetadataState === "unreachable") {
    return (
      <ChatUnreachable
        label="team chat"
        onRetry={() => void refetchTeam()}
        retrying={teamIsFetching}
      />
    );
  }

  if (!team) {
    return <div className="py-6 text-center text-muted-foreground">Team not found</div>;
  }


  return (
    <div className="flex min-h-0 flex-col overflow-hidden overscroll-none" style={{ height: chatHeight }} data-lock-keyboard-scroll="true" onTouchStart={swipeBack.onTouchStart} onTouchEnd={swipeBack.onTouchEnd}>
      {/* Header */}
      <TeamChatHeaderSection
        team={team}
        teamId={teamId!}
        teamHeaderSublabel={teamHeaderSublabel}
        isAdmin={!!isAdmin}
        searchOpen={searchOpen}
        onSearchOpenChange={setSearchOpen}
        onSearch={setSearchQuery}
        isSearchFetching={isSearchFetching}
        membersOpen={membersOpen}
        onMembersOpenChange={setMembersOpen}
        inviteSheetOpen={inviteSheetOpen}
        onInviteSheetOpenChange={setInviteSheetOpen}
        onManualRefresh={handleManualRefresh}
        isAnyRefreshing={isAnyRefreshing}
        scheduleMessageAvailable={!!scheduleTarget}
        onOpenScheduleDialog={() => setScheduleDialogOpen(true)}
        scheduleMessageLocked={!clubProLoading && !clubHasPro}
        summarizeAvailable={!aiCatchUpDisabled && clubHasPro}
        onSummarizeMessages={() => summarizeTriggerRef.current?.()}
        summarizeLocked={!clubProLoading && !clubHasPro}
        pinnedVault={pinnedVault}
        pinnedVaultLocked={pinnedVaultLocked}
        onOpenPinVaultSheet={() => setPinVaultSheetOpen(true)}
      />
      {/* Notification Nudge — deferred until after initial chat reveal to prevent post-pin jolt */}
      {bannersReady && notificationNudge.shouldShowNudge && (
        <div className="px-4 pt-2 shrink-0">
          <NotificationNudgeBanner
            message="Enable notifications so you never miss team messages"
            onDismiss={notificationNudge.dismiss}
            userId={user?.id}
          />
        </div>
      )}

      {/* Pinned vault banner — deferred to prevent post-pin layout shift */}
      {bannersReady && (
        <PinnedVaultBanner
          record={pinnedVault.record}
          isAdmin={!!isAdmin}
          onUnpin={
            pinnedVault.record && (isAdmin || pinnedVault.record.set_by === user?.id)
              ? () => pinnedVault.remove()
              : undefined
          }
        />
      )}

      {/* Pinned messages banner — deferred to prevent post-pin layout shift */}
      {bannersReady && (
        <PinnedMessagesBanner
          pins={pinnedMessages}
          onJumpToMessage={handleJumpToMessage}
          onUnpin={unpinMessage}
        />
      )}


      {teamId && (
        <Suspense fallback={null}>
        <PinVaultSheet
          open={pinVaultSheetOpen}
          onOpenChange={setPinVaultSheetOpen}
          chatType="team"
          chatId={teamId}
          clubId={team.club_id ?? null}
          teamId={teamId}
        />
        </Suspense>
      )}

      {/* Sponsor / Ad strip (per-club opt-in; never enters message stream) */}
      <ChatThreadSponsorStrip clubId={team?.club_id ?? null} />

      <ChatCatchUp
        scope_type="team"
        scope_id={teamId}
        unreadCount={teamUnreadCount}
        latestMessageId={filteredMessages?.[filteredMessages.length - 1]?.id ?? null}
        proLocked={!clubProLoading && !clubHasPro}
        upgradeHref={team?.club_id ? `/clubs/${team.club_id}/upgrade` : undefined}
        registerTrigger={(fn) => { summarizeTriggerRef.current = fn; }}
      />

      {/* Messages */}
      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden overscroll-none">
        {showLoading || !bannersReady ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-16 w-3/4" />
            ))}
          </div>
        ) : (isSearchFetching || (!!searchQuery && !searchCanShowEmpty)) ? (
          <ChatSearchLoadingState />
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState
            title="No messages yet"
            subtitle="Be the first to say something!"
            isSearchResult={!!searchQuery}
          />
        ) : (
          <ChatMessagesScroller
            key={scrollerKey}
            messages={filteredMessages || []}
            hasOlderMessages={hasOlderMessages}
            isLoadingOlder={isLoadingOlder}
            onLoadOlder={loadOlderMessages}
            isPinned={isPinned}
            isKeyboardOpen={isKeyboardOpen}
            searchOpen={searchOpen}
            composerHeight={composerHeight}
            currentUserId={user?.id}
            virtualHandleRef={virtualHandleRef}
            initialBottomPinned={!targetMessageId}
            initialTargetMessageId={targetMessageId}
            renderRow={(msg, index, arr) => {
              const currentDate = new Date(msg.created_at);
              const prevMessage = index > 0 ? arr[index - 1] : null;
              const nextMessage = index < arr.length - 1 ? arr[index + 1] : null;
              const showDateSeparator = !prevMessage || !isSameDay(currentDate, new Date(prevMessage.created_at));
              const groupedWithPrev = !showDateSeparator && shouldGroupWithPrev(msg, prevMessage);
              const groupedWithNext = nextMessage
                ? isSameDay(currentDate, new Date(nextMessage.created_at)) && shouldGroupWithPrev(nextMessage, msg)
                : false;
              return (
                <>
                  {showDateSeparator && <ChatDateSeparator date={currentDate} />}
                  <div
                    id={`message-${msg.id}`}
                    role={searchQuery ? "button" : undefined}
                    tabIndex={searchQuery ? 0 : undefined}
                    onClick={searchQuery ? () => handleSearchResultClick(msg.id) : undefined}
                    onKeyDown={searchQuery ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSearchResultClick(msg.id); } } : undefined}
                    className={`transition-colors duration-500 ${
                      highlightedMessageId === msg.id ? "bg-primary/10 rounded-lg" : ""
                    } ${searchQuery ? "cursor-pointer hover:bg-muted/40 rounded-lg" : ""}`}
                  >
                    <ChatMessage
                      id={msg.id}
                      text={msg.text}
                      imageUrl={msg.image_url}
                      authorId={msg.author_id}
                      authorName={msg.is_club_announcement ? (msg.club_announcement_name || "Club") : (getProfile(msg.author_id)?.display_name || msg.profiles?.display_name || null)}
                      authorAvatar={getProfile(msg.author_id)?.avatar_url || msg.profiles?.avatar_url || null}
                      timestamp={formatMessageDate(msg.created_at)}
                      isOwn={msg.is_club_announcement ? false : msg.author_id === user?.id}
                      isAdmin={isAdmin || false}
                      reactions={msg.reactions}
                      currentUserId={user?.id}
                      messageType="team"
                      queryKey={queryKeyMemo}
                      replyToMessage={
                        msg.reply_to
                          ? { text: msg.reply_to.text, authorName: msg.reply_to.profiles?.display_name || null }
                          : null
                      }
                      hasReply={!!msg.reply_to_id}
                      isEdited={!!(msg as any).edited_at}
                      onReply={handleReply}
                      onEdit={useIcpLab ? undefined : handleEdit}
                      onAuthorClick={
                        !msg.is_club_announcement && isAdmin && msg.author_id !== user?.id
                          ? () => handleMemberProfileTap(
                              msg.author_id,
                              getProfile(msg.author_id)?.display_name || msg.profiles?.display_name || "Unknown User",
                              getProfile(msg.author_id)?.avatar_url || msg.profiles?.avatar_url || null,
                            )
                          : undefined
                      }
                      searchQuery={searchQuery || highlightQuery}
                      readFrontierReaders={readFrontier[msg.id] || []}
                      readCount={readCounts[msg.id] || 0}
                      isLastMessage={index === arr.length - 1}
                      isLastOwnMessage={msg.author_id === user?.id && !arr.slice(index + 1).some((m: any) => m.author_id === user?.id)}
                      isPending={msg.id.startsWith("queued-")}
                      contextId={teamId || ""}
                      isClubAnnouncement={msg.is_club_announcement}
                      isSystemMessage={msg.is_system_message}
                      isPinned={pinnedMessageIds.has(msg.id)}
                      canPin={!msg.is_club_announcement && !msg.id.startsWith("queued-")}
                      pinLimitReached={!canPinMore && !pinnedMessageIds.has(msg.id)}
                      onPin={pinMessage}
                      onUnpin={unpinMessage}
                      canPublishToGallery={galleryWindowOpen && msg.author_id === user?.id && !!msg.image_url && !msg.id.startsWith("queued-")}
                      isPublishingToGallery={publishingIds.has(msg.id)}
                      isPublishedToGallery={publishedIds.has(msg.id)}
                      onPublishToGallery={handlePublishToGallery}
                      groupedWithPrev={groupedWithPrev}
                      groupedWithNext={groupedWithNext}
                    />
                  </div>
                </>
              );
            }}
          />
         )}
        </div>


      {/* Input - Fixed at bottom above nav bar */}
      <TeamChatComposerFooter
        composerRef={composerRef}
        searchOpen={searchOpen}
        nativeKbHeight={nativeKbHeight}
        typingUsers={typingUsers}
        replyingTo={replyingTo}
        onCancelReply={() => setReplyingTo(null)}
        editingMessage={editingMessage}
        onCancelEdit={handleCancelEdit}
        scheduleTarget={scheduleTarget}
        scheduleDialogOpen={scheduleDialogOpen}
        onScheduleDialogOpenChange={setScheduleDialogOpen}
        onScheduled={() => {
          setMessage("");
          setImageUrl(null);
          clearDraft?.();
        }}
        pendingPollId={pendingPollId}
        onPendingPollIdChange={setPendingPollId}
        pendingNewsId={pendingNewsId}
        onPendingNewsIdChange={setPendingNewsId}
        isSending={sendMessageMutation.isPending}
        imageUrl={imageUrl}
        onImageUploaded={setImageUrl}
        clubId={team?.club_id}
        teamId={teamId}
        eventPickerOpen={eventPickerOpen}
        onEventPickerOpenChange={setEventPickerOpen}
        newsPickerOpen={newsPickerOpen}
        onNewsPickerOpenChange={setNewsPickerOpen}
        boardPickerOpen={boardPickerOpen}
        onBoardPickerOpenChange={setBoardPickerOpen}
        pollDialogOpen={pollDialogOpen}
        onPollDialogOpenChange={setPollDialogOpen}
        message={message}
        onMessageChange={setMessage}
        onStartTyping={startTyping}
        onStopTyping={stopTyping}
        onKeyPress={handleKeyPress}
        onSend={handleSend}
      />

      {teamId && team && (
        <TeamMemberManagementSheets
          teamId={teamId}
          teamName={team.name}
          clubId={team.club_id}
          currentUserId={user?.id}
          selectedMember={selectedMember}
          onSelectedMemberChange={setSelectedMember}
          addRoleMember={addRoleMember}
          onAddRoleMemberChange={setAddRoleMember}
          onRemoveMember={handleRemoveSelectedMemberFromTeam}
          onRemoveRole={handleRemoveRoleFromSelectedMember}
          onRoleDialogClosed={() => {
            queryClient.invalidateQueries({ queryKey: ["team-messages", teamId] });
            refreshChatManagedTeamMembership(queryClient, teamId, "team", teamId);
          }}
        />
      )}
    </div>
  );
}
