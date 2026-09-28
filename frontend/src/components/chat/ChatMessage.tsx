import { useState, useRef, useEffect, useCallback, memo } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Clock, Megaphone, ImagePlus, Check, Loader2, Forward } from "lucide-react";
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
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarFallbackStyle, getAvatarInitial } from "@/lib/avatarColor";
import { supabase } from "@/integrations/supabase/client";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";
import { ensureFreshSession, isAuthLikeError } from "@/lib/ensureFreshSession";
import { removeMessageFromCache } from "@/lib/messageCache";
import { MessageContent } from "./MessageContent";
import { FullscreenImageViewer } from "./FullscreenImageViewer";
import { MessageReactionsPopover, MessageReactionsDisplay } from "./MessageReactions";
import { ReplyIndicator } from "./ReplyPreview";
import { MessageReadAvatars } from "./MessageReadAvatars";
import { MessageReadIndicator } from "./MessageReadIndicator";
import { ReadReceiptSheet } from "./ReadReceiptSheet";
import type { ReaderInfo } from "@/hooks/useMessageReads";
import { useLongPressDismissGuard } from "@/hooks/useLongPressDismissGuard";
import { hapticImpactLight } from "@/lib/haptics";
import { toast } from "sonner";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { ReportMessageDialog } from "@/components/chat/ReportMessageDialog";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { ForwardMessageSheet } from "@/components/chat/ForwardMessageSheet";
import { useSwipeToReply } from "@/hooks/useSwipeToReply";
import { isMembershipSystemText } from "@/lib/systemMessagePatterns";
import { InlineRsvpActions } from "@/components/chat/InlineRsvpActions";
import { observeChatElementHeight } from "@/lib/chatScrollActivity";
import { markLongPressOnboardingCompleted, claimFirstBubbleHint } from "@/hooks/useChatActionsOnboarding";
import { scrollMessageIntoLowerThird } from "@/lib/scrollMessageIntoLowerThird";


interface Reaction {
  id: string;
  user_id: string;
  reaction_type: string;
}

interface ReplyToMessage {
  text: string;
  authorName: string | null;
}

export interface ChatMessageProps {
  id: string;
  text: string;
  imageUrl?: string | null;
  authorId: string;
  authorName?: string | null;
  authorAvatar?: string | null;
  timestamp: string;
  isOwn: boolean;
  isAdmin?: boolean;
  reactions?: Reaction[];
  currentUserId?: string;
  messageType: "team" | "club" | "broadcast" | "group" | "dm" | "club_admin";
  queryKey: string[];
  replyToMessage?: ReplyToMessage | null;
  hasReply?: boolean;
  onReply?: (message: { id: string; text: string; authorName: string | null }) => void;
  onEdit?: (message: { id: string; text: string }) => void;
  onAuthorClick?: () => void;
  searchQuery?: string;
  readFrontierReaders?: ReaderInfo[];
  readCount?: number;
  readerName?: string | null;
  isLastMessage?: boolean;
  /** True when this is the current user's most recent own message in the
   *  thread. Drives the "Sent / Seen by …" read-receipt frontier so it
   *  follows the sender's tail even after replies arrive. */
  isLastOwnMessage?: boolean;
  isPending?: boolean;
  /** True when the message text was edited after sending. */
  isEdited?: boolean;
  isSystemMessage?: boolean;
  isClubAnnouncement?: boolean;
  contextId?: string;
  // Pin support
  isPinned?: boolean;
  canPin?: boolean;
  pinLimitReached?: boolean;
  onPin?: (messageId: string) => void;
  onUnpin?: (messageId: string) => void;
  // Publish-to-gallery support (team chat). Parent handles the actual upload.
  canPublishToGallery?: boolean;
  isPublishedToGallery?: boolean;
  isPublishingToGallery?: boolean;
  onPublishToGallery?: (messageId: string, imageUrl: string) => void;
  /** True when the previous message is from the same author within the
   *  grouping window — drop avatar/name and flatten the top corner. */
  groupedWithPrev?: boolean;
  /** True when the next message is from the same author within the
   *  grouping window — flatten the bottom corner and hide the per-bubble
   *  timestamp / read-receipt strip until the last message in the group. */
  groupedWithNext?: boolean;
  /** Forward attribution — when set, renders a "↪ Forwarded from X · Label" banner above the bubble. */
  forwardedFromUserId?: string | null;
  forwardedFromName?: string | null;
  forwardedSourceLabel?: string | null;
}

function ChatMessageInner({
  id,
  text,
  imageUrl,
  authorId,
  authorName,
  authorAvatar,
  timestamp,
  isOwn,
  isAdmin = false,
  reactions = [],
  currentUserId,
  messageType,
  queryKey,
  replyToMessage,
  hasReply = false,
  onReply,
  onEdit,
  onAuthorClick,
  searchQuery,
  readFrontierReaders = [],
  readCount = 0,
  readerName,
  isLastMessage = false,
  isLastOwnMessage = false,
  isPending = false,
  isEdited = false,
  isSystemMessage = false,
  isClubAnnouncement = false,
  contextId,
  isPinned = false,
  canPin = false,
  pinLimitReached = false,
  onPin,
  onUnpin,
  canPublishToGallery = false,
  isPublishedToGallery = false,
  isPublishingToGallery = false,
  onPublishToGallery,
  groupedWithPrev = false,
  groupedWithNext = false,
  forwardedFromUserId,
  forwardedFromName,
  forwardedSourceLabel,
}: ChatMessageProps) {
  const navigate = useNavigate();
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showReadReceipts, setShowReadReceipts] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFullscreenImage, setShowFullscreenImage] = useState(false);
  const [showForwardSheet, setShowForwardSheet] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);
  const [showTapHint, setShowTapHint] = useState(false);
  const tapHintTimer = useRef<NodeJS.Timeout | null>(null);
  const [optimisticReactions, setOptimisticReactions] = useState<Reaction[]>(reactions);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const longPressTriggeredRef = useRef(false);
  const gestureModeRef = useRef<"idle" | "press" | "swipe">("idle");
  const optimisticReactionsRef = useRef<Reaction[]>(reactions);
  const isReactionMutatingRef = useRef(false);
  const queryClient = useQueryClient();
  const useIcpLab = resolveLocalAuthMode(typeof window !== 'undefined' ? window.location.search : '', true);
  const { isBlocked } = useBlockedUsers();
  const {
    armDismissGuard,
    clearDismissGuard,
    consumeContextMenuGuard,
    preventIfGuarded,
  } = useLongPressDismissGuard();

  const setLocalReactions = useCallback((updater: Reaction[] | ((prev: Reaction[]) => Reaction[])) => {
    setOptimisticReactions((prev) => {
      const next = typeof updater === "function"
        ? (updater as (prev: Reaction[]) => Reaction[])(prev)
        : updater;
      optimisticReactionsRef.current = next;
      return next;
    });
  }, []);

  useEffect(() => {
    if (isReactionMutatingRef.current) return;
    optimisticReactionsRef.current = reactions;
    setOptimisticReactions(reactions);
  }, [reactions]);

 useEffect(() => observeChatElementHeight(rowRef.current), []);

  // One-time, auto-fading caption beneath the first message bubble the user
  // sees, to surface the long-press gesture without a global banner.
  useEffect(() => {
    if (isSystemMessage) return;
    if (claimFirstBubbleHint()) {
      setShowTapHint(true);
      if (tapHintTimer.current) clearTimeout(tapHintTimer.current);
      tapHintTimer.current = setTimeout(() => setShowTapHint(false), 4000);
    }
  }, [isSystemMessage]);


  const getMessageIdField = () => {
    switch (messageType) {
      case "team": return "team_message_id";
      case "club": return "club_message_id";
      case "broadcast": return "broadcast_message_id";
      case "group": return "group_message_id";
      case "dm": return "direct_message_id";
      case "club_admin": return "club_admin_message_id";
    }
  };

  const getTableName = () => {
    switch (messageType) {
      case "team": return "team_messages";
      case "club": return "club_messages";
      case "broadcast": return "broadcast_messages";
      case "group": return "group_messages";
      case "dm": return "direct_messages";
      case "club_admin": return "club_admin_messages";
    }
  };
  
  const canDelete = isOwn || isAdmin;
  const isPendingMessage = id.startsWith("temp-") || id.startsWith("queued-");
  const canReply = !!onReply && !isPendingMessage;

  const updateReactionMessages = useCallback((updater: (messages: any[]) => any[]) => {
    queryClient.setQueryData(queryKey, (old: any) => {
      const existingMessages: any[] = Array.isArray(old)
        ? old
        : old?.messages || [];

      const updatedMessages = updater(existingMessages);

      if (Array.isArray(old) || old === undefined) {
        return updatedMessages;
      }

      return {
        ...old,
        messages: updatedMessages,
      };
    });
  }, [queryClient, queryKey]);

  const getLatestReactions = useCallback((): Reaction[] => {
    const cacheEntry = queryClient.getQueryData<any>(queryKey);
    const messages = Array.isArray(cacheEntry) ? cacheEntry : cacheEntry?.messages || [];
    const cachedMessage = messages.find((message: any) => message.id === id);
    return (cachedMessage?.reactions || optimisticReactionsRef.current) as Reaction[];
  }, [queryClient, queryKey, id]);

  // Final rollback after retries are exhausted. Restores ONLY this user's
  // reaction rows for this message (from an immutable pre-mutation snapshot)
  // so that reactions other users made via realtime while the mutation was in
  // flight survive, and un-reconciled `temp-` rows are purged from both the
  // rendered state and the query cache.
  const rollbackOwnReactions = useCallback((snapshot: Reaction[] | undefined) => {
    const mine = (snapshot ?? []).filter((r) => r.user_id === currentUserId).map((r) => ({ ...r }));

    const merge = (current: Reaction[]): Reaction[] => [
      ...(current || []).filter((r) => r.user_id !== currentUserId),
      ...mine.map((r) => ({ ...r })),
    ];

    setLocalReactions((prev) => merge(prev));
    updateReactionMessages((msgs) =>
      msgs.map((msg: any) => {
        if (msg.id !== id) return msg;
        return { ...msg, reactions: merge((msg.reactions || []) as Reaction[]) };
      })
    );
  }, [currentUserId, id, setLocalReactions, updateReactionMessages]);



  const addReactionMutation = useMutation({
    mutationFn: async ({
      reactionType,
      existingReaction,
    }: {
      reactionType: string;
      existingReaction?: Reaction;
    }) => {
      const messageIdField = getMessageIdField();

      // Lab mode: cache-only reaction result, no backend write and no persistence.
      if (useIcpLab) {
        if (!currentUserId) return;
        if (existingReaction?.reaction_type === reactionType) {
          return { action: "delete" as const, reactionId: existingReaction.id };
        }
        const localReaction = {
          id: `local-reaction-${id}-${Date.now()}`,
          user_id: currentUserId,
          reaction_type: reactionType,
        };
        return existingReaction
          ? { action: "update" as const, reaction: localReaction }
          : { action: "insert" as const, reaction: localReaction };
      }

      // Ensure the session is fresh before mutating so RLS sees auth.uid().
      // Refresh-and-retry once if we hit an auth-like failure mid-flight.
      const performMutation = async (userId: string) => {
        if (existingReaction) {
          if (existingReaction.reaction_type === reactionType) {
            const { error } = await supabase
              .from("message_reactions")
              .delete()
              .eq("id", existingReaction.id);

            if (error) throw error;

            return { action: "delete" as const, reactionId: existingReaction.id };
          }

          const { data: updatedReaction, error } = await supabase
            .from("message_reactions")
            .update({ reaction_type: reactionType })
            .eq("id", existingReaction.id)
            .select("id, user_id, reaction_type")
            .single();

          if (error) throw error;

          return { action: "update" as const, reaction: updatedReaction };
        }

        const { data: insertedReaction, error } = await supabase
          .from("message_reactions")
          .insert({
            [messageIdField]: id,
            user_id: userId,
            reaction_type: reactionType,
          } as never)
          .select("id, user_id, reaction_type")
          .single();

        if (error) {
          if ((error as { code?: string }).code === "23505") {
            const { data: conflictingReaction, error: conflictFetchError } = await supabase
              .from("message_reactions")
              .select("id")
              .eq(messageIdField, id)
              .eq("user_id", userId)
              .maybeSingle();

            if (conflictFetchError || !conflictingReaction) {
              throw conflictFetchError || error;
            }

            const { data: updatedReaction, error: updateError } = await supabase
              .from("message_reactions")
              .update({ reaction_type: reactionType })
              .eq("id", conflictingReaction.id)
              .select("id, user_id, reaction_type")
              .single();

            if (updateError) throw updateError;

            return { action: "update" as const, reaction: updatedReaction };
          }

          throw error;
        }

        return { action: "insert" as const, reaction: insertedReaction };
      };

      let userId: string;
      try {
        userId = await ensureFreshSession();
      } catch {
        throw new Error("Not authenticated");
      }

      try {
        return await performMutation(userId);
      } catch (err) {
        if (isAuthLikeError(err)) {
          // Token may have just expired — refresh once and retry.
          const refreshedId = await ensureFreshSession(0);
          return await performMutation(refreshedId);
        }
        throw err;
      }
    },
    onMutate: ({ reactionType, existingReaction }) => {
      isReactionMutatingRef.current = true;
      void queryClient.cancelQueries({ queryKey });
      const previousMessages = queryClient.getQueryData(queryKey);
      // Immutable snapshot so later optimistic/realtime writes can't mutate
      // what we roll back to.
      const previousReactions = (optimisticReactionsRef.current || []).map((r) => ({ ...r }));

      if (!currentUserId) {
        return { previousMessages, previousReactions, tempReactionId: null };
      }

      const shouldRemoveReaction = existingReaction?.reaction_type === reactionType;
      const tempReactionId = shouldRemoveReaction ? null : `temp-${Date.now()}`;
      const filteredReactions = previousReactions.filter(
        (reaction) => reaction.user_id !== currentUserId
      );
      const nextReactions = shouldRemoveReaction || !tempReactionId
        ? filteredReactions
        : [
            ...filteredReactions,
            { id: tempReactionId, user_id: currentUserId, reaction_type: reactionType },
          ];

      setLocalReactions(nextReactions);
      updateReactionMessages((msgs) =>
        msgs.map((msg: any) => {
          if (msg.id !== id) return msg;
          return {
            ...msg,
            reactions: nextReactions,
          };
        })
      );

      return { previousMessages, previousReactions, tempReactionId };
    },
    onSuccess: (result) => {
      if (!result) return;

      if (result.action === "delete") {
        setLocalReactions((prev) => prev.filter((reaction) => reaction.id !== result.reactionId));
      } else {
        setLocalReactions((prev) => [
          ...prev.filter((reaction) => reaction.user_id !== result.reaction.user_id),
          result.reaction,
        ]);
      }

      updateReactionMessages((msgs) =>
        msgs.map((msg: any) => {
          if (msg.id !== id) return msg;

          if (result.action === "delete") {
            return {
              ...msg,
              reactions: (msg.reactions || []).filter((reaction: any) => reaction.id !== result.reactionId),
            };
          }

          return {
            ...msg,
            reactions: [
              ...(msg.reactions || []).filter((reaction: any) => reaction.user_id !== result.reaction.user_id),
              result.reaction,
            ],
          };
        })
      );
    },
    onError: (err, variables, context) => {
      console.error("[Reaction] Mutation error:", err);
      // Fires only after retries are exhausted: single, final rollback scoped
      // to this user's rows so other users' realtime reactions are preserved.
      rollbackOwnReactions(context?.previousReactions);
      toast.error("Couldn't update reaction. Please try again.");
    },
    onSettled: () => {
      isReactionMutatingRef.current = false;
    },
  });

  const removeReactionMutation = useMutation({
    mutationFn: async (reactionId: string) => {
      if (reactionId.startsWith("temp-")) {
        return;
      }
      if (useIcpLab) return;
      const doDelete = async () => {
        const { error } = await supabase
          .from("message_reactions")
          .delete()
          .eq("id", reactionId);
        if (error) throw error;
      };
      try {
        await ensureFreshSession();
        await doDelete();
      } catch (err) {
        if (isAuthLikeError(err)) {
          await ensureFreshSession(0);
          await doDelete();
        } else {
          throw err;
        }
      }
    },
    onMutate: (reactionId: string) => {
      isReactionMutatingRef.current = true;
      void queryClient.cancelQueries({ queryKey });
      const previousMessages = queryClient.getQueryData(queryKey);
      const previousReactions = (optimisticReactionsRef.current || []).map((r) => ({ ...r }));

      setLocalReactions((prev) => prev.filter((reaction) => reaction.id !== reactionId));
      updateReactionMessages((msgs) =>
        msgs.map((msg: any) => {
          if (msg.id !== id) return msg;
          return {
            ...msg,
            reactions: (msg.reactions || []).filter((reaction: any) => reaction.id !== reactionId),
          };
        })
      );

      return { previousMessages, previousReactions };
    },
    onError: (err, variables, context) => {
      rollbackOwnReactions(context?.previousReactions);
      toast.error("Couldn't update reaction. Please try again.");
    },
    onSettled: () => {
      isReactionMutatingRef.current = false;
    },
  });




  const deleteMessageMutation = useMutation({
    mutationFn: async () => {
      if (useIcpLab) return;
      const { error } = await supabase
        .from(getTableName())
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onMutate: async () => {
      await queryClient.cancelQueries({ queryKey });
      const previousMessages = queryClient.getQueryData(queryKey);
      
      queryClient.setQueryData(queryKey, (old: any) => {
        if (!old) return old;
        const existingMessages: any[] = Array.isArray(old) ? old : old?.messages || [];
        const updatedMessages = existingMessages.filter((msg: any) => msg.id !== id);
        if (Array.isArray(old)) return updatedMessages;
        return { ...old, messages: updatedMessages };
      });
      
      return { previousMessages };
    },
    onSuccess: () => {
      if (useIcpLab) return;
      const targetId = queryKey[1] as string;
      if (targetId) {
        removeMessageFromCache(messageType, targetId, id);
      }
      try {
        localStorage.removeItem('messages-page-cache');
      } catch {}
      // The parent row's denormalised last_message_* columns are recomputed by
      // the AFTER DELETE preview triggers, so refetch every surface that reads
      // them or the inbox keeps showing the deleted message.
      queryClient.invalidateQueries({ queryKey: ["team-chat-preview"] });
      queryClient.invalidateQueries({ queryKey: ["my-teams-with-messages"] });
      queryClient.invalidateQueries({ queryKey: ["member-clubs-with-messages"] });
      queryClient.invalidateQueries({ queryKey: ["my-chat-groups-with-messages"] });

      // Silent success - no toast
    },

    onError: (err, variables, context) => {
      if (context?.previousMessages) {
        queryClient.setQueryData(queryKey, context.previousMessages);
      }
      toast.error("Failed to delete message");
    },
  });
  // Swipe to reply
  const handleReply = useCallback(() => {
    onReply?.({ id, text, authorName: authorName || null });
  }, [onReply, id, text, authorName]);

  const { swipeState, swipeHandlers: swipeToReplyHandlers, resetReplyReveal } = useSwipeToReply({
    enabled: canReply,
    onReply: handleReply,
  });

  // Track when the reaction picker was opened to ignore premature dismiss events on iOS
  const reactionPickerOpenedAtRef = useRef(0);

  const handleLongPressStart = useCallback((e: React.TouchEvent) => {
    gestureModeRef.current = "press";
    longPressTriggeredRef.current = false;
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    longPressTimer.current = setTimeout(() => {
      if (gestureModeRef.current !== "press") return;
      longPressTriggeredRef.current = true;
      resetReplyReveal();
      armDismissGuard();
      // Haptic feedback
      hapticImpactLight();
      window.getSelection?.()?.removeAllRanges();
      reactionPickerOpenedAtRef.current = Date.now();
      setShowMenu(true);
      setShowReactionPicker(true);
      setShowActionSheet(true);
      // Pull the selected bubble into the lower third so the reaction pill
      // (just above it) and the bottom-anchored action sheet feel like one
      // focused interaction rather than three disconnected layers.
      requestAnimationFrame(() => scrollMessageIntoLowerThird(bubbleRef.current));
      markLongPressOnboardingCompleted();

    }, 400);
  }, [armDismissGuard]);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!touchStartPos.current) return;

    const dx = e.touches[0].clientX - touchStartPos.current.x;
    const dy = e.touches[0].clientY - touchStartPos.current.y;

    if (gestureModeRef.current === "press" && dx > 12 && Math.abs(dy) < 24) {
      gestureModeRef.current = "swipe";
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
        longPressTimer.current = null;
      }
      longPressTriggeredRef.current = false;
      // Force-activate the swipe hook so its directionality check doesn't reject the gesture
      swipeToReplyHandlers.forceActivate(touchStartPos.current.x, touchStartPos.current.y);
      swipeToReplyHandlers.onTouchMove(e);
      return;
    }

    if (gestureModeRef.current === "swipe") {
      swipeToReplyHandlers.onTouchMove(e);
      return;
    }

    if (longPressTimer.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      touchStartPos.current = null;
    }
  }, [swipeToReplyHandlers]);

  const handleLongPressEnd = useCallback((e: React.TouchEvent) => {
    if (gestureModeRef.current === "swipe") {
      swipeToReplyHandlers.onTouchEnd();
      gestureModeRef.current = "idle";
      touchStartPos.current = null;
      longPressTriggeredRef.current = false;
      return;
    }

    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    // On iOS, pointercancel can reset longPressTriggeredRef during DOM mutations.
    // Check if the reaction picker was recently opened as a fallback.
    const recentlyOpenedPicker = Date.now() - reactionPickerOpenedAtRef.current < 600;

    if (longPressTriggeredRef.current || recentlyOpenedPicker) {
      e.preventDefault();
      e.stopPropagation();
      armDismissGuard();
      // Re-arm the backdrop guard from finger-release time, not picker-open time.
      // The user may hold for >400ms, so the original guard would have expired.
      reactionPickerOpenedAtRef.current = Date.now();
      requestAnimationFrame(() => {
        longPressTriggeredRef.current = false;
      });
    }
    // Short tap on a text bubble does not open reply mode — long-press is
    // the primary interaction.

    touchStartPos.current = null;
    gestureModeRef.current = "idle";
  }, [armDismissGuard, swipeToReplyHandlers, isSystemMessage]);

  const handleReactionClick = useCallback((type: string, existingReactionId?: string) => {
    // Re-arm guard so any synthetic click iOS dispatches to underlying elements
    // (e.g. avatar) after the picker closes is suppressed by preventIfGuarded.
    armDismissGuard();
    setShowReactionPicker(false);
    setShowMenu(false);
    setShowActionSheet(false);

    if (existingReactionId) {
      removeReactionMutation.mutate(existingReactionId);
      return;
    }

    const latestReactions = getLatestReactions();
    const existingReaction = latestReactions.find((reaction) => reaction.user_id === currentUserId);
    addReactionMutation.mutate({
      reactionType: type,
      existingReaction,
    });
  }, [addReactionMutation, armDismissGuard, removeReactionMutation, getLatestReactions, currentUserId]);

  const closeReactionPicker = useCallback(() => {
    clearDismissGuard();
    setShowReactionPicker(false);
    setShowMenu(false);
    setShowActionSheet(false);
  }, [clearDismissGuard]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (consumeContextMenuGuard()) {
      return;
    }
    setShowMenu(true);
    setShowReactionPicker(true);
    setShowActionSheet(true);
  }, [consumeContextMenuGuard]);


  const handleStartEdit = useCallback(() => {
    onEdit?.({ id, text });
  }, [onEdit, id, text]);

  const handleDelete = useCallback(() => {
    setShowDeleteConfirm(true);
  }, []);

  const confirmDelete = useCallback(() => {
    deleteMessageMutation.mutate();
    setShowDeleteConfirm(false);
  }, [deleteMessageMutation]);

  const handleShowReactions = useCallback(() => {
    setShowMenu(true);
    setShowReactionPicker(true);
  }, []);


  useEffect(() => {
    const handlePointerCancel = () => {
      // On iOS WebView, pointercancel fires when DOM changes (e.g. portal insertion
      // during long-press). Only reset if the reaction picker is NOT currently open,
      // otherwise we'd prematurely dismiss it.
      if (!showReactionPicker) {
        longPressTriggeredRef.current = false;
        clearDismissGuard();
      }
    };

    window.addEventListener('pointercancel', handlePointerCancel, true);

    return () => {
      if (longPressTimer.current) {
        clearTimeout(longPressTimer.current);
      }
      window.removeEventListener('pointercancel', handlePointerCancel, true);
    };
  }, [clearDismissGuard, showReactionPicker]);

  // Get display name - never show placeholder text; hide name until profile loads
  const displayName = authorName || "";
  const hasName = !!authorName;


  // Hide messages from blocked users (after all hooks)
  if (!isOwn && isBlocked(authorId)) return null;

  // Gallery upload cards: rendered centered as a card (not a pill).
  const galleryCardMatch = isSystemMessage ? text.match(/^\s*\[(?:gallery|galleryprompt):([0-9a-f-]{36})\]\s*$/i) : null;
  if (galleryCardMatch) {
    return (
      <div ref={rowRef} className="flex justify-center my-2 px-3">
        <MessageContent text={text} previewsOnly />
      </div>
    );
  }

  // System messages (e.g. "Alex joined as Coach") render as a centered grey pill,
  // WhatsApp-style: no avatar, no actions, no reactions.
  if (isSystemMessage || isMembershipSystemText(text)) {
    // Chat-photo gallery reminder cron appends a [publish:<teamId>] CTA token.
    // Hide this specific reminder from chat (per product decision); the cron
    // and DB rows are untouched.
    if (/\[publish:([0-9a-f-]{36})\]/i.test(text)) {
      return null;
    }
    // Detect [rsvp:<eventId>] token appended by the auto-rsvp DM cron and
    // render Going / Maybe / Out pills under the pill bubble.
    const rsvpMatch = text.match(/\[rsvp:([0-9a-f-]{36})\]/i);
    const cleanedText = text
      .replace(rsvpMatch ? rsvpMatch[0] : "", "")
      .trim();
    return (
      <div ref={rowRef} className="flex flex-col items-center gap-2 my-2 px-4">
        <div className="max-w-[85%] rounded-2xl bg-muted/70 px-3 py-2 text-center text-[12px] text-muted-foreground whitespace-pre-line">
          {cleanedText}
        </div>
        {rsvpMatch && <InlineRsvpActions eventId={rsvpMatch[1]} messageId={id} />}
      </div>
    );
  }

  const isInteracting = showMenu || showReactionPicker || showActionSheet;

  // Detect [rsvp:<eventId>] token in any message (e.g. auto-rsvp DM cron sends
  // these as regular DMs from the club bot). Strip from displayed text and
  // render Going / Maybe / Out pills under the bubble.
  const inlineRsvpMatch = text.match(/\[rsvp:([0-9a-f-]{36})\]/i);
  const displayText = inlineRsvpMatch ? text.replace(inlineRsvpMatch[0], "").trim() : text;

  // Card-only messages (shared news/event/poll/board/vault/gallery with no
  // typed caption): the token renders as an empty inline span, so a padded,
  // coloured bubble would show as a weird blank bubble next to the card.
  // Detect this and strip the bubble chrome — the card renders outside.
  const CARD_TOKEN_REGEX = /\[(event|poll|board|vault|vaultfolder|vaultroot|gallery|galleryprompt|news):[0-9a-f-]{36}(?::(?:team|club))?\]/i;
  const visibleCaptionText = displayText
    .replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/(?:https?:\/\/[^\s]*)?\/events\/[0-9a-f-]{36}(?:\S*)?/gi, "")
    .replace(/\[(event|poll|board|vault|vaultfolder|vaultroot|gallery|galleryprompt|news)(:[0-9a-f-]{36}){1,2}\]/gi, "")
    .trim();
  const isCardOnlyMessage =
    !imageUrl &&
    !visibleCaptionText &&
    !forwardedFromUserId &&
    CARD_TOKEN_REGEX.test(displayText);

  // NOTE: We intentionally do NOT apply an entrance animation here. When an
  // optimistic `temp-…` row is replaced by the realtime row with the real
  // UUID, React's key changes and the row unmounts/remounts — any entrance
  // animation would then re-run, producing a visible "flash" on send. Team
  // chat never showed this flash only because its formatted timestamp
  // happened to be unparseable; we now match that behaviour for all chats.
  return (
    <div ref={rowRef} className={`flex min-w-0 max-w-full gap-3 group ${isOwn && !isClubAnnouncement ? "flex-row-reverse" : ""} ${isInteracting ? "relative z-[100000]" : ""} ${groupedWithPrev ? "-mt-3" : ""}`} style={{ overflowAnchor: 'none' }}>

      {isInteracting && createPortal(
        <div
          className="fixed inset-0 dark:bg-black/[0.18] bg-black/[0.22] z-[99999] animate-in fade-in-0 duration-200 ease-out"
          onClick={(e) => {
            // Ignore synthesized clicks within 400ms of reaction picker opening (iOS WebView)
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            clearDismissGuard();
            setShowReactionPicker(false);
            setShowMenu(false);
            setShowActionSheet(false);
          }}
          onTouchEnd={(e) => {
            // Ignore synthesized touch events within 400ms of reaction picker opening (iOS WebView)
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            clearDismissGuard();
            setShowReactionPicker(false);
            setShowMenu(false);
            setShowActionSheet(false);
          }}
        />,
        document.body
      )}
      {isOwn && !isClubAnnouncement ? (
        // Outgoing messages never show the sender avatar — modern messaging
        // apps rely on right-alignment + bubble colour for ownership cues.
        null
      ) : isClubAnnouncement && !authorAvatar ? (
        groupedWithPrev ? (
          <div className="h-9 w-9 shrink-0" aria-hidden="true" />
        ) : (
          <div className="h-9 w-9 shrink-0 rounded-full bg-primary flex items-center justify-center">
            <Megaphone className="h-[18px] w-[18px] text-primary-foreground" />
          </div>
        )
      ) : groupedWithPrev ? (
        // Incoming follow-up message in a group: reserve the avatar slot
        // so bubbles stay vertically aligned, but don't repeat the avatar.
        <div className="h-9 w-9 shrink-0" aria-hidden="true" />
      ) : (
        <button
          type="button"
          onClick={(e) => {
            if (preventIfGuarded(e)) return;
            onAuthorClick?.();
          }}
          disabled={!onAuthorClick}
          className="shrink-0 rounded-full disabled:cursor-default"
          aria-label={displayName ? `Open ${displayName} profile actions` : "Open profile actions"}
        >
          <Avatar className="h-9 w-9 ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-[0_1px_2px_-1px_rgba(0,0,0,0.12)]">
            <AvatarImage src={authorAvatar || undefined} className="object-cover" />
            <AvatarFallback
              className="text-[13px] font-semibold tracking-tight"
              style={getAvatarFallbackStyle(displayName)}
            >
              {getAvatarInitial(displayName)}
            </AvatarFallback>
          </Avatar>
        </button>
      )}

      <div className={`flex w-full min-w-0 max-w-[82%] flex-col ${isOwn && !isClubAnnouncement ? "items-end" : "items-start"}`}>
        {/* Always reserve the name-row height for non-own, non-announcement
            messages so late profile hydration on first-ever open of a thread
            does not cause cumulative vertical layout shift (which the chat
            scroll-pin hook can never fully race — visible as a "jolt up"). */}
        {isClubAnnouncement && !groupedWithPrev ? (
          <button
            type="button"
            onClick={(e) => {
              if (preventIfGuarded(e)) return;
              onAuthorClick?.();
            }}
            disabled
            className="text-xs mb-1 text-left font-semibold text-primary disabled:cursor-default"
          >
            {displayName || "Club"}
          </button>
        ) : !isOwn && !isClubAnnouncement && !groupedWithPrev ? (
          <button
            type="button"
            onClick={(e) => {
              if (preventIfGuarded(e)) return;
              onAuthorClick?.();
            }}
            disabled={!onAuthorClick}
            // min-height locks ~16px (text-xs line-height) so the row exists
            // even before authorName resolves — no shift on hydration.
            style={{ minHeight: '16px' }}
            className="text-[12px] leading-tight mb-1 text-left text-foreground/85 font-semibold tracking-[-0.005em] disabled:cursor-default"
          >
            {displayName || "\u00A0"}
          </button>
        ) : null}
        <ReplyIndicator replyToMessage={replyToMessage} hasReply={hasReply || !!replyToMessage} isOwn={isOwn} />
        <div className="relative min-w-0 max-w-full group/msg">
          {/* Swipe indicator - text only, shown when past threshold */}
          {canReply && swipeState.pastThreshold && (
            <div
              className="absolute left-0 top-1/2 -translate-y-1/2 pointer-events-none z-0 flex items-center pl-1"
              style={{
                opacity: 1,
                transition: swipeState.isSwiping ? 'none' : 'opacity 0.2s ease-out',
              }}
            >
              <span className="text-[10px] font-medium text-primary whitespace-nowrap animate-in fade-in-0 duration-100">
                Release to reply
              </span>
            </div>
          )}
          {/* Swipe-to-reply wrapper */}
          <div
            className="relative min-w-0 max-w-full select-none"
            style={{
              transform: swipeState.offsetX > 0 ? `translateX(${swipeState.offsetX}px)` : undefined,
              transition: swipeState.isSwiping || swipeState.offsetX === 0 ? 'none' : 'transform 0.2s ease-out',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              WebkitTouchCallout: 'none',
              WebkitTapHighlightColor: 'transparent',
            }}
            onTouchStart={(e) => {
              handleLongPressStart(e);
              swipeToReplyHandlers.onTouchStart(e);
            }}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={handleContextMenu}
          >
              <div
                ref={bubbleRef}
                className={isCardOnlyMessage
                  ? "relative max-w-full select-none"
                  : `relative max-w-full rounded-2xl ${imageUrl ? "p-0" : "px-4 py-2"} select-none overflow-hidden chat-bubble-stable ${
                isOwn && !isClubAnnouncement
                  ? `bg-chat-bubble-own text-chat-bubble-own-foreground ${groupedWithPrev ? "rounded-tr-sm" : ""} ${groupedWithNext ? "rounded-br-2xl" : "rounded-br-sm"}`
                  : `bg-card border border-border/40 ${groupedWithPrev ? "rounded-tl-sm" : ""} ${groupedWithNext ? "rounded-bl-2xl" : "rounded-bl-sm"}`
              } ${tapFlash ? "ring-2 ring-primary/40" : ""} ${
                isInteracting
                  ? "ring-1 ring-primary/40 ring-offset-0 shadow-[0_28px_56px_-20px_rgba(0,0,0,0.55),0_8px_18px_-6px_rgba(0,0,0,0.22)]"
                  : ""
              } ${isInteracting ? "transition-shadow duration-150 ease-out" : ""}`}

              onPointerDown={(e) => e.preventDefault()}
              onContextMenu={(e) => e.preventDefault()}
              onDragStart={(e) => e.preventDefault()}
            >
              {forwardedFromUserId && (
                <div
                  className={`flex items-center gap-1 text-[11px] italic mb-1 ${imageUrl ? "px-4 pt-2" : ""} ${
                    isOwn && !isClubAnnouncement ? "text-chat-bubble-own-foreground/70" : "text-muted-foreground"
                  }`}
                >
                  <Forward className="h-3 w-3 shrink-0" />
                  <span className="truncate">
                    Forwarded{forwardedFromName ? ` from ${forwardedFromName}` : ""}
                    {forwardedSourceLabel ? ` · ${forwardedSourceLabel}` : ""}
                  </span>
                </div>
              )}
              <div className="text-sm min-w-0 max-w-full">
                <MessageContent 
                  text={displayText} 
                  imageUrl={imageUrl} 
                  searchQuery={searchQuery} 
                  showPreviews={false}
                  showImageActions={!isOwn && !isSystemMessage && !!imageUrl}
                  onReportImage={() => setShowReportDialog(true)}
                  onBlockImageAuthor={() => setShowBlockDialog(true)}
                  onForwardImage={!isSystemMessage && !isPendingMessage && !!imageUrl ? () => setShowForwardSheet(true) : undefined}
                />
              </div>
              <MessageReactionsPopover
                reactions={optimisticReactions}
                currentUserId={currentUserId}
                onReact={(type) => handleReactionClick(type)}
                onRemove={(reactionId) => {
                  removeReactionMutation.mutate(reactionId);
                }}
                isMutating={false}
                isOpen={showReactionPicker}
                preventIfGuarded={preventIfGuarded}
                onOpenChange={(open) => {
                  if (open) {
                    setShowReactionPicker(true);
                    return;
                  }
                  closeReactionPicker();
                }}
                isOwnMessage={isOwn}
                anchorRef={bubbleRef}
              />
            </div>
            {showTapHint && (
              <div
                className={`mt-1 px-1 text-[10.5px] text-muted-foreground/70 animate-fade-in ${
                  isOwn && !isClubAnnouncement ? "text-right" : "text-left"
                }`}
                role="status"
              >
                Hold for reactions &amp; replies
              </div>
            )}
            {inlineRsvpMatch && (
              <div className="mt-2">
                <InlineRsvpActions eventId={inlineRsvpMatch[1]} messageId={id} />
              </div>
            )}
            {/* Inline "Add to gallery" chip — only on own image messages.
                Reserve a fixed-height slot whenever this is an own image
                message that isn't queued, so that the chip appearing once
                permissions hydrate (canPublishToGallery / onPublishToGallery)
                never grows the row mid-scroll and pushes everything below
                it downward during a fast upward flick. */}
            {isOwn && imageUrl && !id.startsWith("queued-") && messageType !== "dm" && canPublishToGallery && onPublishToGallery && (
              <div className={`mt-1 flex h-7 items-center ${isOwn ? "justify-end" : "justify-start"}`}>
                <button
                  type="button"
                  disabled={isPublishingToGallery || isPublishedToGallery}
                  aria-busy={isPublishingToGallery || undefined}
                  aria-disabled={isPublishingToGallery || isPublishedToGallery || undefined}
                  onClick={(e) => {
                    e.stopPropagation();
                    if (isPublishingToGallery || isPublishedToGallery) return;
                    onPublishToGallery(id, imageUrl);
                  }}
                  className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-medium transition-all ${
                    isPublishedToGallery
                      ? "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 cursor-default"
                      : isPublishingToGallery
                        ? "bg-primary/10 text-primary cursor-wait animate-pulse"
                        : "bg-muted/70 text-muted-foreground hover:bg-muted hover:text-foreground active:scale-[0.97] cursor-pointer"
                  }`}
                  aria-label={
                    isPublishingToGallery
                      ? "Adding to media gallery"
                      : isPublishedToGallery
                        ? "Already in gallery"
                        : "Add to media gallery"
                  }
                >
                  {isPublishingToGallery ? (
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                  ) : isPublishedToGallery ? (
                    <Check className="h-3 w-3" aria-hidden="true" />
                  ) : (
                    <ImagePlus className="h-3 w-3" aria-hidden="true" />
                  )}
                  <span>
                    {isPublishingToGallery
                      ? "Adding…"
                      : isPublishedToGallery
                        ? "In gallery"
                        : "Add to gallery"}
                  </span>
                </button>
              </div>
            )}
          </div>
        </div>
        {/* Action sheet (replaces 3-dot dropdown menu) */}
        <MessageActionSheet
          open={showActionSheet}
          onOpenChange={(open) => {
            setShowActionSheet(open);
            if (!open) {
              setShowMenu(false);
              setShowReactionPicker(false);
              clearDismissGuard();
            }
          }}
          isOwn={isOwn}
          canReply={canReply}
          canEdit={isOwn}
          canDelete={canDelete}
          isSystemMessage={isSystemMessage}
          messageText={text}
          onReply={handleReply}
          onEdit={handleStartEdit}
          onDelete={handleDelete}
          onReport={() => setShowReportDialog(true)}
          onBlock={() => setShowBlockDialog(true)}
          hasImage={!!imageUrl}
          onViewImage={() => setShowFullscreenImage(true)}
          canPin={canPin}
          isPinned={isPinned}
          pinLimitReached={pinLimitReached}
          onPin={onPin ? () => onPin(id) : undefined}
          onUnpin={onUnpin ? () => onUnpin(id) : undefined}
          canPublishToGallery={canPublishToGallery && isOwn && !!imageUrl}
          isPublishedToGallery={isPublishedToGallery}
          isPublishingToGallery={isPublishingToGallery}
          onPublishToGallery={
            onPublishToGallery && imageUrl ? () => onPublishToGallery(id, imageUrl) : undefined
          }
          canForward={!isSystemMessage && !isPendingMessage}
          onForward={() => setShowForwardSheet(true)}
        />
        <ForwardMessageSheet
          open={showForwardSheet}
          onOpenChange={setShowForwardSheet}
          source={{
            text: text ?? "",
            imageUrl: imageUrl ?? null,
            authorId,
            sourceLabel:
              messageType === "team"
                ? "Team chat"
                : messageType === "club"
                  ? "Club chat"
                  : messageType === "dm"
                    ? "Direct message"
                    : messageType === "broadcast"
                      ? "Broadcast"
                      : null,
          }}
        />
        {/* Fullscreen image viewer triggered from action sheet */}
        {showFullscreenImage && imageUrl && (
          <FullscreenImageViewer
            src={imageUrl}
            alt="Attachment"
            onClose={() => setShowFullscreenImage(false)}
          />
        )}
        {/* Link previews rendered outside the message bubble */}
        <div className="w-full min-w-0 max-w-full self-stretch overflow-hidden">
          <MessageContent text={text} previewsOnly />
        </div>
        
        <MessageReactionsDisplay
          reactions={optimisticReactions}
          currentUserId={currentUserId}
          onReactionClick={handleReactionClick}
          isOwn={isOwn}
        />
        
        {/* Per-bubble timestamp / inline read-state. Hidden on grouped
            follow-ups (groupedWithNext) so only the LAST bubble in a
            sender's burst carries the metadata — keeps the thread quiet
            and content-first. The standalone "isLastMessage" frontier
            block below still always renders for the chat tail. */}
        {!groupedWithNext && (
          <p className={`text-[11px] leading-none text-muted-foreground/70 mt-1 flex items-baseline gap-1 whitespace-nowrap overflow-hidden tabular-nums tracking-tight ${isOwn ? "justify-end pr-2.5" : "pl-2.5"}`}>

            {isPending && (
              <span className="flex items-center gap-0.5 text-amber-500" title="Pending sync">
                <Clock className="h-3 w-3" />
              </span>
            )}
            {timestamp}
            {isEdited && (!isOwn || isClubAnnouncement || isPending || (isOwn && isLastOwnMessage && readFrontierReaders.length > 0)) && (
              <span className="opacity-70">· Edited</span>
            )}
            {!isPending && isOwn && !isClubAnnouncement && (
              // Unified inline metadata for own messages — keeps the metadata
              // strip a single line across every chat type (DM, Team, Club,
              // Committee, Competition, Group). The standalone reader-avatar
              // block below only renders when there are real avatars to show
              // for the chat tail, replacing the "Sent" label entirely.
              isLastOwnMessage
                ? (readFrontierReaders.length === 0
                    ? <MessageReadIndicator readCount={0} isOwn={isOwn} readerName={readerName} isEdited={isEdited} />
                    : null)
                : (readCount > 0
                    ? (messageType === "dm"
                        ? <MessageReadIndicator readCount={readCount} isOwn={isOwn} readerName={readerName} isEdited={isEdited} />
                        : <span className="cursor-pointer underline" onClick={() => setShowReadReceipts(true)}>
                            <MessageReadIndicator readCount={readCount} isOwn={isOwn} readerName={readerName} isEdited={isEdited} />
                          </span>)
                    : <MessageReadIndicator readCount={0} isOwn={isOwn} readerName={readerName} isEdited={isEdited} />)
            )}
          </p>
        )}
        {!isPending && isLastOwnMessage && isOwn && !isClubAnnouncement && readFrontierReaders.length > 0 && (
          messageType === "dm"
            ? <MessageReadAvatars readers={readFrontierReaders} isOwn={isOwn} />
            : <div className="cursor-pointer" onClick={() => setShowReadReceipts(true)}>
                <MessageReadAvatars readers={readFrontierReaders} isOwn={isOwn} />
              </div>
        )}
        {isOwn && messageType !== "dm" && (
          <ReadReceiptSheet
            open={showReadReceipts}
            onOpenChange={setShowReadReceipts}
            readers={isLastOwnMessage ? readFrontierReaders : []}
            messageId={id}
            messageType={messageType}
            contextId={contextId || ""}
            currentUserId={currentUserId}
          />
        )}
      </div>
      {showBlockDialog && (
        <BlockUserDialog
          open={showBlockDialog}
          onOpenChange={setShowBlockDialog}
          userId={authorId}
          userName={authorName || "this user"}
        />
      )}
      {showReportDialog && (
        <ReportMessageDialog
          isOpen={showReportDialog}
          onClose={() => setShowReportDialog(false)}
          messageId={id}
          messageType={messageType === "dm" ? "direct" : messageType}
        />
      )}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete message?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This message will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

// Shallow compare reactions array by id+user+type (stable identity not guaranteed by parent).
function reactionsEqual(a: Reaction[] = [], b: Reaction[] = []) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const x = a[i], y = b[i];
    if (x.id !== y.id || x.user_id !== y.user_id || x.reaction_type !== y.reaction_type) return false;
  }
  return true;
}

function readersEqual(a: ReaderInfo[] = [], b: ReaderInfo[] = []) {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i]?.user_id !== b[i]?.user_id) return false;
  }
  return true;
}

function replyEqual(a?: ReplyToMessage | null, b?: ReplyToMessage | null) {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.text === b.text && a.authorName === b.authorName;
}

function arePropsEqual(prev: ChatMessageProps, next: ChatMessageProps) {
  // Compare only props that affect render output. Ignore callback identity
  // (onReply/onEdit/onAuthorClick/onPin/onUnpin/onPublishToGallery) — parents
  // recreate them on every render but their behavior is stable per-message.
  if (
    prev.id !== next.id ||
    prev.text !== next.text ||
    prev.imageUrl !== next.imageUrl ||
    prev.authorId !== next.authorId ||
    prev.authorName !== next.authorName ||
    prev.authorAvatar !== next.authorAvatar ||
    prev.timestamp !== next.timestamp ||
    prev.isOwn !== next.isOwn ||
    prev.isAdmin !== next.isAdmin ||
    prev.currentUserId !== next.currentUserId ||
    prev.messageType !== next.messageType ||
    prev.hasReply !== next.hasReply ||
    prev.searchQuery !== next.searchQuery ||
    prev.readCount !== next.readCount ||
    prev.readerName !== next.readerName ||
    prev.isLastMessage !== next.isLastMessage ||
    prev.isLastOwnMessage !== next.isLastOwnMessage ||
    prev.isPending !== next.isPending ||
    prev.isSystemMessage !== next.isSystemMessage ||
    prev.isClubAnnouncement !== next.isClubAnnouncement ||
    prev.contextId !== next.contextId ||
    prev.isPinned !== next.isPinned ||
    prev.canPin !== next.canPin ||
    prev.pinLimitReached !== next.pinLimitReached ||
    prev.canPublishToGallery !== next.canPublishToGallery ||
    prev.isPublishedToGallery !== next.isPublishedToGallery ||
    prev.isPublishingToGallery !== next.isPublishingToGallery ||
    prev.groupedWithPrev !== next.groupedWithPrev ||
    prev.groupedWithNext !== next.groupedWithNext
  ) {
    return false;
  }
  // Toggling onAuthorClick presence (undefined vs defined) changes affordance.
  if (!!prev.onAuthorClick !== !!next.onAuthorClick) return false;
  // queryKey is an array — compare by content (parents pass queryKeyMemo but be safe).
  if (prev.queryKey !== next.queryKey) {
    if (!prev.queryKey || !next.queryKey || prev.queryKey.length !== next.queryKey.length) return false;
    for (let i = 0; i < prev.queryKey.length; i++) {
      if (prev.queryKey[i] !== next.queryKey[i]) return false;
    }
  }
  if (!replyEqual(prev.replyToMessage, next.replyToMessage)) return false;
  if (!reactionsEqual(prev.reactions, next.reactions)) return false;
  if (!readersEqual(prev.readFrontierReaders, next.readFrontierReaders)) return false;
  return true;
}

export const ChatMessage = memo(ChatMessageInner, arePropsEqual);
