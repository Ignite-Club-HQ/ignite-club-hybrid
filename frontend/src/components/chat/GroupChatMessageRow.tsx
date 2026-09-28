import { memo, useState, useRef, useCallback, useEffect } from "react";
import { createPortal } from "react-dom";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { getAvatarFallbackStyle, getAvatarInitial } from "@/lib/avatarColor";
import { Button } from "@/components/ui/button";
import { Clock, Check, ImagePlus, Loader2, Forward } from "lucide-react";
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
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { format } from "date-fns";
import { MessageContent } from "./MessageContent";
import { FullscreenImageViewer } from "./FullscreenImageViewer";
import { MessageReadAvatars } from "./MessageReadAvatars";
import { MessageReadIndicator } from "./MessageReadIndicator";
import { ReadReceiptSheet } from "./ReadReceiptSheet";
import type { ReaderInfo } from "@/hooks/useMessageReads";
import { useLongPressDismissGuard } from "@/hooks/useLongPressDismissGuard";
import { hapticImpactLight } from "@/lib/haptics";
import { useSwipeToReply } from "@/hooks/useSwipeToReply";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { ForwardMessageSheet } from "@/components/chat/ForwardMessageSheet";
import { ReportMessageDialog } from "@/components/chat/ReportMessageDialog";
import { isMembershipSystemText } from "@/lib/systemMessagePatterns";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { MessageReactionsPopover } from "./MessageReactions";
import { ReplyIndicator } from "./ReplyPreview";
import { observeChatElementHeight } from "@/lib/chatScrollActivity";
import { scrollMessageIntoLowerThird } from "@/lib/scrollMessageIntoLowerThird";
import { cacheProfiles, fetchProfilesWithCache, getProfileFromCache, selectCachedProfilesByIds } from "@/lib/profileCache";
import { claimFirstBubbleHint } from "@/hooks/useChatActionsOnboarding";


const GROUP_REACTION_EMOJI_MAP: Record<string, string> = {
  "❤️": "❤️",
  "🔥": "🔥",
  "👏": "👏",
  "😂": "😂",
  "👍": "👍",
  "😢": "😢",
  "🎉": "🎉",
  "😮": "😮",
  like: "❤️",
  fire: "🔥",
  clap: "👏",
  laugh: "😂",
  thumbsup: "👍",
  sad: "😢",
  celebrate: "🎉",
  wow: "😮",
};

const normalizeGroupReactionType = (reactionType?: string | null) => {
  if (!reactionType) return "";
  return GROUP_REACTION_EMOJI_MAP[reactionType] || reactionType;
};

const normalizeDisplayName = (name?: string | null) => {
  const trimmed = name?.trim();
  if (!trimmed) return null;
  return /^unknown(?: user)?$/i.test(trimmed) ? null : trimmed;
};

interface GroupMessage {
  id: string;
  text: string;
  image_url: string | null;
  created_at: string;
  edited_at?: string | null;
  author_id: string;
  group_id: string;
  reply_to_id: string | null;
  is_system_message?: boolean;
  forwarded_from_user_id?: string | null;
  forwarded_at?: string | null;
  forwarded_source_label?: string | null;
  author?: { display_name: string | null; avatar_url: string | null };
  reply_to?: { text: string; author?: { display_name: string | null } } | null;
}

interface GroupChatMessageRowProps {
  msg: GroupMessage;
  messagesById: Map<string, GroupMessage>;
  isOwnMessage: boolean;
  isAdmin: boolean;
  highlightedMessageId: string | null;
  messageReactions: any[];
  userId?: string;
  getProfile: (id: string) => { display_name: string | null; avatar_url: string | null } | null;
  readFrontier: Record<string, ReaderInfo[]>;
  readCounts: Record<string, number>;
  handleReply: (msg: GroupMessage) => void;
  handleEdit: (msg: GroupMessage) => void;
  deleteMessageMutation: { mutate: (id: string) => void };
  toggleReactionMutation: { mutate: (args: { messageId: string; reactionType: string }) => void };
  groupId?: string;
  searchQuery?: string;
  isPinned?: boolean;
  pinLimitReached?: boolean;
  onPin?: (messageId: string) => void;
  onUnpin?: (messageId: string) => void;
  canPublishToGallery?: boolean;
  isPublishingToGallery?: boolean;
  isPublishedToGallery?: boolean;
  onPublishToGallery?: (messageId: string, imageUrl: string) => void;
  /** When false, the Forward action is hidden (group has forwarding disabled by admin). */
  allowForwarding?: boolean;
  /** Name of the current group — used as source label on forwarded copies. */
  groupName?: string | null;
  /** True when the previous message is from the same author within the grouping window. */
  groupedWithPrev?: boolean;
  /** True when the next message is from the same author within the grouping window. */
  groupedWithNext?: boolean;
}

export const GroupChatMessageRow = memo(function GroupChatMessageRow({
  msg,
  messagesById,
  isOwnMessage,
  isAdmin,
  highlightedMessageId,
  messageReactions,
  userId,
  getProfile,
  readFrontier,
  readCounts,
  handleReply,
  handleEdit,
  deleteMessageMutation,
  toggleReactionMutation,
  groupId,
  searchQuery,
  isPinned = false,
  pinLimitReached = false,
  onPin,
  onUnpin,
  canPublishToGallery = false,
  isPublishingToGallery = false,
  isPublishedToGallery = false,
  onPublishToGallery,
  allowForwarding = true,
  groupName,
  groupedWithPrev = false,
  groupedWithNext = false,
}: GroupChatMessageRowProps) {
  const [showMenu, setShowMenu] = useState(false);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showReadReceipts, setShowReadReceipts] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showFullscreenImage, setShowFullscreenImage] = useState(false);
  const [showForwardSheet, setShowForwardSheet] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);
  const [showTapHint, setShowTapHint] = useState(false);
  const tapHintTimer = useRef<NodeJS.Timeout | null>(null);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const longPressTriggeredRef = useRef(false);
  const bubbleRef = useRef<HTMLDivElement>(null);
  const rowRef = useRef<HTMLDivElement>(null);
  const gestureModeRef = useRef<"idle" | "press" | "swipe">("idle");
  const {
    armDismissGuard,
    clearDismissGuard,
    consumeContextMenuGuard,
    preventIfGuarded,
  } = useLongPressDismissGuard();

  const closeActionUi = useCallback(() => {
    clearDismissGuard();
    setShowMenu(false);
    setShowReactionPicker(false);
    setShowActionSheet(false);
  }, [clearDismissGuard]);

  const closeReactionPicker = useCallback(() => {
    clearDismissGuard();
    setShowReactionPicker(false);
    setShowMenu(false);
    setShowActionSheet(false);
  }, [clearDismissGuard]);

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
      hapticImpactLight();
      window.getSelection?.()?.removeAllRanges();
      reactionPickerOpenedAtRef.current = Date.now();
      setShowMenu(true);
      setShowReactionPicker(true);
      setShowActionSheet(true);
      // Pull the selected bubble into the lower third so the reaction pill
      // and the bottom-anchored action sheet read as one focused interaction.
      requestAnimationFrame(() => scrollMessageIntoLowerThird(bubbleRef.current));
    }, 400);

  }, [armDismissGuard]);

  const handleReplyAction = useCallback(() => {
    handleReply(msg);
  }, [handleReply, msg]);

  const { swipeState, swipeHandlers: swipeToReplyHandlers, resetReplyReveal } = useSwipeToReply({
    enabled: true,
    onReply: handleReplyAction,
  });

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
      reactionPickerOpenedAtRef.current = Date.now();
      requestAnimationFrame(() => {
        longPressTriggeredRef.current = false;
      });
    }
    // Short tap is a no-op on text bubbles — long press is the only path to
    // message actions (WhatsApp / iMessage parity). Inner content keeps its
    // own tap handlers since we no longer preventDefault on the short tap.

    touchStartPos.current = null;
    gestureModeRef.current = "idle";
  }, [armDismissGuard, swipeToReplyHandlers]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (consumeContextMenuGuard()) {
      return;
    }
    setShowMenu(true);
    setShowReactionPicker(true);
    setShowActionSheet(true);
  }, [consumeContextMenuGuard]);

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

    window.addEventListener("pointercancel", handlePointerCancel, true);

    return () => {
      if (longPressTimer.current) clearTimeout(longPressTimer.current);
      if (tapHintTimer.current) clearTimeout(tapHintTimer.current);
      window.removeEventListener("pointercancel", handlePointerCancel, true);
    };
  }, [clearDismissGuard, showReactionPicker]);

  useEffect(() => observeChatElementHeight(rowRef.current), []);

  // One-time, auto-fading caption beneath the first message bubble the user
  // sees, to surface the long-press gesture without a global banner.
  useEffect(() => {
    if (claimFirstBubbleHint()) {
      setShowTapHint(true);
      if (tapHintTimer.current) clearTimeout(tapHintTimer.current);
      tapHintTimer.current = setTimeout(() => setShowTapHint(false), 4000);
    }
  }, []);

  const profile = getProfile(msg.author_id);
  const displayName = profile?.display_name || msg.author?.display_name || "Loading...";
  const avatarUrl = profile?.avatar_url || msg.author?.avatar_url || undefined;
  const frontierReaders = readFrontier[msg.id] || [];
  const fallbackReplyMessage = !msg.reply_to && msg.reply_to_id
    ? messagesById.get(msg.reply_to_id) ?? null
    : null;
  const replyPreview = msg.reply_to ?? (fallbackReplyMessage
    ? {
        text: fallbackReplyMessage.text,
        author: {
          display_name:
            getProfile(fallbackReplyMessage.author_id)?.display_name ||
            fallbackReplyMessage.author?.display_name ||
            null,
        },
      }
    : null);
  const currentUserReaction = messageReactions.find(
    (reaction) => reaction.user_id === userId,
  );
  const normalizedMessageReactions = messageReactions.map((reaction) => ({
    ...reaction,
    reaction_type: normalizeGroupReactionType(reaction.reaction_type),
  }));

  const handleReactionPickerReact = useCallback((reactionType: string) => {
    const isSelected = normalizeGroupReactionType(currentUserReaction?.reaction_type) === reactionType;

    toggleReactionMutation.mutate({
      messageId: msg.id,
      reactionType: isSelected ? (currentUserReaction?.reaction_type || reactionType) : reactionType,
    });

    closeActionUi();
  }, [closeActionUi, currentUserReaction, msg.id, toggleReactionMutation]);

  const handleReactionPickerRemove = useCallback((reactionId: string) => {
    const reaction = messageReactions.find((item) => item.id === reactionId);
    if (!reaction) return;

    toggleReactionMutation.mutate({
      messageId: msg.id,
      reactionType: reaction.reaction_type,
    });

    closeActionUi();
  }, [closeActionUi, messageReactions, msg.id, toggleReactionMutation]);

  const isInteracting = showMenu || showReactionPicker || showActionSheet;

  // Card-only messages (shared news/event/poll/etc. with no typed caption):
  // the token renders as an empty inline span, so suppress the padded,
  // coloured bubble chrome to avoid a weird blank bubble beside the card.
  const visibleCaptionText = (msg.text || "")
    .replace(/@\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, "$1")
    .replace(/(?:https?:\/\/[^\s]*)?\/events\/[0-9a-f-]{36}(?:\S*)?/gi, "")
    .replace(/\[(event|poll|board|vault|vaultfolder|vaultroot|gallery|galleryprompt|news)(:[0-9a-f-]{36}){1,2}\]/gi, "")
    .trim();
  const isCardOnlyMessage =
    !msg.image_url &&
    !visibleCaptionText &&
    !msg.forwarded_from_user_id &&
    /\[(event|poll|board|vault|vaultfolder|vaultroot|gallery|galleryprompt|news):[0-9a-f-]{36}(?::(?:team|club))?\]/i.test(msg.text || "");

  // System messages (e.g. "Alex joined as Coach") render as a centered grey pill,
  // WhatsApp-style: no avatar, no actions, no reactions.
  if (msg.is_system_message || isMembershipSystemText(msg.text)) {
    return (
      <div ref={rowRef} id={`message-${msg.id}`} className="flex justify-center my-2 px-4">
        <div className="max-w-[85%] rounded-full bg-muted/70 px-3 py-1 text-center text-[11px] text-muted-foreground">
          {msg.text}
        </div>
      </div>
    );
  }

  const isFreshlyInserted = (() => {
    const t = Date.parse(msg.created_at);
    if (!Number.isFinite(t)) return false;
    return Date.now() - t < 2000;
  })();

  return (
    <div
      ref={rowRef}
      id={`message-${msg.id}`}
      className={`flex ${isOwnMessage ? "justify-end" : "justify-start"} ${
        highlightedMessageId === msg.id ? "bg-primary/10 rounded-lg" : ""
      } ${isInteracting ? "relative z-[100000]" : ""} ${groupedWithPrev ? "-mt-3" : ""}`}
      style={{ overflowAnchor: 'none' }}
    >
      {isInteracting && createPortal(
        <div
          className="fixed inset-0 dark:bg-black/[0.18] bg-black/[0.22] z-[99999] animate-fade-in"
          style={{ animationDuration: '120ms' }}
          onClick={(e) => {
            // Ignore synthesized clicks within 400ms of reaction picker opening (iOS WebView)
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            closeActionUi();
          }}
          onTouchEnd={(e) => {
            // Ignore synthesized touch events within 400ms of reaction picker opening (iOS WebView)
            if (Date.now() - reactionPickerOpenedAtRef.current < 400) return;
            e.preventDefault();
            e.stopPropagation();
            closeActionUi();
          }}
        />,
        document.body
      )}
      <div className={`flex w-full min-w-0 gap-2 max-w-[85%] group ${isOwnMessage ? "flex-row-reverse" : ""}`}>
        {/* Outgoing messages never show the sender avatar — modern messaging
            apps rely on right-alignment + bubble colour for ownership cues. */}
        {!isOwnMessage && (
          groupedWithPrev ? (
            // Spacer keeps bubble aligned under the avatar of the first
            // message in the burst — matches Team/Club grouping behaviour.
            <div className="h-9 w-9 shrink-0" aria-hidden="true" />
          ) : (
            <Avatar className="h-9 w-9 shrink-0 ring-1 ring-black/[0.04] dark:ring-white/[0.06] shadow-[0_1px_2px_-1px_rgba(0,0,0,0.12)]">
              <AvatarImage src={avatarUrl} className="object-cover" />
              <AvatarFallback
                className="text-[13px] font-semibold tracking-tight"
                style={getAvatarFallbackStyle(displayName)}
              >
                {getAvatarInitial(displayName)}
              </AvatarFallback>
            </Avatar>
          )
        )}

        <div className={`flex w-full min-w-0 max-w-full flex-col ${isOwnMessage ? "items-end" : "items-start"}`}>
          {!isOwnMessage && !groupedWithPrev && (
            <div className="flex items-center gap-2 mb-1">
              <span className="text-[12px] font-semibold text-foreground/85 tracking-[-0.005em]">{displayName}</span>
              {msg.id.startsWith("queued-") && (
                <span className="flex items-center text-amber-500" title="Pending sync">
                  <Clock className="h-3 w-3" />
                </span>
              )}
              <span className="text-[11px] text-muted-foreground/75 tabular-nums tracking-tight">
                {format(new Date(msg.created_at), "HH:mm")}
                {msg.edited_at ? <span className="opacity-70"> · Edited</span> : null}
              </span>
            </div>
          )}

          <ReplyIndicator
            replyToMessage={replyPreview ? { text: replyPreview.text, authorName: replyPreview.author?.display_name || null } : null}
            hasReply={!!msg.reply_to_id}
            isOwn={isOwnMessage}
          />

          <div className="relative min-w-0 max-w-full group/msg">
            {/* Swipe indicator - text only, shown when past threshold */}
            {swipeState.pastThreshold && (
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
                className="min-w-0 max-w-full"
              style={{
                transform: swipeState.offsetX > 0 ? `translateX(${swipeState.offsetX}px)` : undefined,
                  transition: swipeState.isSwiping || swipeState.offsetX === 0 ? 'none' : 'transform 0.2s ease-out',
              }}
              onTouchStart={(e) => {
                gestureModeRef.current = "press";
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
                  : `relative max-w-full rounded-lg px-3 py-2 select-none overflow-hidden chat-bubble-stable ${
                  isOwnMessage ? "bg-chat-bubble-own text-chat-bubble-own-foreground" : "bg-muted"
                } ${tapFlash ? "ring-2 ring-primary/40" : ""} ${isInteracting ? "ring-1 ring-primary/40 border border-transparent transition-shadow duration-150 ease-out" : "border border-transparent"}`}
                style={isInteracting && !isCardOnlyMessage ? {
                  boxShadow: '0 24px 48px -18px rgba(0,0,0,0.52), 0 6px 14px -4px rgba(0,0,0,0.20)',
                } : undefined}

                onPointerDown={(e) => e.preventDefault()}
                onContextMenu={(e) => e.preventDefault()}
                onDragStart={(e) => e.preventDefault()}
              >
                {msg.forwarded_from_user_id && (() => {
                  const fwdName = getProfile(msg.forwarded_from_user_id)?.display_name;
                  return (
                    <div className={`flex items-center gap-1 text-[11px] italic mb-1 ${isOwnMessage ? "text-chat-bubble-own-foreground/70" : "text-muted-foreground"}`}>
                      <Forward className="h-3 w-3 shrink-0" />
                      <span className="truncate">
                        Forwarded{fwdName ? ` from ${fwdName}` : ""}
                        {msg.forwarded_source_label ? ` · ${msg.forwarded_source_label}` : ""}
                      </span>
                    </div>
                  );
                })()}
                <div className="text-sm min-w-0 max-w-full overflow-hidden">
                  <MessageContent
                    text={msg.text}
                    imageUrl={msg.image_url}
                    searchQuery={searchQuery}
                    showPreviews={false}
                    showImageActions={!isOwnMessage && !!msg.image_url}
                    onReportImage={() => setShowReportDialog(true)}
                    onBlockImageAuthor={() => setShowBlockDialog(true)}
                    onForwardImage={
                      allowForwarding && !msg.is_system_message && !msg.id.startsWith("temp-") && !msg.id.startsWith("queued-") && !!msg.image_url
                        ? () => setShowForwardSheet(true)
                        : undefined
                    }
                  />
                </div>
              </div>
            </div>
            {showTapHint && (
              <div
                className={`mt-1 px-1 text-[10.5px] text-muted-foreground/70 animate-fade-in ${
                  isOwnMessage ? "text-right" : "text-left"
                }`}
                role="status"
              >
                Hold for reactions &amp; replies
              </div>
            )}
          </div>
          {/* Inline "Add to gallery" chip — only on own image messages */}
          {isOwnMessage && msg.image_url && !msg.id.startsWith("queued-") && canPublishToGallery && onPublishToGallery && (
            <div className={`mt-1 flex h-7 items-center ${isOwnMessage ? "justify-end" : "justify-start"}`}>
              <button
                type="button"
                disabled={isPublishingToGallery || isPublishedToGallery}
                aria-busy={isPublishingToGallery || undefined}
                aria-disabled={isPublishingToGallery || isPublishedToGallery || undefined}
                onClick={(e) => {
                  e.stopPropagation();
                  if (isPublishingToGallery || isPublishedToGallery) return;
                  onPublishToGallery(msg.id, msg.image_url!);
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
          {/* Link previews rendered outside the message bubble */}
          <div className="w-full min-w-0 max-w-full self-stretch overflow-hidden">
            <MessageContent text={msg.text} previewsOnly />
          </div>

          {/* Unified two-block metadata to match Team chat (ChatMessage):
              line 1 = timestamp + inline "Sent" indicator (always),
              line 2 = reader avatars block (only when readers exist).
              Keeping the same vertical footprint as Team is what lets the
              shared `COMPOSER_GAP=32px` in ChatMessagesScroller land the
              bottom-of-thread at the same visual offset across chat types. */}
          {isOwnMessage && !groupedWithNext ? (
            <p className="text-[9.5px] leading-none text-muted-foreground/45 mt-0.5 flex items-baseline gap-1 justify-end whitespace-nowrap overflow-hidden tabular-nums tracking-tight pr-0.5">
              <span>{format(new Date(msg.created_at), "HH:mm")}</span>
              {msg.edited_at && frontierReaders.length > 0 ? <span className="opacity-70">· Edited</span> : null}
              {frontierReaders.length === 0 ? (
                <MessageReadIndicator readCount={readCounts[msg.id] || 0} isOwn={true} isEdited={!!msg.edited_at} />
              ) : null}
            </p>
          ) : null}
          {isOwnMessage && frontierReaders.length > 0 ? (
            <div className="cursor-pointer self-end pr-0.5" onClick={() => setShowReadReceipts(true)}>
              <MessageReadAvatars readers={frontierReaders} isOwn={true} />
            </div>
          ) : null}

          {isOwnMessage && (
            <ReadReceiptSheet
              open={showReadReceipts}
              onOpenChange={setShowReadReceipts}
              readers={frontierReaders}
              messageId={msg.id}
              messageType="group"
              contextId={groupId || msg.group_id}
              currentUserId={userId}
            />
          )}

          {messageReactions.length > 0 && (
            <GroupReactionBadges
              messageReactions={messageReactions}
              userId={userId}
              getProfile={getProfile}
              toggleReactionMutation={toggleReactionMutation}
              messageId={msg.id}
              isOwn={isOwnMessage}
            />
          )}

          <MessageReactionsPopover
            reactions={normalizedMessageReactions}
            currentUserId={userId}
            onReact={handleReactionPickerReact}
            onRemove={handleReactionPickerRemove}
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
            isOwnMessage={isOwnMessage}
            anchorRef={bubbleRef}
          />
        </div>
      </div>
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
            <AlertDialogAction onClick={() => { deleteMessageMutation.mutate(msg.id); setShowDeleteConfirm(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
        isOwn={isOwnMessage}
        canReply={true}
        canEdit={isOwnMessage}
        canDelete={isOwnMessage || isAdmin}
        messageText={msg.text}
        onReply={() => { handleReply(msg); closeActionUi(); }}
        onEdit={() => { handleEdit(msg); closeActionUi(); }}
        onDelete={() => { setShowDeleteConfirm(true); closeActionUi(); }}
        onReport={() => { setShowReportDialog(true); closeActionUi(); }}
        onBlock={() => { setShowBlockDialog(true); closeActionUi(); }}
        hasImage={!!msg.image_url}
        onViewImage={() => { setShowFullscreenImage(true); closeActionUi(); }}
        canPin={!!onPin || isPinned}
        isPinned={isPinned}
        pinLimitReached={pinLimitReached}
        onPin={onPin ? () => { onPin(msg.id); closeActionUi(); } : undefined}
        onUnpin={onUnpin ? () => { onUnpin(msg.id); closeActionUi(); } : undefined}
        canForward={allowForwarding && !msg.is_system_message && !msg.id.startsWith("temp-") && !msg.id.startsWith("queued-")}
        onForward={() => { setShowForwardSheet(true); closeActionUi(); }}
      />
      <ForwardMessageSheet
        open={showForwardSheet}
        onOpenChange={setShowForwardSheet}
        excludeGroupId={msg.group_id}
        source={{
          text: msg.text ?? "",
          imageUrl: msg.image_url,
          authorId: msg.author_id,
          sourceLabel: groupName ?? null,
        }}
      />
      {showFullscreenImage && msg.image_url && (
        <FullscreenImageViewer
          src={msg.image_url}
          alt="Attachment"
          onClose={() => setShowFullscreenImage(false)}
        />
      )}
      {showReportDialog && (
        <ReportMessageDialog
          isOpen={showReportDialog}
          onClose={() => setShowReportDialog(false)}
          messageId={msg.id}
          messageType="group"
        />
      )}
      {showBlockDialog && (
        <BlockUserDialog
          open={showBlockDialog}
          onOpenChange={setShowBlockDialog}
          userId={msg.author_id}
          userName={msg.author?.display_name || "this user"}
        />
      )}
    </div>
  );
});

function GroupReactionBadges({
  messageReactions,
  userId,
  getProfile,
  toggleReactionMutation,
  messageId,
  isOwn = false,
}: {
  messageReactions: any[];
  userId?: string;
  getProfile: (id: string) => { display_name: string | null; avatar_url: string | null } | null;
  toggleReactionMutation: { mutate: (args: { messageId: string; reactionType: string }) => void };
  messageId: string;
  isOwn?: boolean;
}) {
  const [viewingType, setViewingType] = useState<string | null>(null);
  const grouped = messageReactions.reduce((acc: any, r: any) => {
    const normalizedType = normalizeGroupReactionType(r.reaction_type);
    if (!acc[normalizedType]) acc[normalizedType] = [];
    acc[normalizedType].push(r);
    return acc;
  }, {} as Record<string, any[]>);

  const allUserIds = [...new Set(messageReactions.map((r: any) => r.user_id))];

  return (
    <>
      {/* WhatsApp/Messenger-style: pills sit just BELOW the bubble with a
          small consistent gap, hugging the sender side so they read as
          attached to the bubble without overlapping its shadow / rounded
          corners or the timestamp row that follows. */}
      <div
        className={`relative z-10 flex flex-wrap gap-[3px] mt-1 mb-1 px-0.5 ${
          isOwn ? "justify-end" : "justify-start"
        }`}
      >
        {Object.entries(grouped).map(([type, items]: [string, any[]]) => {
          const userReaction = items.find((r: any) => r.user_id === userId);
          const emoji = normalizeGroupReactionType(type);
          return (
            <button
              key={type}
              onClick={(e) => {
                e.stopPropagation();
                setViewingType(type);
              }}
              className={`inline-flex items-center gap-[3px] h-[22px] pl-1.5 pr-2 rounded-full text-[11px] leading-none border transition-colors shadow-[0_2px_4px_-2px_rgba(0,0,0,0.18)] ring-1 ring-background ${
                userReaction
                  ? "bg-primary/12 text-primary border-primary/30"
                  : "bg-card text-foreground/80 border-border/60 hover:bg-muted"
              }`}
            >
              <span className="text-[13px] leading-none -mt-px">{emoji}</span>
              {items.length > 1 && (
                <span className="tabular-nums font-semibold">{items.length}</span>
              )}
            </button>
          );
        })}
      </div>

      <GroupReactionsDialog
        messageReactions={messageReactions}
        grouped={grouped}
        allUserIds={allUserIds}
        userId={userId}
        getProfile={getProfile}
        toggleReactionMutation={toggleReactionMutation}
        messageId={messageId}
        viewingType={viewingType}
        onClose={() => setViewingType(null)}
        onChangeType={setViewingType}
      />
    </>
  );
}

function GroupReactionsDialog({
  messageReactions,
  grouped,
  allUserIds,
  userId,
  getProfile,
  toggleReactionMutation,
  messageId,
  viewingType,
  onClose,
  onChangeType,
}: {
  messageReactions: any[];
  grouped: Record<string, any[]>;
  allUserIds: string[];
  userId?: string;
  getProfile: (id: string) => { display_name: string | null; avatar_url: string | null } | null;
  toggleReactionMutation: { mutate: (args: { messageId: string; reactionType: string }) => void };
  messageId: string;
  viewingType: string | null;
  onClose: () => void;
  onChangeType: (type: string) => void;
}) {
  const initialUsers = (() => {
    const seeded: Array<{ id: string; display_name: string | null }> = [];
    for (const id of allUserIds) {
      const displayName = normalizeDisplayName(getProfile(id)?.display_name)
        || normalizeDisplayName(getProfileFromCache(id)?.display_name);
      if (displayName) seeded.push({ id, display_name: displayName });
    }
    return seeded;
  })();

  const { data: users = initialUsers } = useQuery({
    queryKey: ["group-reaction-users", allUserIds],
    queryFn: async () => {
      if (allUserIds.length === 0) return [];
      const map = await fetchProfilesWithCache(allUserIds);
      const unresolvedIds = allUserIds.filter((id) => !normalizeDisplayName(map.get(id)?.display_name));

      if (unresolvedIds.length > 0) {
        const { data, error } = await selectCachedProfilesByIds(unresolvedIds);
        if (error) throw error;
        if (data?.length) {
          cacheProfiles(data);
          for (const profile of data) {
            map.set(profile.id, { ...profile, cached_at: Date.now() });
          }
        }
      }

      return allUserIds.map((id) => ({
        id,
        display_name: normalizeDisplayName(map.get(id)?.display_name),
      }));
    },
    enabled: !!viewingType && allUserIds.length > 0,
    staleTime: 60_000,
    initialData: initialUsers.length === allUserIds.length && allUserIds.length > 0 ? initialUsers : undefined,
  });

  const getUserName = (uid: string) =>
    normalizeDisplayName(users.find((u: any) => u.id === uid)?.display_name)
      || normalizeDisplayName(getProfile(uid)?.display_name)
      || normalizeDisplayName(getProfileFromCache(uid)?.display_name)
      || "";

  const viewingReactors = viewingType ? (grouped[viewingType] || []) : [];
  const viewingEmoji = viewingType ? normalizeGroupReactionType(viewingType) : "";

  return (
    <Dialog open={!!viewingType} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-sm" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <span className="text-xl">{viewingEmoji}</span>
            <span>Reactions</span>
          </DialogTitle>
        </DialogHeader>

        {/* Reaction type tabs */}
        <div className="flex gap-1 pb-2 border-b">
          {Object.entries(grouped).map(([type, items]: [string, any[]]) => {
            const emoji = normalizeGroupReactionType(type);
            return (
              <Button
                key={type}
                variant={viewingType === type ? "secondary" : "ghost"}
                size="sm"
                onClick={() => onChangeType(type)}
                className="h-8 px-2 gap-1"
              >
                <span>{emoji}</span>
                <span className="text-xs">{items.length}</span>
              </Button>
            );
          })}
        </div>

        <ScrollArea className="max-h-[300px]">
          <div className="space-y-2">
            {viewingReactors.map((r: any) => {
              const isCurrentUser = r.user_id === userId;
              const name = getUserName(r.user_id);
              return (
                <div key={r.id || r.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/20 text-primary text-sm">
                      {name ? name.charAt(0).toUpperCase() : "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium flex-1 min-w-0">
                    {name ? (
                      <>
                        <span className="truncate inline-block max-w-full align-bottom">{name}</span>
                        {isCurrentUser && <span className="text-muted-foreground font-normal"> (you)</span>}
                      </>
                    ) : (
                      <span className="inline-block h-4 w-28 align-middle rounded bg-foreground/[0.06] animate-pulse" />
                    )}
                  </span>
                  {isCurrentUser && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleReactionMutation.mutate({ messageId, reactionType: r.reaction_type });
                        onClose();
                      }}
                      className="h-7 px-2 text-xs text-destructive hover:text-destructive"
                    >
                      Remove
                    </Button>
                  )}
                </div>
              );
            })}
            {viewingReactors.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-2">No reactions</p>
            )}
          </div>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
