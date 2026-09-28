import { useRealtimeReactionSync } from "@/hooks/useRealtimeReactionSync";
import React, { useState, useEffect, useRef, useMemo, useCallback, useLayoutEffect } from "react";
import { consumePendingChatJump, getLastConsumedPendingChatJumpTs, subscribePendingChatJump, type PendingChatJumpPayload } from "@/lib/pendingChatJump";
import { resolveChatJumpTarget } from "@/lib/resolveChatJumpTarget";
import { filterChatMessagesForSearch } from "@/features/messaging/thread/chatSearchPresentation";
import { useChatDraft, useChatDraftReply } from "@/hooks/useChatDraft";
import { findLocalReplyMessage } from "@/lib/chatRealtimeReply";
import { splitPageWindow } from "@/lib/chatPageWindow";
import { sortChatMessagesChronologically } from "@/lib/chatMessageOrder";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useChatViewportHeight } from "@/hooks/useChatViewportHeight";
import { ChatMessagesScroller } from "@/components/chat/ChatMessagesScroller";
import type { VirtualizedChatMessageListHandle } from "@/components/chat/VirtualizedChatMessageList";
import { useMeasuredElementHeight } from "@/hooks/useMeasuredElementHeight";
import { keepComposerFocusedThroughSend } from "@/lib/chatComposerFocus";
import { useKeyboardOpen } from "@/hooks/useKeyboardOpen";
import { useNativeKeyboardBottomInset } from "@/hooks/useNativeKeyboardBottomInset";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import * as fixtureData from "@/lab/fixtureDataLayer";
import { markChatScopeNotificationsRead } from "@/lib/markChatScopeRead";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { ArrowLeft, Loader2, Crown, Lock, Search } from "lucide-react";
import { useSwipeBack } from "@/hooks/useSwipeBack";
import { ChatPageSkeleton } from "@/components/chat/ChatPageSkeleton";
import { ChatHeaderMenu } from "@/components/chat/ChatHeaderMenu";
import { ChatCatchUp } from "@/components/chat/ChatCatchUp";
import { markChatOpened } from "@/hooks/useChatCatchUp";
import { useAICatchUpAvailability } from "@/hooks/useAICatchUpAvailability";
import { useUnreadMessageCounts } from "@/hooks/useUnreadMessageCounts";
import { jumpToMessageInVirtualizedChat } from "@/lib/jumpToMessage";
import { PinnedMessagesBanner } from "@/components/chat/PinnedMessagesBanner";
import { usePinnedMessages } from "@/hooks/usePinnedMessages";
import { useChatPageReady } from "@/hooks/useChatPageReady";

import { ChatHeaderShell } from "@/components/chat/ChatHeaderShell";
import { useIsUserOnline } from "@/hooks/useUserPresence";
import { ChatDetailsSheet } from "@/components/chat/ChatDetailsSheet";

import { toast } from "sonner";
import { DirectMessageComposerFooter } from "@/components/chat/DirectMessageComposerFooter";
import type { ScheduleTarget } from "@/hooks/useScheduledMessages";
import { useScheduleProAccess } from "@/hooks/useScheduleProAccess";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ChatEmptyState } from "@/components/chat/ChatEmptyState";
import { ChatMessage } from "@/components/chat/ChatMessage";
import { shouldGroupWithPrev } from "@/lib/chatGrouping";
import {
  recordRealtimeMutation,
  reconcileMessages,
  applyMessageUpdate,
  removeMessage,
  isTombstoned,
  clearReconciliationScope,
} from "@/lib/chatMessageReconciliation";
import { createSendTempId, restoreFailedSendComposer, authoritativeMessageExists, dropSupersededOptimisticRow, type FailedSendContext } from "@/lib/failedSendRestore";

import { format, isSameDay } from "date-fns";
import { ChatDateSeparator } from "@/components/chat/ChatDateSeparator";
import { fetchProfilesWithCache, selectCachedProfileById } from "@/lib/profileCache";
import { useProfiles } from "@/hooks/useProfiles";
import { Card, CardContent } from "@/components/ui/card";
import { getCachedMessages, cacheMessages, CachedMessage, shouldRefetchMessages } from "@/lib/messageCache";
import { consumeFromNotificationFlag } from "@/lib/notificationPreload";
import { logChatOpenLatency } from "@/lib/chatOpenLatency";
import { useChatPerfMarks, markChatFetch } from "@/hooks/useChatPerfMarks";
import { queueMessage } from "@/lib/messageQueue";
import { ChatSearchBar, ChatSearchLoadingState } from "@/components/chat/ChatSearch";
import { useChatHistorySearch } from "@/hooks/useChatHistorySearch";
import { createChatHistorySearchFetcher } from "@/features/messaging/thread/chatHistorySearchFetcher";
import { DIRECT_CHAT_SCOPE } from "@/features/messaging/scopes/chatScopeAdapters";
import { isIgniteSupportUser } from "@/lib/systemUser";
import { useMessageReads } from "@/hooks/useMessageReads";
import { useMarkVisibleChatMessagesRead } from "@/hooks/useMarkVisibleChatMessagesRead";
import { useTypingIndicator } from "@/hooks/useTypingIndicator";
import { Capacitor } from "@capacitor/core";
import { useNotificationNudge } from "@/hooks/useNotificationNudge";
import { NotificationNudgeBanner } from "@/components/NotificationNudgeBanner";
import { noteChatMount, noteChatUnmount } from "@/lib/chatPerfDiagnostics";
import { startChatRealtimeChannel } from "@/features/messaging/thread/chatRealtimeChannelLifecycle";
import { shouldSkipChatMountInvalidate } from "@/lib/chatMountInvalidate";
import { useChatStuckWatchdog } from "@/lib/chatStuckWatchdog";
import { isChatEagerInvalidateEnabled, ensureSessionApplied } from "@/lib/chatEagerInvalidate";


const MESSAGES_PER_PAGE = 15;

interface DirectMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  author_id: string;
  conversation_id: string;
  reply_to_id: string | null;
  forwarded_from_user_id?: string | null;
  forwarded_at?: string | null;
  forwarded_source_label?: string | null;
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

interface DirectConversation {
  id: string;
  participant_1: string;
  participant_2: string;
  created_at: string;
  updated_at: string;
}

const getCachedDirectMessages = (conversationId: string): DirectMessage[] =>
  getCachedMessages("dm", conversationId).map((cachedMessage) => ({
    id: cachedMessage.id,
    text: cachedMessage.text,
    image_url: cachedMessage.image_url,
    created_at: cachedMessage.created_at,
    author_id: cachedMessage.author_id,
    conversation_id: conversationId,
    reply_to_id: cachedMessage.reply_to_id,
    author: cachedMessage.profiles
      ? {
          display_name: cachedMessage.profiles.display_name,
          avatar_url: cachedMessage.profiles.avatar_url,
        }
      : undefined,
    reply_to: cachedMessage.reply_to
      ? {
          text: cachedMessage.reply_to.text,
          author: cachedMessage.reply_to.author || cachedMessage.reply_to.profiles,
        }
      : null,
    reactions: (cachedMessage.reactions || []).map((reaction) => ({
      id: reaction.id || `cached-${cachedMessage.id}-${reaction.user_id}-${reaction.reaction_type}`,
      user_id: reaction.user_id,
      reaction_type: reaction.reaction_type,
    })),
  }));

const toCachedDirectMessages = (messages: DirectMessage[]): CachedMessage[] =>
  messages.map((message) => ({
    id: message.id,
    text: message.text,
    author_id: message.author_id,
    created_at: message.created_at,
    image_url: message.image_url,
    reply_to_id: message.reply_to_id,
    profiles: message.author
      ? { display_name: message.author.display_name, avatar_url: message.author.avatar_url }
      : null,
    reactions: message.reactions || [],
    reply_to: message.reply_to ? { text: message.reply_to.text, author: message.reply_to.author } : null,
  }));

const cacheDirectMessages = (conversationId: string, messages: DirectMessage[]) => {
  cacheMessages("dm", conversationId, toCachedDirectMessages(messages));
};

const mergeDirectMessages = (
  incomingMessages: DirectMessage[],
  previousMessages?: DirectMessage[] | null,
  reconcileScope?: string,
): DirectMessage[] => {
  if (!previousMessages?.length) {
    return (reconcileScope
      ? reconcileMessages(reconcileScope, incomingMessages) ?? []
      : incomingMessages) as DirectMessage[];
  }

  const incomingIds = new Set(incomingMessages.map((message) => message.id));
  const realByAuthorText = new Set(
    incomingMessages
      .filter((message) => !message.id.startsWith("temp-") && !message.id.startsWith("queued-"))
      .map((message) => `${message.author_id}::${message.text ?? ""}::${message.image_url ?? ""}`),
  );
  const previousOnly = previousMessages.filter((message) => {
    if (incomingIds.has(message.id)) return false;
    // A soft-deleted row is absent from `incomingMessages`; without this guard
    // the fail-open branch below would re-add it on every sync.
    if (reconcileScope && isTombstoned(reconcileScope, message.id)) return false;
    if (message.id.startsWith("temp-") || message.id.startsWith("queued-")) {
      const key = `${message.author_id}::${message.text ?? ""}::${message.image_url ?? ""}`;
      if (realByAuthorText.has(key)) return false;
    }
    return true;
  });
  const mergedIncoming = incomingMessages.map((message) => {
    const previousMessage = previousMessages.find((item) => item.id === message.id);
    if (!previousMessage) return message;

    const previousReactions = previousMessage.reactions || [];
    const incomingReactions = message.reactions || [];
    const incomingByUser = new Map<string, (typeof incomingReactions)[number]>();

    incomingReactions.forEach((reaction) => {
      incomingByUser.set(reaction.user_id, reaction);
    });

    const incomingIds = new Set(incomingReactions.map((reaction) => reaction.id));
    const missingFromIncoming = previousReactions.filter((reaction) => {
      if (incomingIds.has(reaction.id)) return false;
      return !incomingByUser.has(reaction.user_id);
    });

    return {
      ...message,
      reactions: [...incomingReactions, ...missingFromIncoming],
    };
  });

  const merged = sortChatMessagesChronologically([...previousOnly, ...mergedIncoming]);
  return (reconcileScope
    ? reconcileMessages(reconcileScope, merged) ?? []
    : merged) as DirectMessage[];
};

export default function DirectMessagePage() {
  // [chat-perf-diag] track mount/unmount lifetime
  React.useEffect(() => {
    const k = noteChatMount("DirectMessage", null);
    return () => noteChatUnmount("DirectMessage", k, null);
  }, []);
  const { conversationId } = useParams<{ conversationId: string }>();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user, profile, initialized, refreshUnreadCount, decrementUnreadCount } = useAuth();
  const notificationNudge = useNotificationNudge(user?.id, "chat");
  const swipeBack = useSwipeBack();
  const queryClient = useQueryClient();
  const authReady = !!user && initialized;
  // Read once on mount: was this thread opened from a push notification within
  // the last 60s? Stores the tap timestamp (ms epoch) so we can measure
  // tap → first-message-render latency below.
  const openedFromNotificationRef = useRef<number | null>(
    conversationId ? consumeFromNotificationFlag("dm", conversationId) : null,
  );
  const mountTsRef = useRef<number>(Date.now());
  const perfLoggedRef = useRef<boolean>(false);
  const [message, setMessage, clearDraft] = useChatDraft(conversationId);
  const [scheduleDialogOpen, setScheduleDialogOpen] = useState(false);
  const scheduleTarget: ScheduleTarget | null = conversationId
    ? { chat_type: "direct", conversation_id: conversationId }
    : null;
  const { hasAccess: hasSchedulePro, isLoading: scheduleProLoading } = useScheduleProAccess(scheduleTarget);
  const [replyTo, setReplyTo] = useChatDraftReply<DirectMessage>(conversationId);
  const [editingMessage, setEditingMessage] = useState<{ id: string; text: string } | null>(null);
  const [highlightedMessageId, setHighlightedMessageId] = useState<string | null>(null);
  const [hasOlderMessages, setHasOlderMessages] = useState(true);
  const [isLoadingOlder, setIsLoadingOlder] = useState(false);
  const loadOlderMessagesRef = useRef<(() => void) | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchOpen, setSearchOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [dmImageUrl, setDmImageUrl] = useState<string | null>(null);
  const [eventPickerOpen, setEventPickerOpen] = useState(false);
  const [newsPickerOpen, setNewsPickerOpen] = useState(false);
  const [pendingNewsId, setPendingNewsId] = useState<string | null>(null);
  const [boardPickerOpen, setBoardPickerOpen] = useState(false);

  const profileRef = useRef(profile);
  profileRef.current = profile;
  const replyToRef = useRef(replyTo);
  replyToRef.current = replyTo;
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const virtualHandleRef = useRef<VirtualizedChatMessageListHandle>(null);
  const isNativeIOS = Capacitor.isNativePlatform() && Capacitor.getPlatform() === "ios";
  const chatHeight = useChatViewportHeight();
  const isKeyboardOpen = useKeyboardOpen();
  const nativeKbHeight = useNativeKeyboardBottomInset();
  const isNativePlatform = Capacitor.isNativePlatform();

  // Mark direct message notifications as read when opening this thread
  useEffect(() => {
    if (!user || !conversationId) return;
    markChatScopeNotificationsRead({
      userId: user.id,
      scope: { kind: "dm", conversationId },
      queryClient,
      decrementUnreadCount,
      refreshUnreadCount,
    });
  }, [user, conversationId, refreshUnreadCount, decrementUnreadCount, queryClient]);

  // AI Chat Recap wiring. DM Pro-gate mirrors schedule message gating.
  useEffect(() => { if (conversationId) markChatOpened("direct", conversationId); }, [conversationId]);
  const summarizeTriggerRef = useRef<(() => void) | null>(null);
  const { featureDisabled: aiCatchUpDisabled } = useAICatchUpAvailability("direct", conversationId);
  const { data: dmUnreadCount = 0 } = useUnreadMessageCounts<number>(user?.id ?? null, {
    enabled: !!conversationId,
    select: (d) => (conversationId ? d.dms[conversationId] ?? 0 : 0),
  });



  const scrollToBottom = useCallback(() => {
    virtualHandleRef.current?.scrollToBottom("auto");
  }, []);

  const urlMessageId = searchParams.get("message");
  const [liveJump, setLiveJump] = useState<PendingChatJumpPayload | null>(null);
  useEffect(() => subscribePendingChatJump(setLiveJump), []);
  const liveJumpId = liveJump?.kind === "dm" && liveJump.targetId === conversationId ? liveJump.messageId : null;
  const urlJumpNonce = searchParams.get("jump");
  const [fallbackJumpId] = useState(() =>
    conversationId ? consumePendingChatJump("dm", conversationId) : null,
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
        tryLoadOlder: () => loadOlderMessagesRef.current?.(),
        refetchLatest: () => queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] }),
        parentMessageId: targetParentId ?? undefined,
      },
    );
    return cancel;
  }, [targetMessageId, targetParentId, targetJumpNonce]);

  // Pinned messages (DM)
  const chatReady = useChatPageReady();
  const {
    pins: pinnedMessages,
    pinnedMessageIds,
    pin: pinMessage,
    unpin: unpinMessage,
    canPinMore,
  } = usePinnedMessages("dm", conversationId, { enabled: chatReady });
  const handleJumpToPinned = (mid: string) =>
    jumpToMessageInVirtualizedChat(
      mid,
      () => localMessagesRef.current ?? [],
      () => virtualHandleRef.current,
      setHighlightedMessageId,
      { tryLoadOlder: () => loadOlderMessagesRef.current?.() },
    );

  // Fetch conversation details
  const { data: conversation, isLoading: conversationLoading } = useQuery({
    queryKey: ["dm-conversation", conversationId],
    queryFn: async () => {
      if (useIcpLab && conversationId && user?.id) return fixtureData.getLocalLabDirectConversation(conversationId, user.id);

      const { data, error } = await supabase
        .from("direct_conversations")
        .select("*")
        .eq("id", conversationId)
        .single();
      if (error) throw error;
      return data as DirectConversation;
    },
    enabled: !!conversationId && authReady,
    staleTime: 5 * 60 * 1000,
  });

  // Get the other participant's ID
  const otherUserId = conversation 
    ? (conversation.participant_1 === user?.id ? conversation.participant_2 : conversation.participant_1)
    : null;

  // Check if this is a conversation with Ignite Support (system user)
  const isIgniteSupportConversation = isIgniteSupportUser(otherUserId);

  // Live presence — true when the other user has the app open in any tab.
  const isOtherUserOnline = useIsUserOnline(otherUserId);

  const { elementRef: composerRef, height: composerHeight } = useMeasuredElementHeight<HTMLDivElement>(
    [isIgniteSupportConversation, replyTo, editingMessage],
  );

  // Fetch other participant's profile
  const { data: otherUser, isLoading: otherUserLoading } = useQuery({
    queryKey: ["dm-other-user", otherUserId],
    queryFn: async () => {
      const { data, error } = await selectCachedProfileById(otherUserId!);
      if (error) {
        console.error("[DM] Failed to fetch other user profile:", error.message);
        throw error;
      }
      if (!data?.display_name) {
        console.warn("[DM] Profile returned without display_name for", otherUserId);
      }
      return data;
    },
    enabled: !!otherUserId && authReady,
    staleTime: 5 * 60 * 1000,
    retry: 3,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 5000),
  });

  // Find the first club both DM participants share. Used to scope vault picker
  // and event picker actions inside the "+" menu so users can attach files /
  // events / live boards even from a 1:1 conversation.
  const { data: sharedClubId } = useQuery({
    queryKey: ["dm-shared-club", user?.id, otherUserId],
    queryFn: async () => {
      if (!user?.id || !otherUserId) return null;
      const [mine, theirs] = await Promise.all([
        supabase.from("user_roles").select("club_id").eq("user_id", user.id).not("club_id", "is", null),
        supabase.from("user_roles").select("club_id").eq("user_id", otherUserId).not("club_id", "is", null),
      ]);
      const mineSet = new Set((mine.data || []).map((r: any) => r.club_id).filter(Boolean));
      const match = (theirs.data || []).map((r: any) => r.club_id).find((id: string) => id && mineSet.has(id));
      return (match as string) || null;
    },
    enabled: !!user?.id && !!otherUserId && !isIgniteSupportConversation,
    staleTime: 5 * 60 * 1000,
  });

  // App-admin-controlled per-club / per-user disable of the "+" attachment menu in DMs
  const { data: attachmentsDisabled } = useQuery({
    queryKey: ["dm-attachments-disabled", user?.id],
    queryFn: async () => {
      if (!user?.id) return false;
      const { data, error } = await supabase.rpc("dm_attachments_disabled", { _user_id: user.id });
      if (error) return false;
      return !!data;
    },
    enabled: !!user?.id && !isIgniteSupportConversation,
    staleTime: 5 * 60 * 1000,
  });
  const { data: canDM, isLoading: checkingCanDM } = useQuery({
    queryKey: ["can-dm", otherUserId],
    queryFn: async () => {
      if (!otherUserId) return false;
      // Always allow DMs with Ignite Support
      if (isIgniteSupportUser(otherUserId)) return true;
      
      const { data, error } = await supabase.rpc("can_dm_user", { other_user_id: otherUserId });
      if (error) {
        console.error("can_dm_user error:", error);
        // If RPC fails, don't block - they may have an existing conversation
        return true;
      }
      return data as boolean;
    },
    enabled: !!otherUserId && authReady,
    staleTime: 30 * 1000, // Shorter stale time - 30 seconds
    refetchOnMount: "always", // Force refetch on every mount (true is a no-op while staleTime is unmet)
  });

  // Memoize query key to prevent ChatMessage memo breaks
  const dmQueryKey = useMemo(() => ["dm-messages", conversationId], [conversationId]);

  // Force a fresh fetch whenever we land on this conversation. Push notifications
  // and inbox taps can land here while react-query still has stale data from a
  // prefetch — invalidating guarantees the latest message is fetched on entry.
  // Batch 3A: skip when cache is fresh + realtime up + not waking from background.
  // Batch 3B: fire on `user?.id` (eager) when per-surface flag enabled.
  const eagerInvalidateDm = isChatEagerInvalidateEnabled("dm");
  const invalidateGateDm = eagerInvalidateDm ? !!user?.id : authReady;
  useEffect(() => {
    if (!conversationId || !invalidateGateDm) return;
    const key = ["dm-messages", conversationId];
    if (shouldSkipChatMountInvalidate(queryClient, key, `dm:${conversationId}`)) return;
    let cancelled = false;
    (async () => {
      if (eagerInvalidateDm) await ensureSessionApplied();
      if (cancelled) return;
      queryClient.invalidateQueries({ queryKey: key });
    })();
    return () => { cancelled = true; };
  }, [conversationId, invalidateGateDm, queryClient, eagerInvalidateDm]);

  // Fetch messages with cache support
  const { data: messagesData, isLoading: messagesLoading } = useQuery({
    queryKey: dmQueryKey,
    queryFn: async () => {
      markChatFetch();
      if (useIcpLab && conversationId && user?.id) {
        return { messages: fixtureData.getLocalLabDirectMessages(conversationId, user.id), hasOlderMessages: false, reactions: [], fromCache: true };
      }

      const { data: rawMessages, error } = await supabase
        .from("direct_messages")
        .select("id, text, image_url, created_at, edited_at, author_id, conversation_id, reply_to_id, deleted_at, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("conversation_id", conversationId)
        .is("deleted_at", null) // Only fetch non-deleted messages
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1);
      if (error) throw error;
      
      if (!rawMessages?.length) {
        return { messages: [] as DirectMessage[], hasOlderMessages: false };
      }
      
      const { items: dataToDisplay, hasMore } = splitPageWindow(rawMessages, MESSAGES_PER_PAGE);
      
      const messageIds = dataToDisplay.map((m) => m.id);
      const replyToIds = dataToDisplay.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string);
      const authorIds = [...new Set(dataToDisplay.map((m) => m.author_id))];

      // Preserve cached reactions when the reactions query fails transiently
      const cachedQueryData = queryClient.getQueryData(["dm-messages", conversationId]) as any;
      const cachedDmMessages: DirectMessage[] = Array.isArray(cachedQueryData)
        ? cachedQueryData
        : cachedQueryData?.messages || [];
      const cachedReactionsByMessage = new Map<string, DirectMessage["reactions"]>();
      cachedDmMessages.forEach((cm) => {
        if (cm.reactions?.length) cachedReactionsByMessage.set(cm.id, cm.reactions);
      });

      const [reactionsResult, replyToResult, profilesMap] = await Promise.all([
        supabase
          .from("message_reactions")
          .select("id, user_id, reaction_type, direct_message_id")
          .in("direct_message_id", messageIds),
        replyToIds.length > 0
          ? supabase
              .from("direct_messages")
              .select("id, text, author_id")
              .in("id", replyToIds)
          : Promise.resolve({ data: [] as any[] }),
        fetchProfilesWithCache(authorIds),
      ]);

      if (reactionsResult.error) {
        console.warn("[DM] Failed to fetch reactions, keeping cached reactions", reactionsResult.error);
      }

      const replyToMap = new Map(
        (replyToResult.data || []).map((r: any) => [r.id, {
          ...r,
          author: profilesMap.get(r.author_id) ? { display_name: profilesMap.get(r.author_id)?.display_name } : null,
        }])
      );

      const fetchedMessages = dataToDisplay.map((msg: any) => {
        const replyTo = msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null;
        const profile = profilesMap.get(msg.author_id);
        const msgReactions = reactionsResult.error
          ? cachedReactionsByMessage.get(msg.id) || []
          : (reactionsResult.data || [])
          .filter((r: any) => r.direct_message_id === msg.id)
          .map((r: any) => ({ id: r.id, user_id: r.user_id, reaction_type: r.reaction_type }));
        return {
          ...msg,
          author: profile ? { display_name: profile.display_name, avatar_url: profile.avatar_url } : null,
          reply_to: replyTo,
          reactions: msgReactions,
        };
      }) as DirectMessage[];

      const messages = mergeDirectMessages(fetchedMessages, cachedDmMessages);
      cacheDirectMessages(conversationId!, messages);
      
      return {
        messages,
        hasOlderMessages: hasMore,
      };
    },
    // Gate on `authReady` (user + initialized) — firing before auth is fully
    // restored on notification-tap cold starts caused RLS to return 0 rows,
    // leaving the thread visibly blank until a manual navigation.
    // Session token is sufficient (same as Team/Club/Group) — waiting on the
    // full profile fetch (`authReady`) strands the thread when auth is still
    // settling after an Android resume.
    enabled: !!conversationId && !!user?.id,
    staleTime: 1000 * 60 * 5,
    gcTime: 1000 * 60 * 60 * 24,
    refetchOnMount: "always", // Force refetch on every mount (true is a no-op while staleTime is unmet) so reactions/messages added while away are picked up
    refetchOnWindowFocus: false,
    placeholderData: () => {
      // Return cached messages as placeholder for instant load.
      // 1-item cache = notification preload — using it as placeholder strands
      // a lone message at the top of the viewport. Require >= 2 so the
      // proper loading state is shown until the real fetch lands.
      if (!conversationId) return undefined;
      const messages = getCachedDirectMessages(conversationId);
      if (messages.length < 2) return undefined;

      return { messages, hasOlderMessages: false };
    },
  });

  // Priority refetch when opened from a push notification — the cached snapshot
  // is known-stale, so as soon as auth is ready we kick a fresh fetch (the
  // existing refetchOnMount: 'always' already does this, but invoking it
  // explicitly ensures it runs even if a stale render slipped through and
  // makes the intent explicit alongside the placeholder skip above).
  useEffect(() => {
    if (!openedFromNotificationRef.current) return;
    if (!conversationId || !authReady) return;
    queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
  }, [conversationId, authReady, queryClient]);

  // Belt-and-braces: if the first fetch returned zero messages while auth was
  // still settling (notification-tap cold start), retry once after a short
  // delay. Prevents the "blank thread on push tap" bug even if the gate above
  // is bypassed by a stale render.
  const emptyRetriedRef = useRef(false);
  useEffect(() => {
    if (emptyRetriedRef.current) return;
    if (!conversationId || !authReady) return;
    if (messagesLoading) return;
    if (!messagesData) return;
    const list = Array.isArray(messagesData) ? messagesData : messagesData.messages;
    if (list && list.length === 0) {
      emptyRetriedRef.current = true;
      const t = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
      }, 400);
      return () => clearTimeout(t);
    }
  }, [conversationId, authReady, messagesLoading, messagesData, queryClient]);

  // Scope key for the realtime edit/soft-delete reconciliation registry.
  const reconcileScope = `dm:${conversationId ?? "none"}`;

  const messages = useMemo(() => {
    if (!messagesData) return [];
    const msgList = Array.isArray(messagesData) 
      ? messagesData 
      : (messagesData as any).messages || [];
    const sorted = sortChatMessagesChronologically(msgList);
    // Re-apply realtime edits/soft-deletes so a stale in-flight fetch cannot
    // restore pre-edit text or resurrect a deleted row.
    return (reconcileMessages(reconcileScope, sorted) ?? []) as DirectMessage[];
  }, [messagesData, reconcileScope]);

  // 1-item cache = notification preload; don't seed from it.
  const [localMessages, setLocalMessages] = useState<DirectMessage[] | undefined>(() => {
    if (!conversationId) return undefined;
    const cached = getCachedDirectMessages(conversationId);
    return cached.length >= 2 ? cached : undefined;
  });
  const localMessagesRef = useRef(localMessages);
  localMessagesRef.current = localMessages;
  const [infiniteScrollEnabled, setInfiniteScrollEnabled] = useState(false);
  // Realtime reactions must reach BOTH stores (query cache + localMessages).
  const reactionQueryKey = useMemo(() => ["dm-messages", conversationId], [conversationId]);
  const { applyRealtimeReaction, applyRealtimeReactionDelete } = useRealtimeReactionSync<DirectMessage>({
    scopeKey: reconcileScope,
    // Scope guard: message_reactions realtime events are unfiltered platform-wide.
    getLocalMessages: () => localMessagesRef.current,
    queryKey: reactionQueryKey,
    setLocalMessages,
  });
  const hasMeaningfulLocal = (localMessages?.length ?? 0) >= 2;
  const showLoading =
    (!authReady && !hasMeaningfulLocal) ||
    (messagesLoading && !messagesData && !hasMeaningfulLocal);

  // Android resume escape hatch: abort zombie GETs + re-issue the gating
  // queries while the page is stuck on a skeleton.
  useChatStuckWatchdog(
    (!!conversationId && (conversationLoading || checkingCanDM || showLoading)),
    [
      ["dm-conversation", conversationId],
      ["can-dm", otherUserId],
      ["dm-messages", conversationId],
    ],
    "dm-chat",
  );


  // Cold-start stage marks (chat_mount + chat_query_return).
  useChatPerfMarks(messagesData);

  // Log notification-tap → first-message-render latency once per mount.
  useEffect(() => {
    if (perfLoggedRef.current) return;
    if (!conversationId || !user?.id) return;
    if (showLoading) return;
    if (!localMessages || localMessages.length === 0) return;
    perfLoggedRef.current = true;
    const tapTs = openedFromNotificationRef.current;
    void logChatOpenLatency({
      kind: "dm",
      targetId: conversationId,
      source: tapTs ? "notification" : "cold_open",
      startTs: tapTs ?? mountTsRef.current,
      messageCount: localMessages.length,
      fromCache: !messagesData,
      userId: user.id,
    });
  }, [conversationId, user?.id, showLoading, localMessages, messagesData]);

  // Reply/edit composer growth re-pin is handled inside ChatMessagesScroller
  // via the Virtuoso handle (see virtualHandleRef path). No-op here.
  
  // Use fresh profile data that refreshes on visibility change (fixes names vanishing after phone lock)
  const authorIds = useMemo(() => {
    return [...new Set((localMessages || []).map(m => m.author_id).filter(Boolean))];
  }, [localMessages]);
  const { getProfile } = useProfiles(authorIds);

  // Read tracking for DMs
  const messageIds = useMemo(() => (localMessages || []).map(m => m.id).filter(id => !id.startsWith("temp-")), [localMessages]);
  const { readCounts, readFrontier, markMessagesAsRead } = useMessageReads("dm", conversationId || "", messageIds, user?.id);

  useMarkVisibleChatMessagesRead({
    messages: localMessages,
    userId: user?.id,
    markMessagesAsRead,
    deduplicate: false,
  });
  useEffect(() => {
    // Only reset from cache if the query hasn't already returned fresh data.
    // This prevents stale cache (missing reactions etc.) from overwriting
    // fresher query results that were merged by the useLayoutEffect above.
    if (!messagesData) {
      setLocalMessages(
        conversationId
          ? ((reconcileMessages(reconcileScope, getCachedDirectMessages(conversationId)) ?? []) as DirectMessage[])
          : undefined,
      );
    }
    setInfiniteScrollEnabled(false);

    return () => {
      // Tombstones/patches are per-thread; drop them when leaving the thread.
      clearReconciliationScope(`dm:${conversationId ?? "none"}`);
    };
  }, [conversationId, messagesData, reconcileScope]);

  const isPinned = true;
  useEffect(() => {
    setInfiniteScrollEnabled(true);
  }, [conversationId]);
 
  const [isManualRefreshing, setIsManualRefreshing] = useState(false);
  
  const handleRefresh = useCallback(async () => {
    await queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
  }, [queryClient, conversationId]);

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
    if (!messages || !conversationId || (messages.length === 0 && localMessages && localMessages.length > 0)) return;

    setLocalMessages((prev) => {
      if (messages.length === 0 && messagesLoading) return prev;

      const prevLen = prev?.length ?? 0;
      const previousLastId = prev?.[prevLen - 1]?.id ?? null;
      const mergedMessages = mergeDirectMessages(messages, prev, reconcileScope);
      const nextLastId = mergedMessages[mergedMessages.length - 1]?.id ?? null;

      cacheDirectMessages(conversationId, mergedMessages);

      // Only tail appends should preserve bottom. Older-message prepends also
      // increase length, but must never yank a user reading history back down.
      if (mergedMessages.length > prevLen && nextLastId !== previousLastId) {
        requestAnimationFrame(() => {
          const handle = virtualHandleRef.current;
          if (handle?.isNearBottom(240)) handle.scrollToBottom("auto");
        });
      }

      return mergedMessages;
    });
  }, [messages, messagesLoading, conversationId, reconcileScope]);

  useEffect(() => {
    if (messagesData && !Array.isArray(messagesData)) {
      setHasOlderMessages((messagesData as any).hasOlderMessages ?? false);
    }
  }, [messagesData]);

  // Load older DM messages — mirrors the Team/Club pattern so deep-linked
  // search jumps and scroll-to-top can page beyond the initial 15-message
  // window. Virtuoso owns scroll-anchoring on prepend (firstItemIndex +
  // followOutput); we just commit the cache mutation.
  const loadOlderMessages = useCallback(async () => {
    const currentMessages = localMessagesRef.current;
    if (!currentMessages?.length || isLoadingOlder || !hasOlderMessages || !conversationId) return;

    setIsLoadingOlder(true);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);

    try {
      const oldestMessage = currentMessages[0];

      const { data: olderRaw, error } = await supabase
        .from("direct_messages")
        .select("id, text, image_url, created_at, edited_at, author_id, conversation_id, reply_to_id, deleted_at, forwarded_from_user_id, forwarded_at, forwarded_source_label")
        .eq("conversation_id", conversationId)
        .is("deleted_at", null)
        .lt("created_at", oldestMessage.created_at)
        .order("created_at", { ascending: false })
        .limit(MESSAGES_PER_PAGE + 1)
        .abortSignal(controller.signal);

      clearTimeout(timeoutId);
      if (error) throw error;
      if (!olderRaw?.length) {
        setHasOlderMessages(false);
        return;
      }

      const { items: dataToUse, hasMore } = splitPageWindow(olderRaw, MESSAGES_PER_PAGE);
      setHasOlderMessages(hasMore);
      const reversedOlder = [...dataToUse].reverse();
      const messageIds = reversedOlder.map((m) => m.id);
      const replyToIds = reversedOlder.filter((m) => m.reply_to_id).map((m) => m.reply_to_id as string);
      const authorIds = [...new Set(reversedOlder.map((m) => m.author_id))];

      let reactionsData: any[] = [];
      let replyToData: any[] = [];
      let profilesMap = new Map<string, { display_name: string | null; avatar_url: string | null }>();

      try {
        const secondaryController = new AbortController();
        const secondaryTimeout = setTimeout(() => secondaryController.abort(), 5000);
        const [reactionsResult, replyToResult, cachedProfiles] = await Promise.all([
          supabase
            .from("message_reactions")
            .select("id, user_id, reaction_type, direct_message_id")
            .in("direct_message_id", messageIds)
            .abortSignal(secondaryController.signal),
          replyToIds.length > 0
            ? supabase
                .from("direct_messages")
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

      const replyToMap = new Map(
        replyToData.map((r: any) => [r.id, {
          ...r,
          author: profilesMap.get(r.author_id)
            ? { display_name: profilesMap.get(r.author_id)?.display_name }
            : null,
        }]),
      );

      const olderMessages: DirectMessage[] = reversedOlder.map((msg: any) => {
        const profile = profilesMap.get(msg.author_id);
        return {
          ...msg,
          author: profile
            ? { display_name: profile.display_name, avatar_url: profile.avatar_url }
            : null,
          reply_to: msg.reply_to_id ? replyToMap.get(msg.reply_to_id) || null : null,
          reactions: reactionsData
            .filter((r) => r.direct_message_id === msg.id)
            .map((r) => ({ id: r.id, user_id: r.user_id, reaction_type: r.reaction_type })),
        };
      });

      const reconciledOlder = (reconcileMessages(reconcileScope, olderMessages) ?? []) as DirectMessage[];

      queryClient.setQueryData(
        dmQueryKey,
        (old: { messages: DirectMessage[]; hasOlderMessages: boolean } | undefined) => {
          const existing = old?.messages || [];
          const merged = [...reconciledOlder, ...existing];
          cacheDirectMessages(conversationId, merged);
          return { ...(old || {}), messages: merged, hasOlderMessages: hasMore };
        },
      );
    } catch (err) {
      clearTimeout(timeoutId);
      console.error("[DM] Failed to load older messages:", err);
    } finally {
      setIsLoadingOlder(false);
    }
  }, [conversationId, isLoadingOlder, hasOlderMessages, queryClient, dmQueryKey, reconcileScope]);

  useEffect(() => {
    loadOlderMessagesRef.current = loadOlderMessages;
  }, [loadOlderMessages]);


  useEffect(() => {
    if (!conversationId || !authReady || messagesLoading) return;

    const fetchedCount = messages?.length ?? 0;
    if (shouldRefetchMessages("dm", conversationId, fetchedCount)) {
      console.log("[DirectMessage] Messages unexpectedly 0, triggering refetch");
      queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
    }
  }, [conversationId, authReady, messages, messagesLoading, queryClient]);

  // Visibility change handler - refetch messages and profiles when app becomes visible (e.g., phone unlock)
  useEffect(() => {
    let lastRefresh = Date.now();
    
    const handleVisibilityChange = async () => {
      if (document.visibilityState === "visible" && conversationId && authReady) {
        const timeSinceLastRefresh = Date.now() - lastRefresh;
        // Only refresh if it's been more than 30 seconds
        if (timeSinceLastRefresh > 30000) {
          console.log("[DirectMessage] App became visible, refreshing messages");
          lastRefresh = Date.now();
          await queryClient.invalidateQueries({ queryKey: ["dm-messages", conversationId] });
        }
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [conversationId, authReady, queryClient]);

  // Send message mutation
  const sendMessageMutation = useMutation({
    mutationFn: async ({ text, imageUrl, replyToId }: { text: string; imageUrl?: string | null; replyToId?: string | null }) => {
      // Offline path: queue the message instead of failing
      if (!navigator.onLine) {
        const queued = queueMessage({
          type: "dm",
          targetId: conversationId!,
          authorId: user!.id,
          text,
          imageUrl: imageUrl || null,
          replyToId: replyToId || null,
          createdAt: new Date().toISOString(),
        });
        return {
          id: queued.id,
          text,
          image_url: imageUrl || null,
          conversation_id: conversationId!,
          author_id: user!.id,
          reply_to_id: replyToId || null,
          created_at: queued.createdAt,
          __queued: true,
        } as any;
      }
      const { data, error } = await supabase
        .from("direct_messages")
        .insert({
          conversation_id: conversationId!,
          author_id: user!.id,
          text,
          image_url: imageUrl || null,
          reply_to_id: replyToId || null, // Ensure empty string becomes null for UUID column
        })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onMutate: async ({ text, imageUrl, replyToId }) => {
      // Mutation-specific temp id so overlapping sends roll back independently.
      const tempId = createSendTempId();
      const sentAtMs = Date.now();
      const previousReplyTo = replyTo;
      const optimisticMessage: DirectMessage = {
        id: tempId,
        text,
        image_url: imageUrl || null,
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
      setTimeout(scrollToBottom, 50);

      return {
        tempId,
        sentText: text,
        sentImageUrl: imageUrl || null,
        previousReplyTarget: previousReplyTo,
        pendingPollId: null,
        sentAtMs,
      } satisfies FailedSendContext<typeof previousReplyTo>;
    },

    onSuccess: async (newMessage) => {
      const currentReplyTo = replyToRef.current;
      
      // Update the query cache with the new message to replace optimistic one
      queryClient.setQueryData(
        ["dm-messages", conversationId],
        (oldData: { messages: DirectMessage[]; hasOlderMessages: boolean } | undefined) => {
          if (!oldData) {
            const msg: DirectMessage = {
              ...newMessage,
              author: {
                display_name: profileRef.current?.display_name || null,
                avatar_url: profileRef.current?.avatar_url || null,
              },
              reactions: [],
              reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
            };
            return { messages: [msg], hasOlderMessages: false };
          }
          
          // Replace optimistic message with real one
          const updatedMessages = dropSupersededOptimisticRow(oldData.messages, newMessage)
            .concat({
              ...newMessage,
              author: {
                display_name: profileRef.current?.display_name || null,
                avatar_url: profileRef.current?.avatar_url || null,
              },
              reactions: [],
              reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
            });
          
          return { ...oldData, messages: updatedMessages };
        }
      );
      
      // Also update the local message cache for offline/fast reload
      const currentMessages = localMessagesRef.current || [];
      const realMessages = dropSupersededOptimisticRow(currentMessages, newMessage)
        .concat({
          ...newMessage,
          author: {
            display_name: profileRef.current?.display_name || null,
            avatar_url: profileRef.current?.avatar_url || null,
          },
          reactions: [],
          reply_to: currentReplyTo ? { text: currentReplyTo.text, author: currentReplyTo.author } : null,
        });
      
      cacheDirectMessages(conversationId!, realMessages);
      
      // Unhide conversation if it was hidden (so it reappears for both users)
      await supabase
        .from("hidden_dm_conversations")
        .delete()
        .eq("conversation_id", conversationId!);
      
      // Invalidate other related queries
      queryClient.invalidateQueries({ queryKey: ["dm-conversations"] });
      queryClient.invalidateQueries({ queryKey: ["hidden-dm-conversations"] });
      
      // Push notification is handled by the DB trigger on notifications table.
      // Do NOT invoke send-push-notification directly here — it causes duplicate pushes
      // because the trigger and direct call use different notificationIds for dedup.
    },
    onError: (error, variables, context) => {
      console.error('[DM] Send message error:', error, 'Message text:', variables.text?.slice(0, 20));
      // Offline sends are queued, not failed.
      if (typeof navigator !== "undefined" && navigator.onLine === false) return;

      // Check if the message actually arrived via realtime before showing error
      const currentData = queryClient.getQueryData<{ messages: DirectMessage[] }>(["dm-messages", conversationId]);
      const messageExists =
        authoritativeMessageExists(currentData?.messages, { authorId: user?.id, text: variables.text, imageUrl: variables.imageUrl || null, replyToId: variables.replyToId || null, sentAtMs: context?.sentAtMs }) ||
        authoritativeMessageExists(localMessagesRef.current, { authorId: user?.id, text: variables.text, imageUrl: variables.imageUrl || null, replyToId: variables.replyToId || null, sentAtMs: context?.sentAtMs });
      if (!messageExists) {
        toast.error("Failed to send message. Please try again.");
        // Remove ONLY this mutation's optimistic row.
        if (context?.tempId) {
          setLocalMessages((prev) => (prev ? prev.filter((m) => m.id !== context.tempId) : prev));
          queryClient.setQueryData(["dm-messages", conversationId], (old: any) => {
            if (!old) return old;
            return { ...old, messages: (old.messages || []).filter((m: DirectMessage) => m.id !== context.tempId) };
          });
        }
        restoreFailedSendComposer({
          context,
          setText: setMessage,
          setImage: setDmImageUrl,
          setReply: setReplyTo,
        });
      }

    },
  });
  const updateMessageMutation = useMutation({
    mutationFn: async () => {
      if (!editingMessage) return;
      const { error } = await supabase.from("direct_messages").update({ text: message.trim() }).eq("id", editingMessage.id);
      if (error) throw error;
    },
    onSuccess: () => {
      setMessage("");
      setEditingMessage(null);
      queryClient.invalidateQueries({ queryKey: dmQueryKey });
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
    `dm-${conversationId || ""}`,
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

    if (!message.trim() && !dmImageUrl && !pendingNewsId) return;
    if (editingMessage) {
      updateMessageMutation.mutate();
      return;
    }
    // Allow sending if canDM is true OR if we're still checking (give benefit of doubt for existing conversations)
    // The server-side RLS will still enforce the actual permission
    if (canDM === false && !checkingCanDM) {
      toast.error("DMs require both users to be members of a Pro club");
      return;
    }
    stopTyping();
    const baseText = message.trim();
    const finalText = pendingNewsId
      ? (baseText ? `${baseText} [news:${pendingNewsId}]` : `[news:${pendingNewsId}]`)
      : baseText;
    sendMessageMutation.mutate({
      text: finalText,
      imageUrl: dmImageUrl,
      replyToId: replyTo?.id || null,
    });
    setMessage("");
    setDmImageUrl(null);
    setReplyTo(null);
    setPendingNewsId(null);
  };


  // Real-time subscription for messages, deletions, edits, and reactions
  useEffect(() => {
    if (!conversationId) return;

    const channel = supabase
      .channel(`dm-${conversationId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "direct_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const newMsg = payload.new as any;
          const currentMessages = queryClient.getQueryData<{ messages: DirectMessage[] }>(["dm-messages", conversationId])?.messages;
          const localReplyMessage = findLocalReplyMessage(currentMessages, newMsg.reply_to_id);
          const localReply = localReplyMessage
            ? { text: localReplyMessage.text, author: localReplyMessage.author }
            : null;
          // Skip if it's our own optimistic message already in cache
          queryClient.setQueryData(
            ["dm-messages", conversationId],
            (old: { messages: DirectMessage[]; hasOlderMessages: boolean } | undefined) => {
              if (!old) return old;
              if (old.messages.some(m => m.id === newMsg.id)) return old;
              // Remove any temp message from same author
              const filtered = dropSupersededOptimisticRow(old.messages, newMsg);
              const messageToAdd: DirectMessage = {
                ...newMsg,
                author: null,
                reactions: [],
                reply_to: localReply,
              };
              return {
                ...old,
                messages: sortChatMessagesChronologically([...filtered, messageToAdd]),
              };
            }
          );
          // Fetch profile and reply data async
          const fetchExtra = async () => {
            const [profileResult, replyResult] = await Promise.all([
              selectCachedProfileById(newMsg.author_id),
              newMsg.reply_to_id && !localReplyMessage
                ? supabase.from("direct_messages").select("text, author_id").eq("id", newMsg.reply_to_id).maybeSingle()
                : Promise.resolve({ data: null }),
            ]);
            let replyAuthor = null;
            if (replyResult.data?.author_id) {
              const { data: rp } = await selectCachedProfileById(replyResult.data.author_id);
              replyAuthor = rp;
            }
            queryClient.setQueryData(
              ["dm-messages", conversationId],
              (old: { messages: DirectMessage[]; hasOlderMessages: boolean } | undefined) => {
                if (!old) return old;
                return {
                  ...old,
                  messages: old.messages.map(m => {
                    if (m.id !== newMsg.id) return m;
                    return {
                      ...m,
                      author: profileResult.data
                        ? { display_name: profileResult.data.display_name, avatar_url: profileResult.data.avatar_url }
                        : m.author,
                      reply_to: replyResult.data
                        ? { text: replyResult.data.text, author: replyAuthor ? { display_name: replyAuthor.display_name } : null }
                        : m.reply_to,
                    };
                  }),
                };
              }
            );
          };
          fetchExtra();
        }
      )
      .on(
        "postgres_changes",
        {
          event: "DELETE",
          schema: "public",
          table: "direct_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const deletedId = (payload.old as any)?.id;
          if (!deletedId) return;
          // Tombstone so an older in-flight fetch cannot resurrect the row.
          recordRealtimeMutation(reconcileScope, { id: deletedId, deleted_at: new Date().toISOString() });
          queryClient.setQueryData(
            ["dm-messages", conversationId],
            (old: { messages: DirectMessage[]; hasOlderMessages: boolean } | undefined) => {
              if (!old) return old;
              return { ...old, messages: removeMessage(old.messages, deletedId) };
            }
          );
          setLocalMessages((prev) => (prev ? removeMessage(prev, deletedId) : prev));
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "direct_messages",
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const updated = payload.new as any;
          if (!updated?.id) return;
          // Record first so any query response already in flight is reconciled
          // when it lands (stale-fetch resurrection guard). Idempotent.
          const outcome = recordRealtimeMutation(reconcileScope, updated);

          if (outcome === "deleted") {
            queryClient.setQueryData(
              ["dm-messages", conversationId],
              (old: { messages: DirectMessage[]; hasOlderMessages: boolean } | undefined) =>
                old ? { ...old, messages: removeMessage(old.messages, updated.id) } : old,
            );
            setLocalMessages((prev) => (prev ? removeMessage(prev, updated.id) : prev));
            return;
          }

          // Apply the edit to BOTH stores with the same pure helper so they
          // can never diverge. Fields absent from the payload are preserved.
          queryClient.setQueryData(
            ["dm-messages", conversationId],
            (old: { messages: DirectMessage[]; hasOlderMessages: boolean } | undefined) =>
              old ? { ...old, messages: applyMessageUpdate(old.messages, updated) } : old,
          );
          setLocalMessages((prev) => (prev ? applyMessageUpdate(prev, updated) : prev));
        }
      )
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "message_reactions" },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction?.direct_message_id || !reaction.id) return;
          applyRealtimeReaction(reaction.direct_message_id, reaction);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "message_reactions" },
        (payload) => {
          const reaction = payload.new as any;
          if (!reaction?.direct_message_id || !reaction.id) return;
          applyRealtimeReaction(reaction.direct_message_id, reaction);
        }
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "message_reactions" },
        (payload) => {
          const deleted = payload.old as any;
          if (!deleted?.id) return;
          applyRealtimeReactionDelete(deleted.direct_message_id ?? null, deleted.id);
        }
      );
    return startChatRealtimeChannel({
      channel,
      channelKey: `dm-${conversationId}`,
      userId: user?.id,
      scope: { kind: "dm", id: conversationId },
    });
  }, [conversationId, queryClient, user?.id, reconcileScope, applyRealtimeReaction, applyRealtimeReactionDelete]);

  const { isSearching: isSearchFetching, canShowEmpty: searchCanShowEmpty } = useChatHistorySearch<DirectMessage>({
    searchQuery,
    loadedMessages: localMessages,
    setMessages: (updater) => setLocalMessages((prev) => updater(prev)),
    enabled: !!conversationId,
    cacheKey: `dm:${conversationId ?? ""}`,
    fetcher: async (q, signal) =>
      createChatHistorySearchFetcher<DirectMessage>({
        scope: DIRECT_CHAT_SCOPE,
        scopeId: conversationId,
        selectColumns: "id, text, image_url, created_at, edited_at, author_id, conversation_id, reply_to_id",
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

  if (conversationLoading || checkingCanDM) {
    return <ChatPageSkeleton />;
  }

  if (!conversation) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] gap-4">
        <p className="text-muted-foreground">Conversation not found</p>
        <Button onClick={() => navigate("/messages")}>Go to Messages</Button>
      </div>
    );
  }

  // Access denied for non-Pro users
  if (canDM === false) {
    return (
      <div className="py-6 space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="icon" onClick={() => navigate("/messages")}>
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <div className="flex items-center gap-3">
            <Avatar className="h-10 w-10">
              <AvatarImage src={otherUser?.avatar_url || undefined} />
              <AvatarFallback>{otherUser?.display_name?.charAt(0).toUpperCase() || "?"}</AvatarFallback>
            </Avatar>
            <div>
              <h1 className="font-semibold">{otherUser?.display_name || (otherUserLoading ? "…" : "Unknown User")}</h1>
            </div>
          </div>
        </div>

        <Card className="border-primary/20 bg-primary/5">
          <CardContent className="flex flex-col items-center justify-center py-12 text-center gap-4">
            <div className="p-4 rounded-full bg-primary/10">
              <Lock className="h-8 w-8 text-primary" />
            </div>
            <div>
              <h3 className="font-semibold text-lg flex items-center justify-center gap-2">
                <Crown className="h-5 w-5 text-primary" />
                Pro Feature
              </h3>
              <p className="text-muted-foreground mt-1 max-w-md">
                Direct messages require both users to be members of a Pro club. 
                Upgrade your club to Pro to unlock this feature.
              </p>
            </div>
            <Button onClick={() => navigate("/messages")}>Back to Messages</Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="flex min-h-0 flex-col overflow-hidden overscroll-none" data-lock-keyboard-scroll="true" style={{ height: chatHeight }} onTouchStart={swipeBack.onTouchStart} onTouchEnd={swipeBack.onTouchEnd}>
      {/* Header */}
      <ChatHeaderShell
        type={isIgniteSupportConversation ? "support" : "dm"}
        name={isIgniteSupportConversation ? "Ignite Support" : (otherUser?.display_name || (otherUserLoading ? "…" : "Unknown User"))}
        sublabel={isIgniteSupportConversation ? "Welcome & tips" : undefined}
        avatarUrl={isIgniteSupportConversation ? undefined : otherUser?.avatar_url}
        showOnlineDot={!isIgniteSupportConversation && isOtherUserOnline}
        onOpenDetails={() => setDetailsOpen(true)}
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
              scheduleMessageLocked={!scheduleProLoading && !hasSchedulePro}
              onSummarizeMessages={(!scheduleProLoading && hasSchedulePro && !aiCatchUpDisabled) ? () => summarizeTriggerRef.current?.() : undefined}
            />
          </>
        }
      />

      <ChatCatchUp
        scope_type="direct"
        scope_id={conversationId}
        unreadCount={dmUnreadCount}
        latestMessageId={filteredMessages?.[filteredMessages.length - 1]?.id ?? null}
        proLocked={!scheduleProLoading && !hasSchedulePro}
        upgradeHref={sharedClubId ? `/clubs/${sharedClubId}/upgrade` : undefined}
        registerTrigger={(fn) => { summarizeTriggerRef.current = fn; }}
      />

      <ChatDetailsSheet
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        chatType={isIgniteSupportConversation ? "support" : "dm"}
        chatId={conversationId!}
        name={isIgniteSupportConversation ? "Ignite Support" : (otherUser?.display_name || (otherUserLoading ? "…" : "Unknown User"))}
        sublabel={isIgniteSupportConversation ? "Welcome & tips" : undefined}
        avatarUrl={isIgniteSupportConversation ? undefined : otherUser?.avatar_url}
        otherUserId={otherUserId || undefined}
      />

      {/* Notification Nudge */}
      {notificationNudge.shouldShowNudge && (
        <div className="px-4 pt-2 shrink-0">
          <NotificationNudgeBanner
            message="Enable notifications so you never miss direct messages"
            onDismiss={notificationNudge.dismiss}
            userId={user?.id}
          />
        </div>
      )}

      {/* Pinned messages banner */}
      {!isIgniteSupportConversation && (
        <PinnedMessagesBanner
          pins={pinnedMessages}
          onJumpToMessage={handleJumpToPinned}
          onUnpin={unpinMessage}
        />
      )}

      {/* Messages area */}
      <div className="flex-1 min-h-0 flex flex-col relative overflow-hidden overscroll-none">
        {showLoading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : (isSearchFetching || (!!searchQuery && !searchCanShowEmpty)) ? (
          <ChatSearchLoadingState />
        ) : filteredMessages?.length === 0 ? (
          <ChatEmptyState title={`Start a conversation with ${otherUser?.display_name || "this user"}`} />
        ) : (
          <ChatMessagesScroller
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
            renderRow={(msg, index, arr) => {
              const prevMessage = index > 0 ? arr[index - 1] : null;
              const nextMessage = index < arr.length - 1 ? arr[index + 1] : null;
              const showDateSeparator = index === 0 ||
                !isSameDay(new Date(msg.created_at), new Date(prevMessage?.created_at));
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
                      authorName={isIgniteSupportUser(msg.author_id) ? "Ignite Support" : (getProfile(msg.author_id)?.display_name || msg.author?.display_name || null)}
                      authorAvatar={getProfile(msg.author_id)?.avatar_url || msg.author?.avatar_url || null}
                      timestamp={format(new Date(msg.created_at), "h:mm a")}
                      isOwn={msg.author_id === user?.id}
                      isAdmin={false}
                      reactions={msg.reactions || []}
                      currentUserId={user?.id}
                      messageType="dm"
                      searchQuery={searchQuery}
                      readFrontierReaders={readFrontier[msg.id] || []}
                      readCount={readCounts[msg.id] || 0}
                      readerName={msg.author_id === user?.id ? (otherUser?.display_name || null) : null}
                      isLastMessage={index === arr.length - 1}
                      isLastOwnMessage={msg.author_id === user?.id && !arr.slice(index + 1).some((m: any) => m.author_id === user?.id)}
                      queryKey={dmQueryKey}
                      contextId={conversationId || ""}
                      replyToMessage={
                        msg.reply_to
                          ? { text: msg.reply_to.text, authorName: msg.reply_to.author?.display_name || null }
                          : null
                      }
                      hasReply={!!msg.reply_to_id}
                      isEdited={!!(msg as any).edited_at}
                      onReply={isIgniteSupportConversation ? undefined : () => { setReplyTo(msg); setTimeout(() => virtualHandleRef.current?.scrollToBottom("auto"), 100); }}
                      onEdit={handleEdit}
                      isPinned={pinnedMessageIds.has(msg.id)}
                      canPin={!isIgniteSupportConversation && !msg.id.startsWith("queued-")}
                      pinLimitReached={!canPinMore && !pinnedMessageIds.has(msg.id)}
                      onPin={isIgniteSupportConversation ? undefined : pinMessage}
                      onUnpin={isIgniteSupportConversation ? undefined : unpinMessage}
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

      <DirectMessageComposerFooter
        composerRef={composerRef}
        searchOpen={searchOpen}
        nativeKbHeight={nativeKbHeight}
        isIgniteSupportConversation={isIgniteSupportConversation}
        attachmentsDisabled={!!attachmentsDisabled}
        typingUsers={typingUsers}
        replyTo={
          replyTo
            ? { id: replyTo.id, text: replyTo.text, authorName: replyTo.author?.display_name || null }
            : null
        }
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
        pendingNewsId={pendingNewsId}
        onPendingNewsIdChange={setPendingNewsId}
        isSending={sendMessageMutation.isPending}
        imageUrl={dmImageUrl}
        onImageUploaded={setDmImageUrl}
        message={message}
        onMessageChange={setMessage}
        onStartTyping={startTyping}
        onStopTyping={stopTyping}
        onKeyPress={(e) => e.key === "Enter" && !e.shiftKey && handleSend()}
        onSend={handleSend}
        sharedClubId={sharedClubId}
        otherUserId={otherUserId || undefined}
        eventPickerOpen={eventPickerOpen}
        onEventPickerOpenChange={setEventPickerOpen}
        newsPickerOpen={newsPickerOpen}
        onNewsPickerOpenChange={setNewsPickerOpen}
        boardPickerOpen={boardPickerOpen}
        onBoardPickerOpenChange={setBoardPickerOpen}
      />
    </div>
  );
}
