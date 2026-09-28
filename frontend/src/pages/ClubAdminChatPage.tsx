import { useRealtimeReactionSync } from "@/hooks/useRealtimeReactionSync";
import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { consumePendingChatJump, getLastConsumedPendingChatJumpTs, subscribePendingChatJump, type PendingChatJumpPayload } from "@/lib/pendingChatJump";
import { resolveChatJumpTarget } from "@/lib/resolveChatJumpTarget";
import { filterChatMessagesForSearch } from "@/features/messaging/thread/chatSearchPresentation";
import { useChatDraft, useChatDraftReply } from "@/hooks/useChatDraft";
import { useSyncActiveClubToChat } from "@/hooks/useSyncActiveClubToChat";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { useMeasuredElementHeight } from "@/hooks/useMeasuredElementHeight";
import { keepComposerFocusedThroughSend } from "@/lib/chatComposerFocus";
import { ChatMessagesScroller } from "@/components/chat/ChatMessagesScroller";
import { ChatThreadSponsorStrip } from "@/components/chat/ChatThreadSponsorStrip";
import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { jumpToMessageInVirtualizedChat } from "@/lib/jumpToMessage";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/hooks/useAuth";
import { useClubProAccess } from "@/hooks/useClubProAccess";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Users, Search, RefreshCw } from "lucide-react";
import { ChatBackButton } from "@/components/chat/ChatBackButton";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { PageLoading } from "@/components/ui/page-loading";
import { ChatPageSkeleton } from "@/components/chat/ChatPageSkeleton";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { ChatCatchUp } from "@/components/chat/ChatCatchUp";
import { markChatOpened } from "@/hooks/useChatCatchUp";
import { useAICatchUpAvailability } from "@/hooks/useAICatchUpAvailability";
import { ChatParticipantsList } from "@/components/chat/ChatParticipantsList";
import { Sheet, SheetContent, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { useIsMobile } from "@/hooks/use-mobile";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChatStuckWatchdog, createChatFetchBudget } from "@/lib/chatStuckWatchdog";
import { resolveChatMetadataState } from "@/lib/chatMetadataGate";
import { ChatUnreachable } from "@/components/chat/ChatUnreachable";
import { toast } from "sonner";
import { ClubAdminChatComposerFooter } from "@/components/chat/ClubAdminChatComposerFooter";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import { splitPageWindow } from "@/lib/chatPageWindow";
import { sortChatMessagesChronologically, compareChatMessagesChronologically } from "@/lib/chatMessageOrder";
import {
  recordRealtimeMutation,
  reconcileMessages,
  applyMessageUpdate,
  removeMessage,
  clearReconciliationScope,
} from "@/lib/chatMessageReconciliation";
import { createSendTempId, splitPollMarkup, restoreFailedSendComposer, authoritativeMessageExists, dropSupersededOptimisticRow, type FailedSendContext } from "@/lib/failedSendRestore";
import { deliveredSend, queuedSend, isConfirmedDelivery } from "@/lib/chatSendResult";
import { useChatVaultDeliverySync } from "@/hooks/useChatVaultDeliverySync";

import { format, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { fetchProfilesWithCache, getProfileFromCache, selectCachedProfileById } from "@/lib/profileCache";
import { queueMessage } from "@/lib/messageQueue";
import { getCachedMessages, cacheMessages } from "@/lib/messageCache";
import { consumeFromNotificationFlag } from "@/lib/notificationPreload";
import {
  classifyChatThreadState,
  nextEmptyRetryDelay,
  isUsableCachedThread,
  NOTIFICATION_PRELOAD_FLAG,
} from "@/lib/chatThreadLoadState";
import { useProfiles } from "@/hooks/useProfiles";
import { useMessageReads } from "@/hooks/useMessageReads";
import {
  CHAT_READ_EXCLUDED_WITH_QUEUED_ID_PREFIXES,
  useMarkVisibleChatMessagesRead,
} from "@/hooks/useMarkVisibleChatMessagesRead";
import { ChatSearchBar, ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { createChatHistorySearchFetcher } from "@/features/messaging/thread/chatHistorySearchFetcher";
import { CLUB_ADMIN_CHAT_SCOPE } from "@/features/messaging/scopes/chatScopeAdapters";
import { Capacitor } from "@capacitor/core";

import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { noteChatMount, noteChatUnmount } from "@/lib/chatPerfDiagnostics";
import { startChatRealtimeChannel } from "@/features/messaging/thread/chatRealtimeChannelLifecycle";
const MESSAGES_PER_PAGE = 15;

interface ClubAdminMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  conversation_id: string;
  reply_to_id: string | null;
  author?: {
    display_name: string | null;
    avatar_url: string | null;
  };
  reply_to?: {
    text: string;
    author?: {
      display_name: string | null;
    };
  } | null;
  reactions?: {
    id: string;
    user_id: string;
    reaction_type: string;
  }[];
}

const getCachedClubAdminMessages = (conversationId: string): ClubAdminMessage[] =>
  getCachedMessages("club_admin", conversationId).map((m) => ({
    id: m.id,
    text: m.text,
    image_url: m.image_url,
    created_at: m.created_at,
    author_id: m.author_id,
    conversation_id: conversationId,
    // Preserve the notification-preload marker so a genuine one-message
    // cached thread can be told apart from a push-preload stub.
    [NOTIFICATION_PRELOAD_FLAG]: (m as any)[NOTIFICATION_PRELOAD_FLAG] === true,
    reply_to_id: m.reply_to_id,
    author: m.profiles
      ? { display_name: m.profiles.display_name, avatar_url: m.profiles.avatar_url }
      : undefined,
    reply_to: m.reply_to
      ? {
          text: m.reply_to.text,
          author: m.reply_to.author ?? (m.reply_to.profiles ? { display_name: m.reply_to.profiles.display_name } : undefined),
        }
      : null,
    reactions: (m.reactions || []).map((r) => ({
      id: r.id || `cached-${m.id}-${r.user_id}-${r.reaction_type}`,
      user_id: r.user_id,
      reaction_type: r.reaction_type,
    })),
  }));

import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { getLocalLabAdminChatMessages } from "@/lab/fixtureDataLayer";

export default function ClubAdminChatPage() {
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  if (useIcpLab) {
    return <IcpLabClubAdminChatPage />;
  }
  return <SupabaseClubAdminChatPage />;
}

/** Read-only synthetic admin chat transcript; sending and media workflows remain unavailable until messaging_domain is wired here. */
function IcpLabClubAdminChatPage() {
  const navigate = useNavigate();
  const messages = getLocalLabAdminChatMessages("club-icp-001");

  return (
    <div className="container max-w-2xl mx-auto px-4 py-6 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Admin Chat</h1>
      </div>
      <p className="text-sm text-muted-foreground">
        Showing a synthetic ICP lab admin chat transcript. Sending messages and media uploads are disabled.
      </p>
      <div className="space-y-2">
        {messages.map((message) => (
          <Card key={message.id}>
            <CardContent className="p-3">
              <p className="text-xs font-medium text-muted-foreground">{message.author.display_name}</p>
              <p className="text-sm">{message.text}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}

function SupabaseClubAdminChatPage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("ClubAdminChat", null);
    return () => noteChatUnmount("ClubAdminChat", k, null);
  }, []);
  const { conversationId } = useParams<{ conversationId: string }>();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile, initialized } = useAuth();
  const queryClient = useQueryClient();
  const authReady = !!user && initialized;
  const openedFromNotificationRef = useRef<number | null>(
    conversationId ? consumeFromNotificationFlag("club_admin", conversationId) : null,
  );
  const [message, setMessage, clearDraft] = useChatDraft(conversationId);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const scheduleTarget: ScheduleTarget | null = conversationId
    ? { chat_type: "club_admin", conversation_id: conversationId }
    : null;
  const [replyTo, setReplyTo] = useChatDraftReply<ClubAdminMessage>(conversationId);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [pollDialogOpen, setPollDialogOpen] = useState(false);
  const [pendingPollId, setPendingPollId] = useState<string | null>(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [participantsOpen, setParticipantsOpen] = useState(false);
  const isMobile = useIsMobile();

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  // Legacy DOM refs kept declared so non-scroll code paths still compile.
  // Virtuoso owns scroll end-to-end via virtualHandleRef.
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const { elementRef: composerRef, height: composerHeight } = useMeasuredElementHeight<HTMLDivElement>(
    [replyTo?.id, editingMessage?.id],
    56,
  );
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const swipeBack = useSwipeBack();

  // AI Chat Recap wiring.
  useEffect(() => { if (conversationId) markChatOpened("club_admin", conversationId); }, [conversationId]);
  const summarizeTriggerRef = useRef<(() => void) | null>(null);
  const { featureDisabled: aiCatchUpDisabled } = useAICatchUpAvailability("club_admin", conversationId);

  const chatHeight = useChatViewportHeight();
  const isKeyboardOpen = useKeyboardOpen();
  const nativeKbHeight = useNativeKeyboardBottomInset();
  const isNativePlatform = Capacitor.isNativePlatform();

  const scrollToBottom = useCallback(() => {
    virtualHandleRef.current?.scrollToBottom("auto");
  }, []);

  // Fetch conversation details
  // `maybeSingle()` so an absent/RLS-hidden row is a successful `null` rather
  // than a throw — lets the render gate distinguish deleted from unreachable.
  const {
    data: conversation,
    isLoading: conversationLoading,
    isError: conversationIsError,
    fetchStatus: conversationFetchStatus,
    status: conversationStatus,
    refetch: refetchConversation,
    isFetching: conversationIsFetching,
  } = useQuery({
    queryKey: ["club-admin-conversation", conversationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("club_admin_conversations")
        .select("*")
        .eq("id", conversationId)
        .maybeSingle();
      if (error) throw error;
      return data ?? null;
    },
    enabled: !!conversationId && authReady,
    staleTime: 5 * 60 * 1000,
  });

  const { hasPro: clubHasPro, isLoading: clubProLoading } = useClubProAccess(
    conversation?.club_id ?? null,
    { enabled: !!conversation?.club_id && authReady }
  );

  // Sync active club to this conversation's club so push-launched threads
  // don't leave the user inside the wrong club context.
  useSyncActiveClubToChat(conversation?.club_id);

  // Fetch club details
  const { data: club } = useQuery({
    queryKey: ["club-detail-chat", conversation?.club_id],
    queryFn: async () => {
      const clubId = conversation?.club_id;
      if (!clubId) return null;
      const { data, error } = await supabase
        .from("clubs")
        .select("id, name, logo_url")
        .eq("id", clubId)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!conversation?.club_id && authReady,
    staleTime: 5 * 60 * 1000,
  });

  // Fetch member profile (for admin view)
  const { data: memberProfile } = useQuery({
    queryKey: ["club-admin-member-profile", conversation?.member_user_id],
    queryFn: async () => {
      const memberId = conversation?.member_user_id;
      if (!memberId) return null;
      const { data, error } = await selectCachedProfileById(memberId);
      if (error) throw error;
      return data;
    },
    enabled: !!conversation?.member_user_id && authReady,
    staleTime: 5 * 60 * 1000,
  });

  // Determine if current user is the member or an admin
  const isMember = conversation?.member_user_id === user?.id;

  // Seed the header (name + avatar) from the already-loaded admin inbox cache
  // or the shared profile cache, so the chat opens with the member's actual
  // name on first paint instead of flashing "Member" for ~1s while the
  // conversation→profile network round-trip resolves.
  const inboxFallback = useMemo(() => {
    if (!conversationId) return null;
    const inboxQueries = queryClient.getQueriesData<any[]>({ queryKey: ["club-admin-inbox"] });
    for (const [, rows] of inboxQueries) {
      const match = Array.isArray(rows) ? rows.find((r) => r?.id === conversationId) : null;
      if (match)
        return {
          name: match.member_name as string | null,
          avatar: match.member_avatar as string | null,
          // Inbox rows only exist for conversations that already have at least
          // one message — proof that an empty thread response is inconsistent.
          hasMessage: !!(match.last_created_at || match.last_text || match.last_image),
        };
    }
    return null;
  }, [conversationId, queryClient, conversation?.member_user_id]);


  const cachedMemberProfile = useMemo(() => {
    if (!conversation?.member_user_id) return null;
    return getProfileFromCache(conversation.member_user_id);
  }, [conversation?.member_user_id]);

  const resolvedMemberName =
    memberProfile?.display_name ||
    cachedMemberProfile?.display_name ||
    (inboxFallback?.name && inboxFallback.name !== "Member" ? inboxFallback.name : null);
  const resolvedMemberAvatar =
    memberProfile?.avatar_url ||
    cachedMemberProfile?.avatar_url ||
    inboxFallback?.avatar ||
    null;

  // Chat title
  const chatTitle = isMember
    ? `${club?.name || "Club"} Admin`
    : resolvedMemberName || "Member";

  const chatSubtitle = isMember
    ? "Chat with club admins"
    : `${club?.name || "Club"} admin chat`;

  // Memoize query key
  const queryKey = useMemo(() => ["club-admin-messages", conversationId], [conversationId]);

  // Fetch messages
  const {
    data: messagesData,
    isLoading: messagesLoading,
    isError: messagesIsError,
    status: messagesStatus,
    fetchStatus: messagesFetchStatus,
    refetch: refetchMessages,
  } = useQuery({
    queryKey,
    queryFn: async () => {
      // 15s wall budget (mirrors TeamChatPage) so a socket left half-dead by an
      // Android background freeze can never leave this thread pending forever.
      const budget = createChatFetchBudget(15_000);
      try {
        const { data: rawMessages, error } = await supabase
          .from("club_admin_messages")
          .select("id, text, image_url, created_at, edited_at, author_id, conversation_id, reply_to_id, deleted_at")
          .eq("conversation_id", conversationId)
          .is("deleted_at", null)
          .order("created_at", { ascending: false })
          .limit(MESSAGES_PER_PAGE + 1)
          .abortSignal(budget.signal);
        if (error) throw error;

        if (!rawMessages?.length) {
          return { messages: [] as ClubAdminMessage[], hasOlderMessages: false };
        }

        const { items: dataToDisplay, hasMore } = splitPageWindow(rawMessages, MESSAGES_PER_PAGE);

        const messageIds = dataToDisplay.map((m) => m.id);
        const replyToIds = dataToDisplay.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string);
        const authorIds = Array.from(
          new Set<string>(
            dataToDisplay.flatMap((message) =>
              typeof message.author_id === "string" ? [message.author_id] : [],
            ),
          ),
        );

        // allSettled (not all): a hung/failed reactions or profile lookup must
        // degrade to empty enrichment, never block the message body.
        const [reactionsSettled, replyToSettled, profilesSettled] = await Promise.allSettled([
          supabase
            .from("message_reactions")
            .select("id, user_id, reaction_type, club_admin_message_id")
            .in("club_admin_message_id", messageIds)
            .abortSignal(budget.signal),
          replyToIds.length > 0
            ? supabase
                .from("club_admin_messages")
                .select("id, text, author_id")
                .in("id", replyToIds)
                .abortSignal(budget.signal)
            : Promise.resolve({ data: [] as any[] }),
          fetchProfilesWithCache(authorIds),
        ]);

        const reactionsResult: any =
          reactionsSettled.status === "fulfilled" ? reactionsSettled.value : { data: [] };
        const replyToResult: any =
          replyToSettled.status === "fulfilled" ? replyToSettled.value : { data: [] };
        const profilesMap: Map<string, any> =
          profilesSettled.status === "fulfilled" ? profilesSettled.value : new Map();

        const replyToMap = new Map(
          (replyToResult.data || []).map((r: any) => [r.id, {
            ...r,
            author: profilesMap.get(r.author_id) ? { display_name: profilesMap.get(r.author_id)?.display_name } : null,
          }])
        );

        const messages = dataToDisplay.map((msg: any) => {
          const replyToData = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null;
          const msgProfile = profilesMap.get(msg.author_id);
          const msgReactions = (reactionsResult.data || [])
            .filter((r: any) => r.club_admin_message_id === msg.id)
            .map((r: any) => ({ id: r.id, user_id: r.user_id, reaction_type: r.reaction_type }));
          return {
            ...msg,
            author: msgProfile ? { display_name: msgProfile.display_name, avatar_url: msgProfile.avatar_url } : null,
            reply_to: replyToData,
            reactions: msgReactions,
          };
        }) as ClubAdminMessage[];

        return { messages, hasOlderMessages: hasMore };
      } finally {
        budget.done();
      }
    },
    // Session token is sufficient — waiting on the full profile fetch
    // (`authReady`) is exactly what strands this thread when auth is still
    // settling after an Android resume.
    enabled: !!conversationId && !!user?.id,

    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: "always", // Force refetch on every mount so reactions/messages added while away are picked up (true is a no-op while staleTime is unmet)
    refetchOnWindowFocus: false,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
    placeholderData: (prev: any) => {
      if (!conversationId) return prev;
      const cached = getCachedClubAdminMessages(conversationId);
      if (openedFromNotificationRef.current && prev) {
        const prevMessages: ClubAdminMessage[] = Array.isArray(prev) ? prev : (prev.messages || []);
        const merged = [...prevMessages];
        for (const cachedMessage of cached) {
          if (!merged.some((message) => message.id === cachedMessage.id)) merged.push(cachedMessage);
        }
        merged.sort(compareChatMessagesChronologically);
        return Array.isArray(prev) ? merged : { ...prev, messages: merged, fromCache: true };
      }
      if (openedFromNotificationRef.current && isUsableCachedThread(cached as any)) {
        return { messages: cached, hasOlderMessages: false, fromCache: true };
      }
      if (prev) return prev;
      return isUsableCachedThread(cached as any)
        ? { messages: cached, hasOlderMessages: false, fromCache: true }
        : undefined;
    },

  });

  useEffect(() => {
    if (!openedFromNotificationRef.current) return;
    if (!conversationId || !user?.id) return;
    queryClient.invalidateQueries({ queryKey: ["club-admin-messages", conversationId] });
  }, [conversationId, user?.id, queryClient]);

  // Bounded automatic recovery. If the thread fetch returns zero messages (or
  // errors) while auth/RLS/connectivity is still settling after an Android
  // resume or a notification tap, retry with bounded backoff (400ms / 1.2s /
  // 3s) instead of the old single 400ms attempt. Stops on the first non-empty
  // result, on unmount, on conversation change, or when attempts run out.
  const recoveryAttemptRef = useRef(0);
  const recoveryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [recoveryExhausted, setRecoveryExhausted] = useState(false);

  const fetchedCount = useMemo<number | null>(() => {
    if (!messagesData) return null;
    const list = Array.isArray(messagesData) ? messagesData : (messagesData as any).messages;
    return Array.isArray(list) ? list.length : null;
  }, [messagesData]);

  useEffect(() => {
    recoveryAttemptRef.current = 0;
    setRecoveryExhausted(false);
    if (recoveryTimerRef.current) {
      clearTimeout(recoveryTimerRef.current);
      recoveryTimerRef.current = null;
    }
  }, [conversationId]);

  useEffect(() => {
    if (!conversationId || !authReady) return;
    if (messagesFetchStatus === "fetching") return;
    // Nothing to recover from: real content arrived.
    if (fetchedCount !== null && fetchedCount > 0) {
      recoveryAttemptRef.current = 0;
      setRecoveryExhausted(false);
      return;
    }
    const needsRecovery = messagesIsError || fetchedCount === 0;
    if (!needsRecovery) return;
    if (recoveryTimerRef.current) return; // never overlap retry timers

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
  }, [
    conversationId,
    authReady,
    fetchedCount,
    messagesIsError,
    messagesFetchStatus,
    refetchMessages,
  ]);

  useEffect(
    () => () => {
      if (recoveryTimerRef.current) {
        clearTimeout(recoveryTimerRef.current);
        recoveryTimerRef.current = null;
      }
    },
    [],
  );

  const handleManualRetry = useCallback(() => {
    recoveryAttemptRef.current = 0;
    setRecoveryExhausted(false);
    void refetchMessages();
  }, [refetchMessages]);


  // Scope key for the realtime edit/soft-delete reconciliation registry.
  const reconcileScope = `club-admin:${conversationId ?? "none"}`;


  const messages = useMemo(() => {
    if (!messagesData) return [];
    const msgList = Array.isArray(messagesData)
      ? messagesData
      : (messagesData as any).messages || [];
    const sorted = sortChatMessagesChronologically(msgList);
    // Re-apply realtime edits/soft-deletes so a stale in-flight fetch cannot
    // restore pre-edit text or resurrect a deleted row.
    return (reconcileMessages(reconcileScope, sorted) ?? []) as ClubAdminMessage[];
  }, [messagesData, reconcileScope]);

  // Guard: never seed from a push-notification preload stub (it would render
  // a lone message stranded at the top, then blank/jolt when the real fetch
  // resolves). A genuine one-message cached thread IS kept — see
  // mem://technical/notification-preload-single-message-guard.
  const [localMessages, setLocalMessages] = useState<ClubAdminMessage[] | undefined>(() => {
    if (!conversationId) return undefined;
    const cached = getCachedClubAdminMessages(conversationId);
    return isUsableCachedThread(cached as any) ? cached : undefined;
  });

  const localMessagesRef = useRef(localMessages);
  // Realtime reactions must reach BOTH stores (query cache + localMessages).
  const reactionQueryKey = useMemo(() => queryKey, [queryKey]);
  const { applyRealtimeReaction, applyRealtimeReactionDelete } = useRealtimeReactionSync<ClubAdminMessage>({
    scopeKey: reconcileScope,
    // Scope guard: message_reactions realtime events are unfiltered platform-wide.
    getLocalMessages: () => localMessagesRef.current,
    queryKey: reactionQueryKey,
    setLocalMessages,
  });
  localMessagesRef.current = localMessages;

  // Deep-link / push-notification jump: ?message=<id>
  // Polls until the target renders so it works even if the message
  // arrives after the initial query settles. ClubAdmin has no
  // older-message pagination, so no tryLoadOlder is wired.
  const urlMessageId = searchParams.get("message");
  const [liveJump, setLiveJump] = useState<PendingChatJumpPayload | null>(null);
  useEffect(() => subscribePendingChatJump(setLiveJump), []);
  const liveJumpId = liveJump?.kind === "club_admin" && liveJump.targetId === conversationId ? liveJump.messageId : null;
  const urlJumpNonce = searchParams.get("jump");
  const [fallbackJumpId] = useState(() =>
    conversationId ? consumePendingChatJump("club_admin", conversationId) : null,
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

  useEffect(() => {
    if (!targetMessageId) return;
    const cancel = jumpToMessageInVirtualizedChat(
      targetMessageId,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      {
        refetchLatest: () => queryClient.invalidateQueries({ queryKey: ["club-admin-messages", conversationId] }),
        parentMessageId: targetParentId ?? undefined,
      },
    );
    return cancel;
  }, [targetMessageId, targetParentId, targetJumpNonce]);
  // A push-preload-only local cache must still show the loading state —
  // otherwise the stranded stub paints for a frame before the real fetch
  // resolves. Everything else routes through the shared classifier, which
  // treats `pending`/`paused` (Android resume) as loading rather than empty.
  const hasMeaningfulLocal =
    isUsableCachedThread(localMessages as any) || (localMessages?.length ?? 0) > 0
      ? isUsableCachedThread(localMessages as any)
      : false;
  const threadPhase = classifyChatThreadState({
    authReady,
    status: messagesStatus,
    fetchStatus: messagesFetchStatus,
    isError: messagesIsError,
    hasUsableCached: hasMeaningfulLocal,
    fetchedCount,
    inboxSaysHasMessage: !!inboxFallback?.hasMessage,
    recoveryExhausted,
  });
  const showLoading = threadPhase === "loading";
  const showThreadError = threadPhase === "error";

  // Android resume escape hatch: abort zombie GETs + re-issue the gating
  // queries while the page is stuck on a skeleton.
  useChatStuckWatchdog(
    (!!conversationId && (conversationLoading || showLoading)),
    [
      ["club-admin-conversation", conversationId],
      ["club-admin-messages", conversationId],
    ],
    "club-admin-chat",
  );


  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);

  // Reset local cache view when conversation changes
  useEffect(() => {
    if (!conversationId) {
      setLocalMessages(undefined);
      return;
    }
    const cached = getCachedClubAdminMessages(conversationId);
    setLocalMessages(
      isUsableCachedThread(cached as any)
        ? ((reconcileMessages(reconcileScope, cached) ?? []) as ClubAdminMessage[])
        : undefined,
    );

    return () => {
      // Tombstones/patches are per-thread; drop them when leaving the thread.
      clearReconciliationScope(`club-admin:${conversationId ?? "none"}`);
    };
  }, [conversationId, reconcileScope]);

  // Sync localMessages with fetched messages
  useLayoutEffect(() => {
    // Guard: never replace existing messages with an empty array, and only
    // commit an empty thread once the classifier says it is authoritatively
    // empty (not paused/pending/recovering).
    if (messages) {
      if (messages.length > 0) {
        setLocalMessages(messages);
      } else if (threadPhase === "empty" && (!localMessages || localMessages.length === 0)) {
        setLocalMessages(messages);
      }
    }
  }, [messages, threadPhase]);

  // Persist fetched messages to local cache for instant load next time
  useEffect(() => {
    if (!conversationId || !messages || messages.length === 0) return;
    cacheMessages(
      "club_admin",
      conversationId,
      messages.map((m) => ({
        id: m.id,
        text: m.text,
        author_id: m.author_id,
        created_at: m.created_at,
        image_url: m.image_url,
        reply_to_id: m.reply_to_id,
        profiles: m.author
          ? { display_name: m.author.display_name ?? null, avatar_url: m.author.avatar_url ?? null }
          : null,
        reactions: (m.reactions || []).map((r) => ({
          id: r.id,
          user_id: r.user_id,
          reaction_type: r.reaction_type,
        })),
        reply_to: m.reply_to
          ? {
              text: m.reply_to.text,
              author: m.reply_to.author ? { display_name: m.reply_to.author.display_name ?? null } : null,
            }
          : null,
      })),
    );
  }, [conversationId, messages]);

  const isPinned = true;

  // Reply/edit composer growth re-pin is handled inside ChatMessagesScroller
  // via the Virtuoso handle (see virtualHandleRef path). No-op here.

  const [isManualRefreshing, setIsManualRefreshing] = useState(false);

  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["club-admin-messages", conversationId] });
  }, [queryClient, conversationId]);

  const handleManualRefresh = useCallback(async () => {
    setIsManualRefreshing(true);
    try { await handleRefresh(); } finally { setIsManualRefreshing(false); }
  }, [handleRefresh]);

  // Vault mirroring runs ONLY for confirmed-delivered messages, always into the
  // club-admin-restricted folder.
  const clubIdForVault = conversation?.club_id ?? null;
  const syncDeliveredMessageToVault = useChatVaultDeliverySync({
    userId: user?.id,
    scope: clubIdForVault ? { clubId: clubIdForVault, isClubAdminChat: true } : null,
    surfaceLabel: "Club admin chat",
  });
  const syncSendToVault = useCallback(
    (vars: { text: string; imageUrl: string | null }) => {
      syncDeliveredMessageToVault({ text: vars.text, imageUrl: vars.imageUrl ?? null });
    },
    [syncDeliveredMessageToVault],
  );

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, imageUrl, replyToId }: { text: string; imageUrl: string | null; replyToId?: string | null }) => {
      // Offline path: queue the message instead of failing
      if (!navigator.onLine) {
        const queued = queueMessage({
          type: "club_admin",
          targetId: conversationId!,
          authorId: user!.id,
          text,
          imageUrl: imageUrl ?? null,
          replyToId: replyToId || null,
          createdAt: new Date().toISOString(),
          vault: clubIdForVault ? { clubId: clubIdForVault, isClubAdminChat: true } : null,
        });
        return {
          id: queued.id,
          text,
          image_url: imageUrl ?? null,
          conversation_id: conversationId!,
          author_id: user!.id,
          reply_to_id: replyToId || null,
          created_at: queued.createdAt,
          __queued: true,
          ...queuedSend(),
        } as any;
      }
      const { data, error } = await supabase
        .from("club_admin_messages")
        .insert({
          conversation_id: conversationId!,
          author_id: user!.id,
          text,
          image_url: imageUrl ?? null,
          reply_to_id: replyToId || null,
        })
        .select()
        .single();
      if (error) throw error;
      return { ...data, ...deliveredSend() };
    },
    onMutate: async ({ text, imageUrl: optImageUrl, replyToId }) => {
      // Mutation-specific temp id so overlapping sends roll back independently.
      const tempId = createSendTempId();
      const sentAtMs = Date.now();
      const previousReplyTo = replyTo;
      const { baseText: unsentText, pollId: unsentPollId } = splitPollMarkup(text);
      const optimisticMessage: ClubAdminMessage = {
        id: tempId,

        text,
        image_url: optImageUrl ?? null,
        created_at: new Date().toISOString(),
        author_id: user!.id,
        conversation_id: conversationId!,
        reply_to_id: replyToId || null,
        author: {
          display_name: profileRef.current?.display_name || null,
          avatar_url: profileRef.current?.avatar_url || null,
        },
        reply_to: replyToId && replyTo ? { text: replyTo.text, author: replyTo.author } : null,
      };
      setLocalMessages((prev) => [...(prev || []), optimisticMessage]);
      // Pin to bottom in stages so the new bubble lands tight to the composer
      // as the row's late-arriving metadata (timestamp + Sent strip) hydrates.
      // Mirrors Team chat: immediate forced pin bypasses the "finger still in
      // contact" guard, then 180/480ms re-pins absorb composer reflow.
      virtualHandleRef.current?.scrollToBottom("auto", { force: true });
      [120, 320, 600].forEach((delay) => {
        setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto", { force: true }), delay);
      });

      return {
        tempId,
        sentText: unsentText,
        sentImageUrl: optImageUrl ?? null,
        previousReplyTarget: previousReplyTo,
        pendingPollId: unsentPollId,
        sentAtMs,
      } satisfies FailedSendContext<typeof previousReplyTo>;
    },

    onSuccess: (newMessage, variables) => {
      if (isConfirmedDelivery(newMessage)) syncSendToVault(variables);
      const currentReplyTo = replyToRef.current;
      queryClient.setQueryData(
        queryKey,
        (oldData: { messages: ClubAdminMessage[]; hasOlderMessages: boolean } | undefined) => {
          if (!oldData) {
            return {
              messages: [{
                ...newMessage,
                author: { display_name: profileRef.current?.display_name || null, avatar_url: profileRef.current?.avatar_url || null },
                reactions: [],
                reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
              }],
              hasOlderMessages: false,
            };
          }
          const updatedMessages = dropSupersededOptimisticRow(oldData.messages, newMessage)
            .concat({
              ...newMessage,
              author: { display_name: profileRef.current?.display_name || null, avatar_url: profileRef.current?.avatar_url || null },
              reactions: [],
              reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
            });
          return { ...oldData, messages: updatedMessages };
        }
      );
    },
    onError: (err, variables, context) => {
      // Offline sends are queued, not failed — leave the optimistic row alone.
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;

      // Succeeded-but-errored: the authoritative row already arrived.
      if (authoritativeMessageExists(localMessagesRef.current, { authorId: user?.id, text: variables.text, imageUrl: variables.imageUrl ?? null, replyToId: variables.replyToId || null, sentAtMs: context?.sentAtMs })) {
        // Errored request, confirmed delivery: same Vault handling as success.
        syncSendToVault(variables);
        return;
      }

      // Remove ONLY this mutation's optimistic row.
      if (context?.tempId) {
        setLocalMessages((prev) => (prev ? prev.filter((m) => m.id !== context.tempId) : prev));
        queryClient.setQueryData(queryKey, (old: any) => {
          if (!old) return old;
          return { ...old, messages: (old.messages || []).filter((m: ClubAdminMessage) => m.id !== context.tempId) };
        });
      }

      restoreFailedSendComposer({
        context,
        setText: setMessage,
        setImage: setImageUrl,
        setReply: setReplyTo,
        setPoll: setPendingPollId,
      });

      console.error("Failed to send club admin message", err);
      toast.error("Failed to send message. Please try again.");
    },

  });

  const { isSearching: isSearchFetching, canShowEmpty: searchCanShowEmpty } = useChatHistorySearch<ClubAdminMessage>({
    searchQuery,
    loadedMessages: localMessages,
    setMessages: (updater) => setLocalMessages((prev) => updater(prev)),
    enabled: !!conversationId,
    cacheKey: `club_admin:${conversationId ?? ""}`,
    fetcher: async (q, signal) =>
      createChatHistorySearchFetcher<ClubAdminMessage>({
        scope: CLUB_ADMIN_CHAT_SCOPE,
        scopeId: conversationId,
        selectColumns: "id, text, image_url, created_at, edited_at, author_id, conversation_id, reply_to_id",
      })(q, signal),
  });

  const filteredMessages = useMemo(
    () => filterChatMessagesForSearch(localMessages, searchQuery),
    [localMessages, searchQuery],
  );

  // Read receipts: mirror Club/Team chat wiring so admins can see which other
  // admins have opened a member's Contact Club message.
  const messageIds = useMemo(
    () => (filteredMessages ?? []).map((m) => m.id).filter((id) => !id.startsWith("temp-") && !id.startsWith("queued-")),
    [filteredMessages]
  );
  const { readCounts, readFrontier, markMessagesAsRead } = useMessageReads(
    "club_admin",
    conversationId || "",
    messageIds,
    user?.id
  );
  useMarkVisibleChatMessagesRead({
    messages: filteredMessages,
    userId: user?.id,
    markMessagesAsRead,
    excludedIdPrefixes: CHAT_READ_EXCLUDED_WITH_QUEUED_ID_PREFIXES,
  });

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

  const updateMessageMutation = useMutation({
    mutationFn: async () => {
      if (!editingMessage) return;
      const { error } = await supabase.from("club_admin_messages").update({ text: message.trim() }).eq("id", editingMessage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("");
      setEditingMessage(null);
      queryClient.invalidateQueries({ queryKey });
      // silent success
    },
    onError: () => toast.error("Failed to update message"),
  });

  const handleEdit = useCallback((msg: { id: string; text: string }) => {
    setEditingMessage(msg);
    setMessage(msg.text);
    setReplyTo(null);
  }, []);

  const handleCancelEdit = useCallback(() => {
    setEditingMessage(null);
    setMessage("");
  }, []);

  // Typing indicator
  const { typingUsers, startTyping, stopTyping } = useTypingIndicator(
    `club-admin-${conversationId || ""}`,
    user?.id,
    profile?.display_name || user?.email || "Someone"
  );

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

    if (!message.trim() && !imageUrl && !pendingPollId) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
      return;
    }
    stopTyping();
    const baseText = message.trim();
    const finalText = pendingPollId
      ? (baseText ? `${baseText} [poll:${pendingPollId}]` : `[poll:${pendingPollId}]`)
      : baseText;
    sendMessageMutation.mutate({
      text: finalText,
      imageUrl,
      replyToId: replyTo?.id || null,
    });
    setMessage("");
    setImageUrl(null);
    setReplyTo(null);
    setPendingPollId(null);
  };


  // Real-time subscription
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`club-admin-chat-${conversationId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "club_admin_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const newMsg = payload.new as any;
          queryClient.setQueryData(
            queryKey,
            (old: { messages: ClubAdminMessage[]; hasOlderMessages: boolean } | undefined) => {
              if (!old) return old;
              if (old.messages.some(m => m.id === newMsg.id)) return old;
              const filtered = dropSupersededOptimisticRow(old.messages, newMsg);
              return {
                ...old,
                messages: sortChatMessagesChronologically([...filtered, { ...newMsg, author: null, reactions: [], reply_to: null }]),
              };
            }
          );
          // Fetch profile async
          selectCachedProfileById(newMsg.author_id).then(({ data: p }) => {
            if (!p) return;
            queryClient.setQueryData(queryKey, (old: any) => {
              if (!old) return old;
              return {
                ...old,
                messages: old.messages.map((m: any) =>
                  m.id === newMsg.id ? { ...m, author: { display_name: p.display_name, avatar_url: p.avatar_url } } : m
                ),
              };
            });
          });
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "club_admin_messages", filter: `conversation_id=eq.${conversationId}` },
        (payload) => {
          const updated = payload.new as any;
          if (!updated?.id) return;
          // Record first so any query response already in flight is reconciled
          // when it lands (stale-fetch resurrection guard). Idempotent.
          const outcome = recordRealtimeMutation(reconcileScope, updated);

          if (outcome === "deleted") {
            queryClient.setQueryData(queryKey, (old: any) =>
              old ? { ...old, messages: removeMessage(old.messages || [], updated.id) } : old,
            );
            setLocalMessages((prev) => (prev ? removeMessage(prev, updated.id) : prev));
            return;
          }

          // Apply the edit to BOTH stores with the same pure helper so they
          // can never diverge. Fields absent from the payload are preserved.
          queryClient.setQueryData(queryKey, (old: any) =>
            old ? { ...old, messages: applyMessageUpdate(old.messages || [], updated) } : old,
          );
          setLocalMessages((prev) => (prev ? applyMessageUpdate(prev, updated) : prev));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction?.club_admin_message_id || !reaction.id) return;
          applyRealtimeReaction(reaction.club_admin_message_id, reaction);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "message_reactions" },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction?.club_admin_message_id || !reaction.id) return;
          applyRealtimeReaction(reaction.club_admin_message_id, reaction);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          const deleted = payload.old as any;
          if (!deleted?.id) return;
          applyRealtimeReactionDelete(deleted.club_admin_message_id ?? null, deleted.id);
        }
      );
    return startChatRealtimeChannel({
      channel,
      channelKey: `club-admin-chat-${conversationId}`,
      userId: user?.id,
      // Scoped by CLUB id: losing club membership must revoke this channel.
      scope: { kind: "club_admin", id: conversation?.club_id ?? conversationId },
      cacheKeys: [["club-admin-messages", conversationId]],
    });
  }, [conversationId, conversation?.club_id, queryClient, queryKey, user?.id, reconcileScope, applyRealtimeReaction, applyRealtimeReactionDelete]);

  // Visibility change handler
  useEffect(() => {
    let lastRefresh = Date.now();
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && conversationId) {
        if (Date.now() - lastRefresh > 30000) {
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey });
        }
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [conversationId, queryClient, queryKey]);

  // Don't hard-gate on conversationLoading if we already have cached messages —
  // a full-page loader would replace the chat tree mid-mount and force Virtuoso
  // to re-pin against a fresh layout, causing a visible jolt. Render the shell
  // immediately when we have cached content; only show the skeleton on true cold load.
  const conversationMetadataState = resolveChatMetadataState({
    data: conversation,
    isLoading: conversationLoading,
    isError: conversationIsError,
    fetchStatus: conversationFetchStatus,
    status: conversationStatus,
    isOnline: typeof navigator === "undefined" ? true : navigator.onLine !== false,
  });

  if (
    conversationMetadataState === "loading" &&
    !(localMessages && localMessages.length > 0)
  ) {
    return <ChatPageSkeleton />;
  }

  if (conversationMetadataState === "unreachable" && !conversation) {
    return (
      <ChatUnreachable
        label="conversation"
        onRetry={() => void refetchConversation()}
        retrying={conversationIsFetching}
      />
    );
  }

  if (conversationMetadataState === "missing") {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">Conversation not found</p>
        <Button onClick={() => navigate("/messages")}>Go to Messages</Button>
      </div>
    );
  }

  // Same escape hatch as the metadata gate above: if we already have messages in
  // hand, a transient `undefined` conversation (refetch / cache eviction) must
  // not swap the painted thread back to a full-page skeleton.
  if (!conversation && !(localMessages && localMessages.length > 0)) return <ChatPageSkeleton />;



  return (
    <div className="flex min-h-0 flex-col overflow-hidden overscroll-none" style={{ height: chatHeight }} data-lock-keyboard-scroll="true" onTouchStart={swipeBack.onTouchStart} onTouchEnd={swipeBack.onTouchEnd}>
      {/* Header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b bg-background shrink-0 relative">
        <ChatSearchBar onSearch={setSearchQuery} isOpen={searchOpen} onOpenChange={setSearchOpen} isSearching={isSearchFetching} />
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <ChatBackButton />
          <button
            type="button"
            onClick={() => setParticipantsOpen(true)}
            className="flex items-center gap-2 min-w-0 flex-1 text-left active:opacity-70 transition-opacity touch-manipulation"
            aria-label="View participants"
          >
            <Avatar className="h-10 w-10 shrink-0">
              <AvatarImage src={isMember ? (club?.logo_url || undefined) : (resolvedMemberAvatar || undefined)} />
              <AvatarFallback className="bg-primary/10 text-primary">
                {(isMember ? club?.name : resolvedMemberName)?.charAt(0).toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <h1 className="font-semibold flex items-center gap-2 truncate">
                {chatTitle}
                <Users className="h-4 w-4 text-muted-foreground shrink-0" />
              </h1>
              <p className="text-xs text-muted-foreground truncate">{chatSubtitle}</p>
            </div>
          </button>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" className="h-9 w-9" onClick={() => setSearchOpen(true)}>
            <Search className="h-4 w-4" />
          </Button>
            <ChatHeaderMenu
              onRefresh={handleManualRefresh}
              isRefreshing={isManualRefreshing}
              onScheduleMessage={scheduleTarget ? () => setScheduleDialogOpen(true) : undefined}
              scheduleMessageLocked={!clubProLoading && !clubHasPro}
              onSummarizeMessages={(!aiCatchUpDisabled && clubHasPro) ? () => summarizeTriggerRef.current?.() : undefined}
              summarizeLocked={!clubProLoading && !clubHasPro}
            />
        </div>
      </div>

      <ChatThreadSponsorStrip clubId={conversation?.club_id ?? null} />

      <ChatCatchUp
        scope_type="club_admin"
        scope_id={conversationId}
        unreadCount={0}
        latestMessageId={filteredMessages?.[filteredMessages.length - 1]?.id ?? null}
        proLocked={!clubProLoading && !clubHasPro}
        upgradeHref={conversation?.club_id ? `/clubs/${conversation.club_id}/upgrade` : undefined}
        registerTrigger={(fn) => { summarizeTriggerRef.current = fn; }}
      />


      {/* Messages area */}
      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden overscroll-none">
        {showLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : showThreadError ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <p className="text-sm font-medium text-foreground">Messages could not be loaded</p>
            <p className="text-sm text-muted-foreground">
              Check your connection and try again — nothing has been lost.
            </p>
            <Button variant="outline" size="sm" onClick={handleManualRetry}>
              <RefreshCw className="mr-2 h-4 w-4" />
              Retry
            </Button>
          </div>
        ) : (isSearchFetching || (!!searchQuery && !searchCanShowEmpty)) ? (
          <ChatSearchLoadingState />
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState title={isMember ? `Send a message to ${club?.name || "club"} admins` : `Start a conversation with ${memberProfile?.display_name || "this member"}`} />
        ) : (
          <ChatMessagesScroller
            messages={filteredMessages || []}
            hasOlderMessages={false}
            isLoadingOlder={false}
            onLoadOlder={() => {}}
            isPinned={isPinned}
            isKeyboardOpen={isKeyboardOpen}
            searchOpen={searchOpen}
            composerHeight={composerHeight}
            currentUserId={user?.id}
            virtualHandleRef={virtualHandleRef}
            initialBottomPinned={!targetMessageId}
            renderRow={(msg, index, arr) => {
              const prevMessage = index > 0 ? arr[index - 1] : null;
              const nextMessage = index < arr.length - 1 ? arr[index + 1] : null;
              const showDateSeparator = !prevMessage ||
                !isSameDay(new Date(msg.created_at), new Date(prevMessage.created_at));
              const groupedWithPrev = !showDateSeparator && shouldGroupWithPrev(msg, prevMessage);
              const groupedWithNext = nextMessage
                ? isSameDay(new Date(msg.created_at), new Date(nextMessage.created_at)) && shouldGroupWithPrev(nextMessage, msg)
                : false;
              return (
                <>
                  {showDateSeparator && <ChatDateSeparator date={new Date(msg.created_at)} />}
                  <div
                    id={`message-${msg.id}`}
                    className={`transition-colors duration-500 ${
                      highlightedMessageId === msg.id ? "bg-primary/10 rounded-lg" : ""
                    }`}
                  >
                    <ChatMessage
                      id={msg.id}
                      text={msg.text}
                      imageUrl={msg.image_url}
                      authorId={msg.author_id}
                      authorName={getProfile(msg.author_id)?.display_name || msg.author?.display_name || null}
                      authorAvatar={getProfile(msg.author_id)?.avatar_url || msg.author?.avatar_url || null}
                      timestamp={format(new Date(msg.created_at), "h:mm a")}
                      isOwn={msg.author_id === user?.id}
                      isAdmin={false}
                      reactions={msg.reactions || []}
                      currentUserId={user?.id}
                      messageType="club_admin"
                      searchQuery={searchQuery}
                      queryKey={queryKey}
                      contextId={conversationId || ""}
                      replyToMessage={
                        msg.reply_to
                          ? { text: msg.reply_to.text, authorName: msg.reply_to.author?.display_name || null }
                          : null
                      }
                      hasReply={!!msg.reply_to_id}
                      isEdited={!!(msg as any).edited_at}
                      onReply={() => {
                        setReplyTo(msg);
                        setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), 100);
                      }}
                      onEdit={handleEdit}
                      readFrontierReaders={readFrontier[msg.id] || []}
                      readCount={readCounts[msg.id] || 0}
                      isLastMessage={index === arr.length - 1}
                      isLastOwnMessage={msg.author_id === user?.id && !arr.slice(index + 1).some((m: any) => m.author_id === user?.id)}
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


      {/* Input area */}
      <ClubAdminChatComposerFooter
        composerRef={composerRef}
        searchOpen={searchOpen}
        nativeKbHeight={nativeKbHeight}
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
          clearDraft?.();
        }}
        pendingPollId={pendingPollId}
        onPendingPollIdChange={setPendingPollId}
        isSending={sendMessageMutation.isPending}
        imageUrl={imageUrl}
        onImageUploaded={setImageUrl}
        clubId={conversation?.club_id || undefined}
        clubAdminMemberUserId={conversation?.member_user_id || undefined}
        message={message}
        onMessageChange={setMessage}
        onStartTyping={startTyping}
        onStopTyping={stopTyping}
        onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
        onSend={handleSend}
        conversationId={conversationId}
        pollDialogOpen={pollDialogOpen}
        onPollDialogOpenChange={setPollDialogOpen}
      />
      {conversationId && (
        <Sheet open={participantsOpen} onOpenChange={setParticipantsOpen}>
          <SheetContent
            side={isMobile ? "bottom" : "right"}
            className={cn(
              "flex min-h-0 flex-col overflow-hidden p-0 gap-0",
              isMobile ? "h-[85vh] max-h-[85vh] rounded-t-2xl" : "w-[400px] sm:max-w-md",
            )}
            hideCloseButton
            enableDragToClose={isMobile}
            data-lock-keyboard-scroll="true"
            data-allow-scroll
            style={{ touchAction: "pan-y", WebkitOverflowScrolling: "touch" }}
          >
            <SheetTitle className="sr-only">{chatTitle} participants</SheetTitle>
            <SheetDescription className="sr-only">
              People who can see this club admin conversation.
            </SheetDescription>
            <div className="relative px-5 pt-5 pb-3 border-b">
              <Button
                variant="ghost"
                size="icon"
                className="absolute right-3 top-3 h-9 w-9"
                onClick={() => setParticipantsOpen(false)}
                aria-label="Close"
              >
                <X className="h-5 w-5" />
              </Button>
              <div className="text-center">
                <h2 className="text-lg font-bold tracking-tight">{chatTitle}</h2>
                <p className="text-sm text-muted-foreground mt-0.5">{chatSubtitle}</p>
              </div>
            </div>
            <div
              className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 pt-3"
              data-chat-scroll-lock="true"
              style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
            >
              {conversation?.club_id ? (
                <ChatParticipantsList
                  chatType="club_admin"
                  chatId={conversationId}
                  chatName={chatTitle}
                  clubId={conversation.club_id}
                  clubAdminMemberUserId={conversation.member_user_id || undefined}
                  enabled={participantsOpen}
                  onBeforeNavigate={() => setParticipantsOpen(false)}
                  inline
                />
              ) : (
                <div className="flex justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                </div>
              )}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </div>
  );
}
