import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect, Suspense } from "react";
import { useChatLoadingLatch } from "@/hooks/useChatLoadingLatch";
import { consumePendingChatJump, getLastConsumedPendingChatJumpTs, subscribePendingChatJump, type PendingChatJumpPayload } from "@/lib/pendingChatJump";
import { resolveChatJumpTarget } from "@/lib/resolveChatJumpTarget";
import { fuzzyMatchesQuery } from "@/lib/fuzzySearch";
import { filterChatMessagesForSearch } from "@/features/messaging/thread/chatSearchPresentation";
import { useChatDraft, useChatDraftReply } from "@/hooks/useChatDraft";
import { useSyncActiveClubToChat } from "@/hooks/useSyncActiveClubToChat";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { ChatMessagesScroller } from "@/components/chat/ChatMessagesScroller";
import { debugLogEvent } from "@/components/chat/chatVirtDebug";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import { useRealtimeReactionSync } from "@/hooks/useRealtimeReactionSync";
import { reconcileFlatReactions } from "@/lib/chatReactionReconciliation";
import {
  reconcileMessages,
  clearReconciliationScope,
} from "@/lib/chatMessageReconciliation";
import { createSendTempId, splitPollMarkup, restoreFailedSendComposer, authoritativeMessageExists, type FailedSendContext } from "@/lib/failedSendRestore";
import { deliveredSend, queuedSend, isConfirmedDelivery } from "@/lib/chatSendResult";

import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { useMeasuredElementHeight } from "@/hooks/useMeasuredElementHeight";
import { keepComposerFocusedThroughSend } from "@/lib/chatComposerFocus";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";
import { useChatVaultDeliverySync } from "@/hooks/useChatVaultDeliverySync";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { markChatScopeNotificationsRead } from "@/lib/markChatScopeRead";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { canPostInCompetitionChat, competitionChatSublabel } from "@/features/competitions/competitionChatScope";

import { ArrowLeft, Search, UserPlus, ChevronRight, Lock } from "lucide-react";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { ChatHeaderShell } from "@/components/chat/ChatHeaderShell";
import { ChatDetailsSheet } from "@/components/chat/ChatDetailsSheet";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { ChatCatchUp } from "@/components/chat/ChatCatchUp";
import { markChatOpened } from "@/hooks/useChatCatchUp";
import { useAICatchUpAvailability } from "@/hooks/useAICatchUpAvailability";
import { useUnreadMessageCounts } from "@/hooks/useUnreadMessageCounts";
import { useChatOnlineCount } from "@/hooks/useChatOnlineCount";
import { useChatPageReady } from "@/hooks/useChatPageReady";
import { ChatSearchBar, ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { createChatHistorySearchFetcher } from "@/features/messaging/thread/chatHistorySearchFetcher";
import { GROUP_CHAT_SCOPE } from "@/features/messaging/scopes/chatScopeAdapters";
import {
  attachReactionsToMessages,
  EMPTY_REACTIONS,
  getCachedGroupMessages,
  REACTION_EMOJIS,
  type ChatGroup,
  type GroupMessage,
  type MessageReaction,
} from "@/features/messaging/thread/groupChatData";
import { useGroupLocalMessagesSync } from "@/features/messaging/thread/useGroupLocalMessagesSync";
import { useGroupMessagesQuery } from "@/features/messaging/thread/useGroupMessagesQuery";
import { useGroupDeleteChat } from "@/features/messaging/thread/useGroupDeleteChat";
import { useGroupMessageEditDelete } from "@/features/messaging/thread/useGroupMessageEditDelete";
import { useGroupOlderMessagesLoader } from "@/features/messaging/thread/useGroupOlderMessagesLoader";
import { useGroupReactionToggle } from "@/features/messaging/thread/useGroupReactionToggle";
import { useGroupRealtimeUpdates } from "@/features/messaging/thread/useGroupRealtimeUpdates";
import { useGroupTargetWindowHydration } from "@/features/messaging/thread/useGroupTargetWindowHydration";
import { fetchMessagesAround } from "@/lib/fetchMessagesAround";

import { PageLoading } from "@/components/ui/page-loading";
import { ChatPageSkeleton } from "@/components/chat/ChatPageSkeleton";
import { GroupChatComposerFooter } from "@/components/chat/GroupChatComposerFooter";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";
import EditGroupDialog from "@/components/chat/EditGroupDialog";
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


const MESSAGES_PER_PAGE = 30;
import { toast } from "sonner";
// EmojiPicker is built into MentionInput
import { GroupChatMessageRow } from "@/components/chat/GroupChatMessageRow";
import { usePublishChatImage } from "@/hooks/usePublishChatImage";
import { useRecentMatchWindow } from "@/hooks/useRecentMatchWindow";
import { PinnedMessagesBanner } from "@/components/chat/PinnedMessagesBanner";
import { PinnedVaultBanner } from "@/components/chat/PinnedVaultBanner";
import { useChatPinnedVault } from "@/hooks/useChatPinnedVault";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { useUserHasAnyClubPro } from "@/hooks/useUserHasAnyClubPro";
import { useClubRealtimeMode } from "@/hooks/useClubRealtimeMode";
import { usePinnedMessages } from "@/hooks/usePinnedMessages";
import { jumpToMessageInVirtualizedChat } from "@/lib/jumpToMessage";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { MessageContent } from "@/components/chat/MessageContent";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";

import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { useMessageReads } from "@/hooks/useMessageReads";
import { useMarkVisibleChatMessagesRead } from "@/hooks/useMarkVisibleChatMessagesRead";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { MessageReadAvatars } from "@/components/chat/MessageReadAvatars";
import { fetchProfilesWithCache } from "@/lib/profileCache";
import { useProfiles } from "@/hooks/useProfiles";
import { shouldRefetchMessages } from "@/lib/messageCache";
import {
  classifyChatThreadState,
  nextEmptyRetryDelay,
  isUsableCachedThread,
} from "@/lib/chatThreadLoadState";

import { consumeFromNotificationFlag } from "@/lib/notificationPreload";
import { logChatOpenLatency } from "@/lib/chatOpenLatency";
import { useChatPerfMarks } from "@/hooks/useChatPerfMarks";
import { useOnlineStatus } from "@/hooks/useOnlineStatus";
import { queueMessage } from "@/lib/messageQueue";
import { Capacitor } from "@capacitor/core";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
const AddMiniLeagueMemberSheet = lazyWithRetry(() => import("@/components/AddMiniLeagueMemberSheet").then(m => ({ default: m.AddMiniLeagueMemberSheet })));
import { noteChatMount, noteChatUnmount } from "@/lib/chatPerfDiagnostics";
import { shouldSkipChatMountInvalidate } from "@/lib/chatMountInvalidate";
import { useChatStuckWatchdog } from "@/lib/chatStuckWatchdog";
import { resolveChatMetadataState } from "@/lib/chatMetadataGate";
import { ChatUnreachable } from "@/components/chat/ChatUnreachable";
import { isChatEagerInvalidateEnabled, ensureSessionApplied } from "@/lib/chatEagerInvalidate";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
const PinVaultSheet = lazyWithRetry(() => import("@/components/chat/PinVaultSheet").then(m => ({ default: m.PinVaultSheet })));
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import * as fixtureData from "@/lab/fixtureDataLayer";
import { orderChatMessagesChronologically } from "@/lab/chatMessageOrdering";


export default function GroupChatPage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("GroupChat", null);
    debugLogEvent("page-mount", {});
    return () => {
      debugLogEvent("page-unmount", {});
      noteChatUnmount("GroupChat", k, null);
    };
  }, []);
  const { groupId } = useParams<{ groupId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile, refreshUnreadCount, decrementUnreadCount, initialized } = useAuth();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const notificationNudge = useNotificationNudge(user?.id, "chat");
  const swipeBack = useSwipeBack();
  const queryClient = useQueryClient();
  const authReady = !!user && initialized;
  const openedFromNotificationRef = useRef<number | null>(
    groupId ? consumeFromNotificationFlag("group", groupId) : null,
  );
  const mountTsRef = useRef<number>(Date.now());
  const perfLoggedRef = useRef<boolean>(false);
  const [message, setMessage, clearDraft] = useChatDraft(groupId);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const [miniLeagueInviteOpen, setMiniLeagueInviteOpen] = useState(false);
  const scheduleTarget: ScheduleTarget | null = groupId
    ? { chat_type: "group", group_id: groupId }
    : null;
  const [replyTo, setReplyTo] = useChatDraftReply<GroupMessage>(groupId);
  const [editingMessage, setEditingMessage] = useState<GroupMessage | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [newsPickerOpen, setNewsPickerOpen] = useState(false);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);
  const [pendingNewsId, setPendingNewsId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  // Persists the search text after the user taps a result so highlights
  // remain visible on the jumped-to message. Cleared when the highlight
  // ring fades (via effect below on highlightedMessageId).
  const [highlightQuery, setHighlightQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [membersOpen, setMembersOpen] = useState(false);
  const [showEditGroupDialog, setShowEditGroupDialog] = useState(false);
  const [pinVaultSheetOpen, setPinVaultSheetOpen] = useState(false);
  const chatReady = useChatPageReady();
  const pinnedVault = useChatPinnedVault("group", groupId, { enabled: chatReady });
  const [showDeleteGroupDialog, setShowDeleteGroupDialog] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  // When the highlight ring clears, drop the persisted search highlight too.
  useEffect(() => {
    if (!highlightedMessageId && highlightQuery) setHighlightQuery("");
  }, [highlightedMessageId, highlightQuery]);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [jumpRenderNonce, setJumpRenderNonce] = useState<number | string | null>(null);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const useVirtualizedChat = true;
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const isNativePlatform = Capacitor.isNativePlatform();

  // Mark group message notifications as read when opening this thread
  useEffect(() => {
    if (!user || !groupId) return;
    markChatScopeNotificationsRead({
      userId: user.id,
      scope: { kind: "group", groupId },
      queryClient,
      decrementUnreadCount,
      refreshUnreadCount,
    });
  }, [user, groupId, refreshUnreadCount, decrementUnreadCount, queryClient]);

  // AI Chat Recap wiring.
  useEffect(() => { if (groupId) markChatOpened("group", groupId); }, [groupId]);
  const summarizeTriggerRef = useRef<(() => void) | null>(null);
  const { featureDisabled: aiCatchUpDisabled } = useAICatchUpAvailability("group", groupId);
  const { data: groupUnreadCount = 0 } = useUnreadMessageCounts<number>(user?.id ?? null, {
    enabled: !!groupId,
    select: (d) => (groupId ? d.groups[groupId] ?? 0 : 0),
  });


  
  // Use ref to always get latest profile value in mutation callback
  const profileRef = useRef(profile);
  profileRef.current = profile;
  // Legacy DOM refs are no longer attached (Virtuoso owns scroll). Kept as
  // null refs for any non-scroll code paths that still pass them around.
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const loadTriggerRef = useRef<HTMLDivElement>(null);
  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const { elementRef: composerRef, height: composerHeight } = useMeasuredElementHeight<HTMLDivElement>(
    [replyTo?.id, editingMessage?.id],
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
  const liveJumpId = liveJump?.kind === "group" && liveJump.targetId === groupId ? liveJump.messageId : null;
  const urlJumpNonce = searchParams.get("jump");
  const [fallbackJumpId] = useState(() =>
    groupId ? consumePendingChatJump("group", groupId) : null,
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

  // Diagnostics: the ChatMessagesScroller key — any change fully remounts the list.
  const scrollerKey = targetMessageId
    ? `group-jump:${groupId}:${targetMessageId}:${jumpRenderNonce ?? targetJumpNonce ?? "initial"}`
    : `group:${groupId}`;
  const scrollerKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (scrollerKeyRef.current !== null && scrollerKeyRef.current !== scrollerKey) {
      debugLogEvent("scroller-key-change", { from: scrollerKeyRef.current, to: scrollerKey });
    }
    scrollerKeyRef.current = scrollerKey;
  }, [scrollerKey]);

  // Scroll to and highlight the message referenced by ?message=… (notification deep link).
  // Optional ?parent=… provides a thread fallback if the target reply hasn't loaded yet.
  useLayoutEffect(() => {
    if (!targetMessageId) return;
    const cancel = jumpToMessageInVirtualizedChat(
      targetMessageId,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      {
        tryLoadOlder: () => loadOlderMessagesRef.current?.(),
        refetchLatest: () => queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] }),
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
  } = usePinnedMessages("group", groupId, { enabled: chatReady });
  const handleJumpToMessage = (mid: string) =>
    jumpToMessageInVirtualizedChat(
      mid,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { tryLoadOlder: () => loadOlderMessagesRef.current?.() },
    );

  const handleSearchResultClick = async (mid: string) => {
    const target = (localMessagesRef.current ?? []).find((m) => m.id === mid);
    // Preserve the query for highlighting the jumped-to row until the
    // highlight ring clears — clearing searchQuery here would strip the
    // <mark> spans mid-jump and leave the user unsure why the row matched.
    setHighlightQuery(searchQuery);
    setSearchQuery("");
    setSearchOpen(false);
    if (target?.created_at && groupId) {
      if (useIcpLab) {
        requestAnimationFrame(() => handleJumpToMessage(mid));
        return;
      }
      try {
        const ctx = await fetchMessagesAround({
          table: "group_messages",
          scope: { group_id: groupId },
          createdAt: target.created_at,
          selectColumns:
            "id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label",
        });
        if (ctx.length) {
          setLocalMessages((prev) => {
            const existing = new Set((prev || []).map((m) => m.id));
            const adds = ctx.filter((m) => !existing.has(m.id));
            return adds.length ? [...(prev || []), ...adds] : prev;
          });
        }
      } catch {
        // best-effort
      }
    }
    requestAnimationFrame(() => handleJumpToMessage(mid));
  };

  // Fetch group details
  // Fetch group details.
  // `maybeSingle()` (not `single()`) so an absent/RLS-hidden row resolves to
  // `null` on a SUCCESSFUL query instead of throwing — that's what lets the
  // render gate below tell "deleted" apart from "network dropped".
  const {
    data: group,
    isLoading: groupLoading,
    isError: groupIsError,
    fetchStatus: groupFetchStatus,
    status: groupStatus,
    refetch: refetchGroup,
    isFetching: groupIsFetching,
  } = useQuery({
    queryKey: ["chat-group", groupId],
    queryFn: async () => {
      if (useIcpLab && groupId && user?.id) {
        return fixtureData.getLocalLabGroup(groupId, user.id) as ChatGroup | null;
      }

      const { data, error } = await supabase
        .from("chat_groups")
        .select("*")
        .eq("id", groupId)
        .maybeSingle();
      if (error) throw error;
      return (data as ChatGroup) ?? null;
    },
    enabled: !!groupId,
    staleTime: 5 * 60 * 1000,
  });


  const { data: miniLeagueInfo } = useQuery({
    queryKey: ["chat-group-mini-league", group?.mini_league_id],
    queryFn: async () => {
      const mlId = group?.mini_league_id;
      if (!mlId) return null;
      if (useIcpLab) return null;

      const { data } = await supabase
        .from("mini_leagues")
        .select("id, name, club_id")
        .eq("id", mlId)
        .maybeSingle();
      return data;
    },
    enabled: !!group?.mini_league_id,
    staleTime: 5 * 60 * 1000,
  });

  const { hasPro: clubPro, isLoading: clubProLoading } = useClubProAccess(group?.club_id ?? null, { enabled: chatReady });
  // Personal groups have no club_id, so the club lookup never resolves and the
  // menu would show Pro locks to genuine Pro users. Fall back to the user's
  // Pro access across any of their clubs in that case.
  const { hasAnyClubPro, isLoading: anyProLoading } = useUserHasAnyClubPro();
  const hasClubScope = !!group?.club_id;
  const groupClubHasPro = hasClubScope ? clubPro : hasAnyClubPro;
  const groupClubProLoading = hasClubScope ? clubProLoading : anyProLoading;
  const pinnedVaultLocked = !groupClubProLoading && !groupClubHasPro;


  // Sync active club to this group's owning club so push-launched threads
  // don't leave the user inside the wrong club context.
  useSyncActiveClubToChat(group?.club_id);

  // Check if user is admin (team/club admin or app admin) - run all checks in parallel
  const { data: isAdmin } = useQuery({
    queryKey: ["group-chat-admin", groupId, user?.id, group?.team_id, group?.club_id],
    queryFn: async () => {
      if (!group) return false;
      
      // Run all role checks in parallel
      const [teamRoleResult, clubRoleResult, appAdminResult] = await Promise.all([
        group.team_id
          ? supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", user!.id)
              .eq("team_id", group.team_id)
              .eq("role", "team_admin")
              .maybeSingle()
          : Promise.resolve({ data: null }),
        group.club_id
          ? supabase
              .from("user_roles")
              .select("role")
              .eq("user_id", user!.id)
              .eq("club_id", group.club_id)
              .eq("role", "club_admin")
              .maybeSingle()
          : Promise.resolve({ data: null }),
        supabase
          .from("user_roles")
          .select("role")
          .eq("user_id", user!.id)
          .eq("role", "app_admin")
          .maybeSingle(),
      ]);
      
      return !!teamRoleResult.data || !!clubRoleResult.data || !!appAdminResult.data;
    },
    enabled: !!groupId && authReady && !!group && !useIcpLab,
    staleTime: 5 * 60 * 1000,
  });

  const { isOnline } = useOnlineStatus();

  // Force a fresh fetch whenever we land on this group. Push notifications and
  // inbox taps can land here while react-query still has stale data — invalidating
  // guarantees the latest message is fetched on entry.
  // Batch 3A: skip when cache is provably fresh + realtime connected + page
  // wasn't just woken from background. See `shouldSkipChatMountInvalidate`.
  // Batch 3B: fire on `user?.id` (eager) when the per-surface flag is on, so
  // the invalidate lands during the same render pass as the first message
  // fetch instead of triggering a second fetch ~700ms later. The session-
  // applied check guards against firing before the JWT is on the client.
  const eagerInvalidate = isChatEagerInvalidateEnabled("group");
  const invalidateGate = eagerInvalidate ? !!user?.id : authReady;
  useEffect(() => {
    if (!groupId || !invalidateGate || !group) return;
    const key = ["group-messages", groupId];
    if (shouldSkipChatMountInvalidate(queryClient, key, `group:${groupId}`)) return;
    let cancelled = false;
    (async () => {
      if (eagerInvalidate) await ensureSessionApplied();
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: key });
    })();
    return () => { cancelled = true; };
  }, [groupId, invalidateGate, group, queryClient, eagerInvalidate]);

  // Fetch messages with reactions - limit to MESSAGES_PER_PAGE for fast initial load
  const {
    data: messagesData,
    isLoading: messagesLoading,
    isError: messagesIsError,
    status: messagesStatus,
    fetchStatus: messagesFetchStatus,
    refetch: refetchMessages,
  } = useGroupMessagesQuery({
    groupId,
    userId: user?.id,
    useIcpLab,
    isOnline,
    queryClient,
    openedFromNotificationRef,
    pageSize: MESSAGES_PER_PAGE,
    supabaseClient: supabase,
  });

  // Scope key for the realtime edit/soft-delete reconciliation registry.
  const reconcileScope = `group:${groupId ?? "none"}`;

  // Extract messages and reactions from query data
  const messages = useMemo(() => {
    if (!messagesData) return [];
    const msgList = Array.isArray(messagesData) 
      ? messagesData 
      : (messagesData as any).messages || [];
    // SECURITY (cross-group bleed): last line of defence before render — a row
    // is only ever displayed in the thread it was posted to.
    const scoped = (msgList as any[]).filter((m) => !m?.group_id || m.group_id === groupId);
    // Sort by created_at to ensure proper ordering
    const sorted = orderChatMessagesChronologically(scoped);
    // Re-apply realtime edits/soft-deletes: an older in-flight fetch resolving
    // after a realtime UPDATE must never restore pre-edit text or resurrect a
    // deleted row.
    return (reconcileMessages(reconcileScope, sorted) ?? []) as GroupMessage[];
  }, [messagesData, reconcileScope, groupId]);

  // Local copy used for rendering so optimistic updates are instant.
  // A notification-preload stub is never used as a seed, but a genuine
  // short thread is (see mem://technical/notification-preload-single-message-guard).
  const getInitialLocalMessages = () => {
    if (!groupId) return undefined;

    const cachedQueryData = queryClient.getQueryData<{ messages: GroupMessage[]; reactions: MessageReaction[] }>([
      "group-messages",
      groupId,
    ]);

    // Seeds are scoped too: a placeholder object left behind by a previous
    // group must never seed this thread's render state.
    const cachedScoped = (cachedQueryData?.messages ?? []).filter(
      (m: any) => !m?.group_id || m.group_id === groupId,
    );
    if (isUsableCachedThread(cachedScoped as any)) {
      // Merge the flat reactions array onto the rows so the seeded first paint
      // shows reactions without waiting for the merge effect.
      return attachReactionsToMessages(
        cachedScoped as GroupMessage[],
        cachedQueryData?.reactions ?? [],
      );
    }


    const fromCache = getCachedGroupMessages(groupId).messages;
    return isUsableCachedThread(fromCache as any) ? fromCache : undefined;
  };



  const [localMessages, setLocalMessages] = useState<GroupMessage[] | undefined>(() =>
    getInitialLocalMessages(),
  );
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  // Realtime reactions must reach BOTH stores (query cache + localMessages) and
  // the group-specific flat reactions array.
  const reactionQueryKey = useMemo(() => ["group-messages", groupId], [groupId]);
  const { applyRealtimeReaction, applyRealtimeReactionDelete } = useRealtimeReactionSync<GroupMessage>({
    scopeKey: reconcileScope,
    // Scope guard: message_reactions realtime events are unfiltered platform-wide.
    getLocalMessages: () => localMessagesRef.current,
    queryKey: reactionQueryKey,
    setLocalMessages,
  });
  // The message_reactions realtime subscription cannot be filtered by group in
  // Postgres changes (no IN-list support), so EVERY reaction in the platform
  // reaches these handlers. Scope must be enforced here: a reaction is only
  // ours when its parent message is loaded in THIS group's stores. Without this
  // gate the flat `reactions` array grows unboundedly with other groups' rows.
  const reactionBelongsToThisGroup = useCallback(
    (groupMessageId: string | null | undefined) => {
      if (!groupMessageId) return false;
      const cached = queryClient.getQueryData<{ messages?: GroupMessage[] }>([
        "group-messages",
        groupId,
      ]);
      if (cached?.messages?.some((m) => m.id === groupMessageId)) return true;
      return Boolean(localMessagesRef.current?.some((m) => m.id === groupMessageId));
    },
    [queryClient, groupId],
  );
  const applyGroupReaction = useCallback(
    (reaction: any) => {
      if (!reaction?.id || !reaction.group_message_id) return;
      if (!reactionBelongsToThisGroup(reaction.group_message_id)) return;
      applyRealtimeReaction(reaction.group_message_id, reaction);
      queryClient.setQueryData(["group-messages", groupId], (old: any) => {
        if (!old) return old;
        const flat = (old.reactions || []) as any[];
        if (
          flat.some(
            (r) =>
              r.id === reaction.id &&
              r.user_id === reaction.user_id &&
              r.reaction_type === reaction.reaction_type,
          )
        ) {
          return old;
        }
        const kept = flat.filter(
          (r) =>
            r.id !== reaction.id &&
            !(
              r.user_id === reaction.user_id &&
              r.group_message_id === reaction.group_message_id
            ),
        );
        return { ...old, reactions: [...kept, reaction] };
      });
    },
    [applyRealtimeReaction, queryClient, groupId],
  );
  const applyGroupReactionDelete = useCallback(
    (reaction: any) => {
      if (!reaction?.id) return;
      applyRealtimeReactionDelete(reaction.group_message_id ?? null, reaction.id);
      queryClient.setQueryData(["group-messages", groupId], (old: any) => {
        if (!old) return old;
        const flat = (old.reactions || []) as any[];
        if (!flat.some((r) => r.id === reaction.id)) return old;
        return { ...old, reactions: flat.filter((r) => r.id !== reaction.id) };
      });
    },
    [applyRealtimeReactionDelete, queryClient, groupId],
  );
  const hasMeaningfulLocal = isUsableCachedThread(localMessages as any);

  // Authoritative fetched count (null = query never produced data).
  const fetchedCount = useMemo<number | null>(() => {
    if (!messagesData) return null;
    const list = (messagesData as any).messages;
    return Array.isArray(list) ? list.length : null;
  }, [messagesData]);

  // The inbox row proves this group already has at least one message, so a
  // zero-message response is inconsistent (Android resume / RLS settling)
  // rather than a legitimately empty thread.
  const inboxSaysHasMessage = useMemo(() => {
    if (!groupId) return false;
    const inboxQueries = queryClient.getQueriesData<any>({
      queryKey: ["my-chat-groups-with-messages"],
    });
    for (const [, data] of inboxQueries) {
      const latest = data?.latestMessages?.[groupId];
      if (latest && (latest.created_at || latest.text || latest.image_url)) return true;
    }
    return false;
  }, [groupId, queryClient, messagesData]);

  // Bounded automatic recovery (400ms / 1.2s / 3s) before we ever render an
  // empty thread. Same pattern as ClubAdminChatPage.
  const recoveryAttemptRef = useRef(0);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recoveryExhausted, setRecoveryExhausted] = useState(false);

  useEffect(() => {
    recoveryAttemptRef.current = 0;
    setRecoveryExhausted(false);
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, [groupId]);

  useEffect(() => {
    if (!groupId || !authReady) return;
    if (messagesFetchStatus === "fetching") return;
    if (fetchedCount !== null && fetchedCount > 0) {
      recoveryAttemptRef.current = 0;
      setRecoveryExhausted(false);
      return;
    }
    const needsRecovery = messagesIsError || fetchedCount === 0;
    if (!needsRecovery) return;
    if (recoveryTimerRef.current) return;

    const delay = nextEmptyRetryDelay(recoveryAttemptRef.current);
    if (delay === null) {
      setRecoveryExhausted(true);
      return;
    }
    recoveryAttemptRef.current += 1;
    recoveryTimerRef.current = setTimeout(() => {
      recoveryTimerRef.current = null;
      void refetchMessages();
    }, delay);

    return () => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    };
  }, [groupId, authReady, fetchedCount, messagesIsError, messagesFetchStatus, refetchMessages]);

  useEffect(
    () => () => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    },
    [],
  );

  const threadPhase = classifyChatThreadState({
    authReady,
    status: messagesStatus,
    fetchStatus: messagesFetchStatus,
    isError: messagesIsError,
    hasUsableCached: hasMeaningfulLocal,
    fetchedCount,
    inboxSaysHasMessage,
    recoveryExhausted,
  });
  // Latched: see useChatLoadingLatch — no skeleton regression after first paint.
  const showLoading = useChatLoadingLatch(threadPhase === "loading", groupId);


  // Android resume escape hatch: abort zombie GETs + re-issue the gating
  // queries while the page is stuck on a skeleton.
  useChatStuckWatchdog(
    (!!groupId && (groupLoading || showLoading)),
    [["chat-group", groupId], ["group-messages", groupId]],
    "group-chat",
  );


  // Cold-start stage marks (chat_mount + chat_query_return).
  useChatPerfMarks(messagesData);

  // Log notification-tap → first-message-render latency once per mount.
  useEffect(() => {
    if (perfLoggedRef.current) return;
    if (!groupId || !user?.id) return;
    if (showLoading) return;
    if (!localMessages || localMessages.length === 0) return;
    perfLoggedRef.current = true;
    const tapTs = openedFromNotificationRef.current;
    void logChatOpenLatency({
      kind: "group",
      targetId: groupId,
      source: tapTs ? "notification" : "cold_open",
      startTs: tapTs ?? mountTsRef.current,
      messageCount: localMessages.length,
      fromCache: !messagesData,
      userId: user.id,
    });
  }, [groupId, user?.id, showLoading, localMessages, messagesData]);
  
  // Extract top-level reactions from query data (must be before useLayoutEffect that uses it)
  const reactions = useMemo(() => {
    if (!messagesData || Array.isArray(messagesData)) return [] as MessageReaction[];
    const flat = ((messagesData as any).reactions || []) as MessageReaction[];
    // A query response that resolves after a realtime reaction event must not
    // drop it: re-apply the recorded deltas to the flat array too.
    return reconcileFlatReactions(
      reconcileScope,
      flat as any,
      (r: any) => r.group_message_id,
      (messageId, reaction) => ({ ...reaction, group_message_id: messageId }) as any,
    ) as MessageReaction[];
    // NOTE: `localMessages` must NOT be a dependency here. This memo feeds the
    // sync useLayoutEffect below, which writes `localMessages` — including it
    // closes a state -> memo -> effect -> state cycle that trips React #185
    // ("Maximum update depth exceeded") on tap-to-react.
  }, [messagesData, reconcileScope]);
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);
  
  // Reset scroll state when groupId changes
  useEffect(() => {
    setLocalMessages((prev) => {
      const next = reconcileMessages(reconcileScope, getInitialLocalMessages());
      debugLogEvent("local-replace", {
        cause: "reset-effect",
        prevLen: prev?.length ?? 0,
        nextLen: next?.length ?? 0,
      });
      return next;
    });
    setHasOlderMessages(true);
    setInfiniteScrollEnabled(false);

    return () => {
      // Tombstones/patches are per-thread; drop them when leaving the thread.
      clearReconciliationScope(`group:${groupId ?? "none"}`);
    };
  }, [groupId, queryClient, reconcileScope]);

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
    await queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
  }, [queryClient, groupId]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try {
      await handleRefresh();
    } finally {
      setIsManualRefreshing(false);
    }
  }, [handleRefresh]);

  const isAnyRefreshing = isManualRefreshing;

  useGroupLocalMessagesSync({
    messages,
    reactions,
    groupId,
    threadPhase,
    reconcileScope,
    localMessages,
    setLocalMessages,
  });

  // If messages unexpectedly dropped to 0 but we had cached messages, trigger a refetch
  useEffect(() => {
    if (!groupId || !authReady || messagesLoading) return;
    
    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("group", groupId, fetchedCount)) {
      console.log("[GroupChat] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
    }
  }, [groupId, authReady, messages, messagesLoading, queryClient]);

  // Visibility change handler - refetch messages and profiles when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && groupId && authReady) {
        const timeSinceLastRefresh = Date.now() - lastRefresh;
        // Only refresh if it's been more than 30 seconds
        if (timeSinceLastRefresh > 30000) {
          console.log("[GroupChat] App became visible, refreshing messages");
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey: ["group-messages", groupId] });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [groupId, authReady, queryClient]);

  // Always ensure profiles are loaded for messages with missing author data
  useEffect(() => {
    if (!localMessages?.length) return;
    
    // Find messages with missing profile data
    const messagesWithMissingProfiles = localMessages.filter(m => !m.author?.display_name);
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
          if (profile && (!msg.author?.display_name || msg.author.display_name === "Unknown")) {
            updated = true;
            return {
              ...msg,
              author: { display_name: profile.display_name, avatar_url: profile.avatar_url },
            };
          }
          return msg;
        });
        return updated ? newMessages : prev;
      });
    });
  }, [localMessages]);


  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      if ((messagesData as any).fromCache) return;
      setHasOlderMessages((messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Keep a ref to the latest localMessages so loadOlderMessages doesn't get
  // recreated on every message change (which would churn the IntersectionObserver
  // and cause overlapping fetches that race past the abort timeout).
  const localMessagesRef = useRef<GroupMessage[] | undefined>(localMessages);
  useEffect(() => {
    localMessagesRef.current = localMessages;
  }, [localMessages]);

  // Forward ref so the loader can be referenced before it's defined.
  const loadOlderMessagesRef = useRef<(() => void) | null>(null);

  const loadOlderMessages = useGroupOlderMessagesLoader({
    groupId,
    queryClient,
    localMessagesRef,
    isLoadingOlder,
    setIsLoadingOlder,
    hasOlderMessages,
    setHasOlderMessages,
    reconcileScope,
    pageSize: MESSAGES_PER_PAGE,
    supabaseClient: supabase,
  });

  // Keep the loader ref in sync for the anchor hook to call.
  useEffect(() => {
    loadOlderMessagesRef.current = loadOlderMessages;
  }, [loadOlderMessages]);

  useGroupTargetWindowHydration({
    targetMessageId,
    targetJumpNonce,
    groupId,
    authReady,
    reconcileScope,
    localMessagesRef,
    setLocalMessages,
    setHasOlderMessages,
    setJumpRenderNonce,
    supabaseClient: supabase,
  });

  const { mode: groupRealtimeMode, intervalMs: groupPollIntervalMs } = useClubRealtimeMode(group?.club_id ?? null);
  useGroupRealtimeUpdates({
    groupId,
    userId: user?.id,
    useIcpLab,
    queryClient,
    groupRealtimeMode,
    groupPollIntervalMs,
    reconcileScope,
    setLocalMessages,
    applyGroupReaction,
    applyGroupReactionDelete,
    supabaseClient: supabase,
  });


  // Vault mirroring runs ONLY for confirmed-delivered messages, preserving the
  // group's exact folder scope (restricted roles included).
  const vaultGroupScope = useMemo(
    () =>
      group?.club_id
        ? {
            clubId: group.club_id as string,
            teamId: (group.team_id as string | null) ?? null,
            chatGroupId: group.id as string,
            chatGroupName: group.name as string,
            chatGroupAllowedRoles: (group.allowed_roles as string[] | null) ?? null,
          }
        : null,
    [group?.club_id, group?.team_id, group?.id, group?.name, group?.allowed_roles],
  );
  const syncDeliveredMessageToVault = useChatVaultDeliverySync({
    userId: user?.id,
    scope: vaultGroupScope,
    surfaceLabel: "Group chat",
  });
  const syncSendToVault = useCallback(
    (vars: { text: string; image_url: string | null }) => {
      syncDeliveredMessageToVault({ text: vars.text, imageUrl: vars.image_url });
    },
    [syncDeliveredMessageToVault],
  );

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, image_url, reply_to_id }: { text: string; image_url: string | null; reply_to_id: string | null }) => {
      if (!user || !groupId) return;

      if (useIcpLab) {
        throw new Error("Group messaging is not available in the local ICP contract.");
      }
      
      // If offline, queue the message
      if (!navigator.onLine) {
        queueMessage({
          type: "group",
          targetId: groupId,
          authorId: user.id,
          text,
          imageUrl: image_url,
          replyToId: reply_to_id,
          createdAt: new Date().toISOString(),
          vault: vaultGroupScope,
        });
        return queuedSend();
      }
      
      const { error } = await supabase.from("group_messages").insert({
        group_id: groupId,
        author_id: user.id,
        text,
        image_url,
        reply_to_id,
      });
      if (error) throw error;
      return deliveredSend();
    },
    onMutate: async ({ text, image_url, reply_to_id }) => {
      const currentProfile = profileRef.current;
      await queryClient.cancelQueries({ queryKey: ["group-messages", groupId] });

      // Mutation-specific temp id so overlapping sends roll back independently.
      const tempId = createSendTempId();
      const sentAtMs = Date.now();
      const previousReplyTo = replyTo;
      const { baseText: unsentText, pollId: unsentPollId } = splitPollMarkup(text);

      const optimisticMessage: GroupMessage = {
        id: tempId,
        group_id: groupId!,
        author_id: user!.id,
        text,
        image_url,
        reply_to_id,
        created_at: new Date().toISOString(),
        author: {
          display_name: currentProfile?.display_name || "You",
          avatar_url: currentProfile?.avatar_url || null,
        },
        reply_to: replyTo ? { text: replyTo.text, author: { display_name: replyTo.author?.display_name || null } } : null,
      };

      // Update query cache directly (this will sync to localMessages via useEffect)
      queryClient.setQueryData(["group-messages", groupId], (old: any) => {
        const existingMessages: GroupMessage[] = old?.messages || [];
        return {
          ...(old || {}),
          messages: [...existingMessages, optimisticMessage],
          reactions: old?.reactions || [],
        };
      });

      // Same batch as the composer clear (cache→local sync is a task later and
      // would step the thread down-then-up). Later sync dedupes by id.
      setLocalMessages((prev) => (prev && !prev.some((m) => m.id === tempId) ? [...prev, optimisticMessage] : prev));

      // Clear input immediately
      setMessage("");
      setImageUrl(null);
      setReplyTo(null);
      setPendingPollId(null);
      setPendingNewsId(null);
      
      // Scroll to bottom — force bypasses the touch-guard so the deferred
      // re-pins still fire after composer reflow shrinks bottomPadding.
      virtualHandleRef.current?.scrollToBottom("auto", { force: true });

      return {
        tempId,
        sentText: unsentText,
        sentImageUrl: image_url ?? null,
        previousReplyTarget: previousReplyTo,
        pendingPollId: unsentPollId,
        sentAtMs,
      } satisfies FailedSendContext<typeof previousReplyTo>;
    },
    onError: (err, variables, context) => {
      // Don't revert if offline - message is queued
      if (!navigator.onLine) {
        toast.info("Message queued - will send when online");
        return;
      }

      // Succeeded-but-errored: the row already arrived via realtime.
      const currentData = queryClient.getQueryData<{ messages: GroupMessage[] }>(["group-messages", groupId]);
      if (authoritativeMessageExists(currentData?.messages, { authorId: user?.id, text: variables.text, imageUrl: variables.image_url ?? null, replyToId: variables.reply_to_id ?? null, sentAtMs: context?.sentAtMs })) {
        // Errored request, confirmed delivery: same Vault handling as success.
        syncSendToVault(variables);
        return;
      }

      // Remove ONLY this mutation's optimistic row (no snapshot rollback).
      if (context?.tempId) {
        queryClient.setQueryData(["group-messages", groupId], (old: any) => {
          if (!old) return old;
          const existingMessages: GroupMessage[] = old?.messages || [];
          return { ...old, messages: existingMessages.filter((m) => m.id !== context.tempId) };
        });
        setLocalMessages((prev) => (prev ? prev.filter((m) => m.id !== context.tempId) : prev));
      }

      restoreFailedSendComposer({
        context,
        setText: setMessage,
        setImage: setImageUrl,
        setReply: setReplyTo,
        setPoll: setPendingPollId,
      });

      console.error("Failed to send group message", err);
      toast.error("Failed to send message");
    },

    onSuccess: (result, variables) => {
      if (isConfirmedDelivery(result)) syncSendToVault(variables);
    },

    onSettled: (_, __, variables) => {
      if (useIcpLab) return;

      // Invalidate messages page preview so latest message shows
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });
      // Award engagement points (fire and forget)
      if (user && groupId && group?.club_id) {
        import("@/lib/engagementPoints").then(({ awardEngagementPoints }) => {
          awardEngagementPoints({
            userId: user.id,
            clubId: group.club_id!,
            action: "chat_message",
            scopeId: groupId,
          }).catch(() => {});
        });
      }
    },
   });

  const { updateMessageMutation, deleteMessageMutation } = useGroupMessageEditDelete({
    groupId,
    useIcpLab,
    message,
    editingMessage,
    setMessage,
    setEditingMessage,
    queryClient,
    supabaseClient: supabase,
  });

  const toggleReactionMutation = useGroupReactionToggle({
    groupId,
    userId: user?.id,
    useIcpLab,
    queryClient,
    localMessagesRef,
    setLocalMessages,
    supabaseClient: supabase,
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

    if ((!message.trim() && !imageUrl && !pendingPollId && !pendingNewsId) || !user) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
    } else {
      const baseText = message.trim();
      let finalText = pendingPollId
        ? (baseText ? `${baseText} [poll:${pendingPollId}]` : `[poll:${pendingPollId}]`)
        : baseText;
      if (pendingNewsId) {
        finalText = finalText ? `${finalText} [news:${pendingNewsId}]` : `[news:${pendingNewsId}]`;
      }
      sendMessageMutation.mutate({
        text: finalText,
        image_url: imageUrl,
        reply_to_id: replyTo?.id || null,
      });
    }
  };


  const handleEdit = (msg: GroupMessage) => {
    setEditingMessage(msg);
    setMessage(msg.text);
    inputRef.current?.focus();
  };

  const handleCancelEdit = () => {
    setEditingMessage(null);
    setMessage("");
  };

  const handleReply = (msg: GroupMessage) => {
    if (msg.id.startsWith("temp-") || msg.id.startsWith("queued-")) {
      toast.warning("Please wait for the message to send before replying.");
      return;
    }
    setReplyTo(msg);
    inputRef.current?.focus();
    [0, 180, 480].forEach((delay) => {
      setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), delay);
    });
  };

  const handleSearchResult = (messageId: string) => {
    jumpToMessageInVirtualizedChat(
      messageId,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { tryLoadOlder: () => loadOlderMessagesRef.current?.() },
    );
  };

  const { isSearching: isSearchFetching, canShowEmpty: searchCanShowEmpty } = useChatHistorySearch<GroupMessage>({
    searchQuery,
    loadedMessages: localMessages,
    setMessages: (updater) => setLocalMessages((prev) => updater(prev)),
    enabled: !!groupId,
    cacheKey: `group:${groupId ?? ""}`,
    fetcher: async (q, signal) =>
      useIcpLab
        ? (localMessagesRef.current ?? []).filter((row) => fuzzyMatchesQuery(row.text, q))
        : createChatHistorySearchFetcher<GroupMessage>({
            scope: GROUP_CHAT_SCOPE,
            scopeId: groupId,
            selectColumns: "id, text, image_url, created_at, edited_at, author_id, group_id, reply_to_id, is_system_message, forwarded_from_user_id, forwarded_at, forwarded_source_label",
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

  const messagesById = useMemo(
    () => new Map((localMessages || []).map((message) => [message.id, message])),
    [localMessages]
  );

  // Message IDs for read tracking
  const messageIds = useMemo(() => 
    (filteredMessages || []).map(m => m.id).filter(id => !id.startsWith('temp-')),
    [filteredMessages]
  );

  // Read tracking
  const { readCounts, readFrontier, markMessagesAsRead } = useMessageReads(
    "group",
    groupId || "",
    messageIds,
    user?.id
  );

  // Stable per-message read-state objects. Group rows only render read receipts
  // on OWN messages; marking older non-own rows as read during upward scroll
  // changes readCounts/readFrontier but does not change their visible row. Keep
  // those message references stable so slow scroll does not repaint every row
  // the user has just read.
  const prevReadStateMapRef = useRef<Map<string, any>>(new Map());
  const messagesWithReadState = useMemo(() => {
    const prevMap = prevReadStateMapRef.current;
    const nextMap = new Map<string, any>();
    const out = (filteredMessages || []).map((message) => {
      const sig = message.author_id === user?.id
        ? `${readCounts[message.id] || 0}:${(readFrontier[message.id] || [])
            .map((reader) => reader.user_id)
            .join(",")}`
        : "";
      const prior = prevMap.get(message.id);
      // Reuse the prior wrapper IFF the underlying message ref AND signature
      // are unchanged. Either changing means real new content to render.
      if (prior && prior.__src === message && prior.__readStateSignature === sig) {
        nextMap.set(message.id, prior);
        return prior;
      }
      const wrapped = { ...message, __readStateSignature: sig, __src: message };
      nextMap.set(message.id, wrapped);
      return wrapped;
    });
    prevReadStateMapRef.current = nextMap;
    return out;
  }, [filteredMessages, readCounts, readFrontier, user?.id]);

  // Typing indicator
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(
    `group-${groupId}`,
    user?.id,
    profile?.display_name || undefined
  );

  useMarkVisibleChatMessagesRead({
    messages: filteredMessages,
    userId: user?.id,
    markMessagesAsRead,
  });

  const messageReactionsMap = useMemo(() => {
    const map = new Map<string, MessageReaction[]>();
    const reactionsByMessage = new Map<string, MessageReaction[]>();
    const hasResolvedReactionData = !!messagesData && !Array.isArray(messagesData);

    reactions.forEach((reaction) => {
      if (!reaction.group_message_id) return;
      if (!reactionsByMessage.has(reaction.group_message_id)) {
        reactionsByMessage.set(reaction.group_message_id, []);
      }
      reactionsByMessage.get(reaction.group_message_id)!.push(reaction);
    });

    for (const msg of (localMessages || [])) {
      const embedded: MessageReaction[] = (msg as any).reactions || [];
      map.set(msg.id, hasResolvedReactionData ? (reactionsByMessage.get(msg.id) ?? []) : embedded);
    }

    return map;
  }, [localMessages, messagesData, reactions]);

  const deleteGroupMutation = useGroupDeleteChat({
    groupId,
    userId: user?.id,
    useIcpLab,
    queryClient,
    supabaseClient: supabase,
    navigate,
  });

  // Live online count for the group — shown in the header sublabel.
  const groupOnlineCount = useChatOnlineCount("group", groupId, {
    teamId: group?.team_id ?? null,
    clubId: group?.club_id ?? null,
    miniLeagueId: group?.mini_league_id ?? null,
    groupAllowedRoles: (group?.allowed_roles as any) ?? null,
    enabled: !!group && chatReady,
  });

  const {
    publishingIds: galleryPublishingIds,
    publishedIds: galleryPublishedIds,
    publish: handlePublishToGallery,
  } = usePublishChatImage({
    uploaderId: user?.id,
    teamId: group?.team_id ?? null,
    clubId: group?.club_id ?? null,
  });
  const { withinMatchWindow: galleryWindowOpen } = useRecentMatchWindow({
    teamId: group?.team_id ?? null,
    miniLeagueId: group?.mini_league_id ?? null,
  });

  // Competition threads: the competition-wide ("all_members") thread can be
  // configured as organiser-only, in which case members read but cannot post.
  const groupCompetitionId = (group as any)?.competition_id as string | null | undefined;
  const groupCompetitionScope = (group as any)?.competition_scope as string | null | undefined;
  const { data: competitionChatSettings } = useQuery({
    queryKey: ["competition-chat-posting", groupCompetitionId, user?.id],
    enabled: !!groupCompetitionId && !!user?.id,
    queryFn: async () => {
      const [{ data: comp }, { data: isAdmin }] = await Promise.all([
        supabase
          .from("competitions")
          .select("member_chat_admins_only")
          .eq("id", groupCompetitionId!)
          .maybeSingle(),
        supabase.rpc("is_competition_admin", {
          _user_id: user!.id,
          _competition_id: groupCompetitionId!,
        }),
      ]);
      return {
        adminsOnly: !!comp?.member_chat_admins_only,
        isCompetitionAdmin: !!isAdmin,
      };
    },
  });

  const canPostInGroup = canPostInCompetitionChat({
    scope: groupCompetitionScope,
    adminsOnly: competitionChatSettings?.adminsOnly,
    isCompetitionAdmin: competitionChatSettings?.isCompetitionAdmin ?? false,
  });

  const groupBaseSublabel = group?.mini_league_id
    ? "Mini-league chat"
    : groupCompetitionId
    ? competitionChatSublabel(groupCompetitionScope)
    : group?.team_id
    ? "Team group"
    : group?.club_id
    ? "Club group"
    : "Personal group";


  const groupHeaderSublabel = groupOnlineCount > 0
    ? `${groupBaseSublabel} · ${groupOnlineCount} online`
    : groupBaseSublabel;

  const groupMetadataState = resolveChatMetadataState({
    data: group,
    isLoading: groupLoading,
    isError: groupIsError,
    fetchStatus: groupFetchStatus,
    status: groupStatus,
    isOnline,
  });

  if (groupMetadataState === "loading") {
    return <ChatPageSkeleton />;
  }

  if (groupMetadataState === "unreachable") {
    return (
      <ChatUnreachable
        label="chat group"
        onRetry={() => void refetchGroup()}
        retrying={groupIsFetching}
      />
    );
  }

  if (groupMetadataState === "missing") {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <p className="text-muted-foreground text-center px-4">This chat group has been removed or is no longer available.</p>
        <Button variant="outline" onClick={() => navigate("/messages")}>
          Back to Messages
        </Button>
      </div>
    );
  }

  if (!group) {
    return <ChatPageSkeleton />;
  }


  // Pro gate: club-level role groups (Coaches / Team Admins / Club Committee, etc.)
  // require the club to have Pro, mirroring the club-wide chat gate.
  const isClubRoleGroup =
    !!group.club_id &&
    !group.team_id &&
    !group.mini_league_id &&
    !(group as any).competition_id &&
    Array.isArray((group as any).allowed_roles) &&
    ((group as any).allowed_roles as string[]).some((r) =>
      ["coach", "team_admin", "committee_member", "club_admin"].includes(r),
    );
  // Only show the Pro lock once the pro-access query has actually resolved.
  // Before `chatReady` flips true the query is disabled, so isLoading=false and
  // hasPro=false — without the chatReady + club_id guards the locked screen
  // flashes for one frame on cold-start push taps into a Pro club chat.
  if (isClubRoleGroup && chatReady && !!group?.club_id && !groupClubProLoading && !groupClubHasPro) {
    return (
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 p-4 border-b">
          <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex-1">
            <h1 className="font-semibold">{group.name}</h1>
          </div>
        </div>
        <div className="flex-1 flex items-center justify-center">
          <div className="text-center py-12 px-4">
            <Lock className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
            <p className="text-lg font-medium text-foreground mb-2">Club Pro Feature</p>
            <p className="text-muted-foreground">
              {group.name} chat is available with a Club Pro subscription
            </p>
            <p className="text-sm text-muted-foreground mt-1">
              Contact your club admin to upgrade the club to Pro for role-based group messaging
            </p>
            <Button
              variant="outline"
              className="mt-4"
              onClick={() => group.club_id && navigate(`/clubs/${group.club_id}/upgrade`)}
            >
              View Upgrade Options
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden overscroll-none" style={{ height: chatHeight }} data-lock-keyboard-scroll="true" onTouchStart={swipeBack.onTouchStart} onTouchEnd={swipeBack.onTouchEnd}>
      {/* Header */}
      <ChatHeaderShell
        type={group.team_id || group.club_id ? "group" : "group"}
        name={group.name}
        sublabel={groupHeaderSublabel}
        onOpenDetails={() => setMembersOpen(true)}
        leftSlot={
          <ChatSearchBar onSearch={setSearchQuery} isOpen={searchOpen} onOpenChange={setSearchOpen} isSearching={isSearchFetching} />
        }
        rightSlot={
          <>
            <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSearchOpen(true)}>
              <Search className="h-4 w-4" />
            </Button>
            <ChatHeaderMenu
              onRefresh={handleManualRefresh}
              isRefreshing={isAnyRefreshing}
              onScheduleMessage={scheduleTarget ? () => setScheduleDialogOpen(true) : undefined}
              scheduleMessageLocked={!groupClubProLoading && !groupClubHasPro}
              onSummarizeMessages={(!aiCatchUpDisabled && groupClubHasPro) ? () => summarizeTriggerRef.current?.() : undefined}
              summarizeLocked={!groupClubProLoading && !groupClubHasPro}
              onEditGroup={isAdmin ? () => setShowEditGroupDialog(true) : undefined}
              onDeleteGroup={(isAdmin || group.created_by === user?.id) ? () => setShowDeleteGroupDialog(true) : undefined}
              onManagePinnedVault={
                (isAdmin || group.created_by === user?.id)
                  ? () => {
                      if (pinnedVaultLocked) {
                        toast.info("Pinned vault is a Pro feature");
                        if (group.club_id) navigate(`/clubs/${group.club_id}/upgrade`);
                        return;
                      }
                      setPinVaultSheetOpen(true);
                    }
                  : undefined
              }
              pinnedVaultLocked={!!(isAdmin || group.created_by === user?.id) && pinnedVaultLocked}
              onUnpinVault={
                pinnedVault.record && (isAdmin || group.created_by === user?.id) && !pinnedVaultLocked
                  ? () => pinnedVault.remove()
                  : undefined
              }
            />
          </>
        }
      />
      <ChatDetailsSheet
        open={membersOpen}
        onOpenChange={setMembersOpen}
        chatType="group"
        chatId={groupId!}
        name={group.name}
        sublabel={groupBaseSublabel}
        teamId={group.team_id || undefined}
        clubId={group.club_id || undefined}
        miniLeagueId={group.mini_league_id || undefined}
        competitionId={(group as any).competition_id || undefined}
        groupAllowedRoles={group.allowed_roles}
        groupCreatedBy={group.created_by}
        groupMembershipMode={group.membership_mode}
        onInviteToMiniLeague={
          group.mini_league_id && group.club_id
            ? () => {
                setMembersOpen(false);
                setTimeout(() => setMiniLeagueInviteOpen(true), 80);
              }
            : undefined
        }
      />


      {/* Invite banner — mini-league chats */}
      {group.mini_league_id && group.club_id && (
        <>
          <button
            onClick={() => setMiniLeagueInviteOpen(true)}
            aria-label={`Invite people to ${miniLeagueInfo?.name || group.name}`}
            className="group w-full flex items-center gap-2 px-4 py-1.5 bg-primary/10 border-b border-primary/20 text-left touch-manipulation active:bg-primary/15 transition-colors shrink-0"
          >
            <div className="h-5 w-5 rounded-full bg-primary/15 flex items-center justify-center shrink-0">
              <UserPlus className="h-3 w-3 text-primary" strokeWidth={2.25} />
            </div>
            <span className="flex-1 min-w-0 text-[13.5px] text-foreground truncate">
              Invite people to <span className="font-semibold">{miniLeagueInfo?.name || group.name}</span>
            </span>
            <ChevronRight className="h-4 w-4 text-primary/70 shrink-0" strokeWidth={2.25} />
          </button>
          {miniLeagueInviteOpen && (
            <Suspense fallback={null}>
            <AddMiniLeagueMemberSheet
              miniLeagueId={group.mini_league_id}
              miniLeagueName={miniLeagueInfo?.name || group.name}
              clubId={group.club_id}
              externalOpen={miniLeagueInviteOpen}
              onExternalOpenChange={setMiniLeagueInviteOpen}
            />
            </Suspense>
          )}
        </>
      )}


      {/* Notification Nudge */}
      {notificationNudge.shouldShowNudge && (
        <div className="px-4 pt-2 shrink-0">
          <NotificationNudgeBanner
            message="Enable notifications so you never miss group messages"
            onDismiss={notificationNudge.dismiss}
            userId={user?.id}
          />
        </div>
      )}

      {/* Pinned vault banner */}
      <PinnedVaultBanner
        record={pinnedVault.record}
        isAdmin={!!(isAdmin || group.created_by === user?.id)}
        onUnpin={
          pinnedVault.record &&
          (isAdmin || group.created_by === user?.id || pinnedVault.record.set_by === user?.id)
            ? () => pinnedVault.remove()
            : undefined
        }
      />

      {/* Pinned messages banner */}
      <PinnedMessagesBanner
        pins={pinnedMessages}
        onJumpToMessage={handleJumpToMessage}
        onUnpin={unpinMessage}
      />

      {groupId && (
        <Suspense fallback={null}>
        <PinVaultSheet
          open={pinVaultSheetOpen}
          onOpenChange={setPinVaultSheetOpen}
          chatType="group"
          chatId={groupId}
          clubId={group.club_id ?? null}
          teamId={group.team_id ?? null}
        />
        </Suspense>
      )}


      <ChatCatchUp
        scope_type="group"
        scope_id={groupId}
        unreadCount={groupUnreadCount}
        latestMessageId={filteredMessages?.[filteredMessages.length - 1]?.id ?? null}
        proLocked={!groupClubProLoading && !groupClubHasPro}
        upgradeHref={group?.club_id ? `/clubs/${group.club_id}/upgrade` : undefined}
        registerTrigger={(fn) => { summarizeTriggerRef.current = fn; }}
      />

      {/* Messages */}
      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden overscroll-none">
        {showLoading ? (
          <p className="text-center text-muted-foreground">Loading messages...</p>
        ) : (isSearchFetching || (!!searchQuery && !searchCanShowEmpty)) ? (
          <ChatSearchLoadingState />
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState
            title="No messages yet"
            subtitle="Start the conversation!"
            isSearchResult={!!searchQuery}
          />
        ) : (
          <ChatMessagesScroller
            key={scrollerKey}
            messages={messagesWithReadState}
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
              const isOwnMessage = msg.author_id === user?.id;
              const messageReactions = messageReactionsMap.get(msg.id) || EMPTY_REACTIONS;
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
                    role={searchQuery ? "button" : undefined}
                    tabIndex={searchQuery ? 0 : undefined}
                    onClick={searchQuery ? () => handleSearchResultClick(msg.id) : undefined}
                    onKeyDown={searchQuery ? (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); handleSearchResultClick(msg.id); } } : undefined}
                    className={searchQuery ? "cursor-pointer hover:bg-muted/40 rounded-lg" : undefined}
                  >
                    <GroupChatMessageRow
                      msg={msg}
                      messagesById={messagesById}
                      isOwnMessage={isOwnMessage}
                      isAdmin={isAdmin}
                      highlightedMessageId={highlightedMessageId}
                      messageReactions={messageReactions}
                      userId={user?.id}
                      getProfile={getProfile}
                      readFrontier={readFrontier}
                      readCounts={readCounts}
                      handleReply={handleReply}
                      handleEdit={handleEdit}
                      deleteMessageMutation={deleteMessageMutation}
                      toggleReactionMutation={toggleReactionMutation}
                      groupId={groupId || ""}
                      searchQuery={searchQuery || highlightQuery}
                      isPinned={pinnedMessageIds.has(msg.id)}
                      pinLimitReached={!canPinMore && !pinnedMessageIds.has(msg.id)}
                      onPin={pinMessage}
                      onUnpin={unpinMessage}
                      canPublishToGallery={galleryWindowOpen && isOwnMessage && !!msg.image_url && !msg.id.startsWith("queued-") && (!!group?.team_id || !!group?.mini_league_id)}
                      isPublishingToGallery={galleryPublishingIds.has(msg.id)}
                      isPublishedToGallery={galleryPublishedIds.has(msg.id)}
                      onPublishToGallery={handlePublishToGallery}
                      allowForwarding={group?.allow_forwarding !== false}
                      groupName={group?.name ?? null}
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


      <GroupChatComposerFooter
        composerRef={composerRef}
        searchOpen={searchOpen}
        nativeKbHeight={nativeKbHeight}
        canPost={canPostInGroup}
        typingUsers={typingUsers}
        replyTo={replyTo}
        onCancelReply={() => setReplyTo(null)}
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
        message={message}
        onMessageChange={setMessage}
        onStartTyping={startTyping}
        onStopTyping={stopTyping}
        onKeyPress={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            stopTyping();
            handleSend();
          }
        }}
        onSend={handleSend}
        groupId={groupId}
        teamId={group.team_id}
        clubId={group.club_id}
        miniLeagueId={group.mini_league_id}
        competitionId={(group as any).competition_id ?? null}
        eventPickerOpen={eventPickerOpen}
        onEventPickerOpenChange={setEventPickerOpen}
        newsPickerOpen={newsPickerOpen}
        onNewsPickerOpenChange={setNewsPickerOpen}
        boardPickerOpen={boardPickerOpen}
        onBoardPickerOpenChange={setBoardPickerOpen}
        pollDialogOpen={pollDialogOpen}
        onPollDialogOpenChange={setPollDialogOpen}
      />

      {/* Edit Group Dialog */}
      {isAdmin && group && (
        <EditGroupDialog
          group={{
            id: group.id,
            name: group.name,
            allowed_roles: group.allowed_roles as any,
            membership_mode: group.membership_mode,
            category: group.category,
            club_id: group.club_id,
            team_id: group.team_id,
            mini_league_id: group.mini_league_id,
            join_policy: group.join_policy,
          }}
          open={showEditGroupDialog}
          onOpenChange={setShowEditGroupDialog}
        />
      )}

      {/* Delete Group Confirmation — requires typing the group name to enable. */}
      <AlertDialog
        open={showDeleteGroupDialog}
        onOpenChange={(open) => {
          setShowDeleteGroupDialog(open);
          if (!open) setDeleteConfirmText("");
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete "{group.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will remove the chat from everyone's inbox. Messages stay archived
              and an app admin can restore the chat within 30 days. To continue, type
              <strong>delete</strong> below.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <input
            type="text"
            value={deleteConfirmText}
            onChange={(e) => setDeleteConfirmText(e.target.value)}
            placeholder="delete"
            autoCapitalize="none"
            autoCorrect="off"
            className="mt-2 w-full rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                if (deleteConfirmText.trim().toLowerCase() !== "delete") {
                  e.preventDefault();
                  toast.error("Type delete to confirm");
                  return;
                }
                deleteGroupMutation.mutate();
              }}
              disabled={
                deleteConfirmText.trim().toLowerCase() !== "delete" ||
                deleteGroupMutation.isPending
              }
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteGroupMutation.isPending ? "Deleting..." : "Delete chat"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
