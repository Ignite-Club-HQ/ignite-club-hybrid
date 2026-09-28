import { useState, useRef, useCallback, useEffect, memo } from "react";
import { createPortal } from "react-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, X } from "lucide-react";
import { formatTimeShort } from "@/lib/formatTimeShort";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useBlockedUsers } from "@/hooks/useBlockedUsers";
import { BlockUserDialog } from "@/components/BlockUserDialog";
import { ReportCommentDialog } from "@/components/ReportCommentDialog";
import { CommentReactionsDisplay } from "@/components/CommentReactionsDisplay";
import { MessageActionSheet } from "@/components/chat/MessageActionSheet";
import { MessageReactionsPopover } from "@/components/chat/MessageReactions";
import { useLongPressDismissGuard } from "@/hooks/useLongPressDismissGuard";
import { hapticImpactLight, hapticSelectionTick } from "@/lib/haptics";
import { renderTextWithMentions } from "@/lib/photoCommentMentions";

const REACTION_EMOJIS = [
  { type: "like", emoji: "❤️" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "laugh", emoji: "😂" },
  { type: "thumbsup", emoji: "👍" },
  { type: "sad", emoji: "😢" },
];

interface CommentReaction {
  id: string;
  user_id: string;
  reaction_type: string;
}

interface PhotoCommentProps {
  id: string;
  text: string;
  userId: string;
  displayName?: string | null;
  avatarUrl?: string | null;
  currentUserId?: string;
  replyToName?: string | null;
  onReply?: (commentId: string, displayName: string) => void;
  isReply?: boolean;
  createdAt?: string;
  onInteractionChange?: (active: boolean) => void;
  onLongPressGestureStateChange?: (active: boolean) => void;
}

export const PhotoComment = memo(function PhotoComment({
  id,
  text,
  userId,
  displayName,
  avatarUrl,
  currentUserId,
  replyToName,
  onReply,
  isReply = false,
  createdAt,
  onInteractionChange,
  onLongPressGestureStateChange,
}: PhotoCommentProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState(text);
  const [displayText, setDisplayText] = useState(text);
  const [showReactionPicker, setShowReactionPicker] = useState(false);
  const [showActionSheet, setShowActionSheet] = useState(false);
  const [showMenu, setShowMenu] = useState(false);
  const [showBlockDialog, setShowBlockDialog] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [tapFlash, setTapFlash] = useState(false);
  const [optimisticReactions, setOptimisticReactions] = useState<CommentReaction[]>([]);
  const longPressTimer = useRef<NodeJS.Timeout | null>(null);
  const touchStartPos = useRef<{ x: number; y: number } | null>(null);
  const commentRef = useRef<HTMLDivElement>(null);
  const longPressTriggeredRef = useRef(false);
  const gestureModeRef = useRef<"idle" | "press">("idle");
  const reactionPickerOpenedAtRef = useRef(0);
  const optimisticReactionsRef = useRef<CommentReaction[]>([]);
  const isReactionMutatingRef = useRef(false);
  const queryClient = useQueryClient();
  const isOwn = userId === currentUserId;
  const { isBlocked } = useBlockedUsers();
  const {
    armDismissGuard,
    clearDismissGuard,
    consumeContextMenuGuard,
    preventIfGuarded,
  } = useLongPressDismissGuard();

  const { data: reactions = [] } = useQuery({
    queryKey: ["comment-reactions", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("photo_comment_reactions")
        .select("id, user_id, reaction_type")
        .eq("comment_id", id);

      if (error) throw error;
      return data as CommentReaction[];
    },
  });

  const isInteracting = showMenu || showReactionPicker || showActionSheet;

  const writeReactions = useCallback((next: CommentReaction[]) => {
    optimisticReactionsRef.current = next;
    setOptimisticReactions(next);
    queryClient.setQueryData(["comment-reactions", id], next);
  }, [id, queryClient]);

  useEffect(() => {
    if (isReactionMutatingRef.current) return;
    writeReactions(reactions);
  }, [reactions, writeReactions]);

  const getLatestReactions = useCallback(() => {
    return (
      queryClient.getQueryData<CommentReaction[]>(["comment-reactions", id]) ??
      optimisticReactionsRef.current
    );
  }, [id, queryClient]);

  const reactionMutation = useMutation({
    mutationFn: async ({
      reactionType,
      existingReaction,
    }: {
      reactionType: string;
      existingReaction?: CommentReaction;
    }) => {
      if (!currentUserId) {
        throw new Error("Not authenticated");
      }

      if (existingReaction) {
        if (existingReaction.reaction_type === reactionType) {
          const { error } = await supabase
            .from("photo_comment_reactions")
            .delete()
            .eq("id", existingReaction.id);

          if (error) throw error;
          return { action: "delete" as const, reactionId: existingReaction.id };
        }

        const { data: updatedReaction, error } = await supabase
          .from("photo_comment_reactions")
          .update({ reaction_type: reactionType })
          .eq("id", existingReaction.id)
          .select("id, user_id, reaction_type")
          .single();

        if (error) throw error;
        return { action: "update" as const, reaction: updatedReaction as CommentReaction };
      }

      const { data: insertedReaction, error } = await supabase
        .from("photo_comment_reactions")
        .insert({
          comment_id: id,
          user_id: currentUserId,
          reaction_type: reactionType,
        })
        .select("id, user_id, reaction_type")
        .single();

      if (error) {
        if ((error as { code?: string }).code === "23505") {
          const { data: conflictingReaction, error: conflictFetchError } = await supabase
            .from("photo_comment_reactions")
            .select("id, user_id, reaction_type")
            .eq("comment_id", id)
            .eq("user_id", currentUserId)
            .maybeSingle();

          if (conflictFetchError || !conflictingReaction) {
            throw conflictFetchError || error;
          }

          const { data: updatedReaction, error: updateError } = await supabase
            .from("photo_comment_reactions")
            .update({ reaction_type: reactionType })
            .eq("id", conflictingReaction.id)
            .select("id, user_id, reaction_type")
            .single();

          if (updateError) throw updateError;
          return { action: "update" as const, reaction: updatedReaction as CommentReaction };
        }

        throw error;
      }

      return { action: "insert" as const, reaction: insertedReaction as CommentReaction };
    },
    onMutate: async ({ reactionType, existingReaction }) => {
      isReactionMutatingRef.current = true;
      await queryClient.cancelQueries({ queryKey: ["comment-reactions", id] });

      const previousReactions = getLatestReactions();

      if (existingReaction?.reaction_type === reactionType) {
        writeReactions(previousReactions.filter((reaction) => reaction.user_id !== currentUserId));
      } else if (existingReaction) {
        writeReactions(
          previousReactions.map((reaction) =>
            reaction.user_id === currentUserId
              ? { ...reaction, reaction_type: reactionType }
              : reaction
          )
        );
      } else {
        writeReactions([
          ...previousReactions.filter((reaction) => reaction.user_id !== currentUserId),
          {
            id: `temp-${Date.now()}`,
            user_id: currentUserId!,
            reaction_type: reactionType,
          },
        ]);
      }

      return { previousReactions };
    },
    onError: (_error, _variables, context) => {
      writeReactions(context?.previousReactions ?? []);
      toast.error("Failed to update reaction");
    },
    onSuccess: (result) => {
      const currentReactions = getLatestReactions();

      if (result.action === "delete") {
        writeReactions(
          currentReactions.filter(
            (reaction) => reaction.id !== result.reactionId && reaction.user_id !== currentUserId
          )
        );
        return;
      }

      writeReactions([
        ...currentReactions.filter((reaction) => reaction.user_id !== result.reaction.user_id),
        result.reaction,
      ]);
    },
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: ["comment-reactions", id] });
      isReactionMutatingRef.current = false;
    },
  });

  const handleReactionClick = useCallback((type: string) => {
    if (!currentUserId || reactionMutation.isPending) return;

    clearDismissGuard();
    setShowReactionPicker(false);
    setShowMenu(false);
    setShowActionSheet(false);

    const existingReaction = getLatestReactions().find((reaction) => reaction.user_id === currentUserId);

    reactionMutation.mutate({
      reactionType: type,
      existingReaction,
    });
  }, [clearDismissGuard, currentUserId, getLatestReactions, reactionMutation]);

  const handleRemoveReaction = useCallback((reactionId: string) => {
    if (!currentUserId || reactionMutation.isPending) return;

    const existingReaction = getLatestReactions().find(
      (reaction) => reaction.id === reactionId && reaction.user_id === currentUserId
    );

    if (!existingReaction) return;

    clearDismissGuard();
    setShowReactionPicker(false);
    setShowMenu(false);
    setShowActionSheet(false);

    reactionMutation.mutate({
      reactionType: existingReaction.reaction_type,
      existingReaction,
    });
  }, [clearDismissGuard, currentUserId, getLatestReactions, reactionMutation]);

  const editMutation = useMutation({
    mutationFn: async (newText: string) => {
      const { error } = await supabase
        .from("photo_comments")
        .update({ text: newText })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, newText) => {
      setDisplayText(newText);
      queryClient.invalidateQueries({ queryKey: ["all-photo-comments"] });
      setIsEditing(false);
      toast.success("Comment updated");
    },
    onError: () => {
      toast.error("Failed to update comment");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("photo_comments")
        .delete()
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["all-photo-comments"] });
      toast.success("Comment deleted");
    },
    onError: () => {
      toast.error("Failed to delete comment");
    },
  });

  const handleSave = () => {
    if (editText.trim() && editText !== text) {
      editMutation.mutate(editText.trim());
    } else {
      setIsEditing(false);
      setEditText(text);
    }
  };

  const handleLongPressStart = useCallback((e: React.TouchEvent) => {
    gestureModeRef.current = "press";
    longPressTriggeredRef.current = false;
    touchStartPos.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
    onLongPressGestureStateChange?.(true);

    longPressTimer.current = setTimeout(() => {
      if (gestureModeRef.current !== "press") return;
      longPressTriggeredRef.current = true;
      armDismissGuard();
      hapticImpactLight();
      reactionPickerOpenedAtRef.current = Date.now();
      setShowMenu(true);
      setShowReactionPicker(true);
    }, 400);
  }, [armDismissGuard]);

  // Prevent focus steal on the comment bubble so keyboard stays open
  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    // Don't let the browser move focus away from the active textarea
    e.preventDefault();
  }, []);

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (longPressTriggeredRef.current || showReactionPicker) {
      e.preventDefault();
      e.stopPropagation();
      return;
    }

    if (!touchStartPos.current) return;

    const dx = e.touches[0].clientX - touchStartPos.current.x;
    const dy = e.touches[0].clientY - touchStartPos.current.y;

    if (longPressTimer.current && (Math.abs(dx) > 10 || Math.abs(dy) > 10)) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
      touchStartPos.current = null;
      gestureModeRef.current = "idle";
      onLongPressGestureStateChange?.(false);
    }
  }, [onLongPressGestureStateChange, showReactionPicker]);

  const handleLongPressEnd = useCallback((e: React.TouchEvent) => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }

    const recentlyOpenedPicker = Date.now() - reactionPickerOpenedAtRef.current < 600;

    if (longPressTriggeredRef.current || recentlyOpenedPicker) {
      e.preventDefault();
      e.stopPropagation();
      armDismissGuard();
      reactionPickerOpenedAtRef.current = Date.now();
      requestAnimationFrame(() => {
        longPressTriggeredRef.current = false;
      });
    } else if (gestureModeRef.current === "press" && touchStartPos.current) {
      e.preventDefault();
      e.stopPropagation();
      setTapFlash(true);
      hapticSelectionTick();
      setTimeout(() => {
        setTapFlash(false);
        setShowMenu(true);
        setShowActionSheet(true);
      }, 200);

      onLongPressGestureStateChange?.(false);
    }

    touchStartPos.current = null;
    gestureModeRef.current = "idle";
  }, [armDismissGuard, onLongPressGestureStateChange]);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (consumeContextMenuGuard()) return;
    onLongPressGestureStateChange?.(true);
    setShowMenu(true);
    setShowReactionPicker(true);
  }, [consumeContextMenuGuard, onLongPressGestureStateChange]);

  const closeInteraction = useCallback(() => {
    clearDismissGuard();
    setShowReactionPicker(false);
    setShowActionSheet(false);
    setShowMenu(false);
    onLongPressGestureStateChange?.(false);
  }, [clearDismissGuard, onLongPressGestureStateChange]);

  useEffect(() => {
    onInteractionChange?.(isInteracting);
    return () => {
      onInteractionChange?.(false);
      onLongPressGestureStateChange?.(false);
    };
  }, [isInteracting, onInteractionChange, onLongPressGestureStateChange]);

  if (isEditing) {
    return (
      <div className={`flex gap-2 items-center ${isReply ? "ml-8" : ""}`}>
        <Avatar className="h-6 w-6">
          <AvatarImage src={avatarUrl || undefined} />
          <AvatarFallback className="text-xs">
            {displayName?.[0] || "?"}
          </AvatarFallback>
        </Avatar>
        <Input
          value={editText}
          onChange={(e) => setEditText(e.target.value)}
          className="flex-1 h-7 text-sm"
          autoFocus
          onKeyDown={(e) => {
            if (e.key === "Enter") handleSave();
            if (e.key === "Escape") {
              setIsEditing(false);
              setEditText(text);
            }
          }}
        />
        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={handleSave}>
          <Check className="h-3 w-3" />
        </Button>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={() => {
            setIsEditing(false);
            setEditText(text);
          }}
        >
          <X className="h-3 w-3" />
        </Button>
      </div>
    );
  }

  if (!isOwn && isBlocked(userId)) return null;

  return (
    <div className={`flex flex-col gap-1 ${isReply ? "ml-8" : ""} ${isInteracting ? "relative z-[100000]" : ""}`}>
      {isInteracting && createPortal(
        <div
          className="fixed inset-0 dark:bg-black/[0.22] bg-black/[0.28] z-[99999] animate-fade-in pointer-events-none"
          style={{ animationDuration: "120ms" }}
          onPointerDown={(e) => e.preventDefault()}
        />,
        document.body
      )}
      <div className="flex gap-2.5">
        <Avatar className="h-8 w-8">
          <AvatarImage src={avatarUrl || undefined} />
          <AvatarFallback className="text-xs">
            {displayName?.[0] || "?"}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1">
          <div
            ref={commentRef}
            className={`select-none rounded-lg px-2 py-1 transition-colors duration-100 touch-manipulation ${
              tapFlash ? "bg-muted/60" : ""
            } ${isInteracting ? "bg-muted/40 ring-1 ring-border/50" : ""}`}
            onPointerDown={handlePointerDown}
            onTouchStart={handleLongPressStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleLongPressEnd}
            onContextMenu={handleContextMenu}
          >
            {replyToName && (
              <p className="text-xs text-muted-foreground mb-0.5">
                ↳ Replying to {replyToName}
              </p>
            )}
            <p className="text-sm break-words">
              <span className="font-semibold">{displayName}</span>{" "}
              {renderTextWithMentions(displayText)}
              {createdAt && (
                <span className="text-xs text-muted-foreground ml-2">
                  · {formatTimeShort(createdAt)}
                </span>
              )}
            </p>
            <MessageReactionsPopover
              reactions={optimisticReactions}
              currentUserId={currentUserId}
              onReact={handleReactionClick}
              onRemove={handleRemoveReaction}
              isMutating={reactionMutation.isPending}
              isOpen={showReactionPicker}
              preventIfGuarded={preventIfGuarded}
              onOpenChange={(open) => {
                if (open) {
                  setShowMenu(true);
                  setShowReactionPicker(true);
                  return;
                }
                closeInteraction();
              }}
              isOwnMessage={isOwn}
              anchorRef={commentRef}
            />
          </div>
          <CommentReactionsDisplay
            reactions={optimisticReactions}
            currentUserId={currentUserId}
            onReactionClick={handleReactionClick}
          />
        </div>
      </div>

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
        canReply={!!onReply}
        canEdit={isOwn}
        canDelete={isOwn}
        isSystemMessage={false}
        onReply={() => onReply?.(id, displayName || "Unknown")}
        onEdit={() => setIsEditing(true)}
        onDelete={() => setShowDeleteConfirm(true)}
        onReport={() => setShowReportDialog(true)}
        onBlock={() => setShowBlockDialog(true)}
      />

      {showBlockDialog && (
        <BlockUserDialog
          open={showBlockDialog}
          onOpenChange={setShowBlockDialog}
          userId={userId}
          userName={displayName || "this user"}
        />
      )}
      {showReportDialog && (
        <ReportCommentDialog
          isOpen={showReportDialog}
          onClose={() => setShowReportDialog(false)}
          commentId={id}
        />
      )}
      <AlertDialog open={showDeleteConfirm} onOpenChange={setShowDeleteConfirm}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete comment?</AlertDialogTitle>
            <AlertDialogDescription>
              This action cannot be undone. This comment will be permanently deleted.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => { deleteMutation.mutate(); setShowDeleteConfirm(false); }} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
});

export { REACTION_EMOJIS };
export type { CommentReaction };
