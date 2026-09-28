import { memo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { supabase } from "@/integrations/supabase/client";
import { selectCachedProfilesByIds } from "@/lib/profileCache";

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

interface CommentReactionsDisplayProps {
  reactions: CommentReaction[];
  currentUserId?: string;
  onReactionClick: (type: string) => void;
}

export const CommentReactionsDisplay = memo(function CommentReactionsDisplay({
  reactions,
  currentUserId,
  onReactionClick,
}: CommentReactionsDisplayProps) {
  const [viewingType, setViewingType] = useState<string | null>(null);

  // Long-press opens the reactors dialog; a plain tap toggles the user's
  // own reaction. Opening a Radix Dialog on every tap caused Android
  // WebView to scroll the page up due to body scroll-lock + focus trap.
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  if (!reactions || reactions.length === 0) return null;

  const reactionCounts = reactions.reduce((acc, r) => {
    if (!acc[r.reaction_type]) {
      acc[r.reaction_type] = { count: 0, userIds: [] };
    }
    acc[r.reaction_type].count++;
    acc[r.reaction_type].userIds.push(r.user_id);
    return acc;
  }, {} as Record<string, { count: number; userIds: string[] }>);

  return (
    <>
      <div className="flex flex-wrap gap-1 mt-1">
        {Object.entries(reactionCounts).map(([type, { count }]) => {
          const emoji = REACTION_EMOJIS.find((e) => e.type === type)?.emoji || "❤️";
          const isUserReaction = reactions.some(
            (r) => r.user_id === currentUserId && r.reaction_type === type
          );
          return (
            <button
              key={type}
              onPointerDown={() => {
                longPressFired.current = false;
                clearLongPress();
                longPressTimer.current = window.setTimeout(() => {
                  longPressFired.current = true;
                  setViewingType(type);
                }, 500);
              }}
              onPointerUp={clearLongPress}
              onPointerLeave={clearLongPress}
              onPointerCancel={clearLongPress}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                clearLongPress();
                if (longPressFired.current) {
                  longPressFired.current = false;
                  return;
                }
                onReactionClick(type);
              }}
              aria-label={`${emoji} ${type} reaction, ${count} ${count === 1 ? 'person' : 'people'}${isUserReaction ? ', you reacted' : ''}`}
              aria-pressed={isUserReaction}
              title="Tap to toggle, long-press to view who reacted"
              className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded-full text-xs select-none ${
                isUserReaction
                  ? "bg-primary/20 border border-primary/40"
                  : "bg-muted/50 hover:bg-muted"
              }`}
            >
              <span aria-hidden="true">{emoji}</span>
              <span className="text-muted-foreground">{count}</span>
            </button>
          );
        })}
      </div>

      <CommentReactionUsersDialog
        reactions={reactions}
        reactionCounts={reactionCounts}
        currentUserId={currentUserId}
        viewingType={viewingType}
        onClose={() => setViewingType(null)}
        onChangeType={setViewingType}
        onRemoveReaction={onReactionClick}
      />
    </>
  );
});

const CommentReactionUsersDialog = memo(function CommentReactionUsersDialog({
  reactions,
  reactionCounts,
  currentUserId,
  viewingType,
  onClose,
  onChangeType,
  onRemoveReaction,
}: {
  reactions: CommentReaction[];
  reactionCounts: Record<string, { count: number; userIds: string[] }>;
  currentUserId?: string;
  viewingType: string | null;
  onClose: () => void;
  onChangeType: (type: string) => void;
  onRemoveReaction: (type: string) => void;
}) {
  const allUserIds = [...new Set(reactions.map(r => r.user_id))];

  const { data: users = [] } = useQuery({
    queryKey: ["comment-reaction-users", allUserIds],
    queryFn: async () => {
      if (allUserIds.length === 0) return [];
      const { data, error } = await selectCachedProfilesByIds(allUserIds);
      if (error) throw error;
      return data;
    },
    enabled: !!viewingType && allUserIds.length > 0,
  });

  const viewingReactors = viewingType
    ? reactions.filter(r => r.reaction_type === viewingType)
    : [];

  const viewingEmoji = REACTION_EMOJIS.find(e => e.type === viewingType)?.emoji || "";

  const getUserName = (userId: string) =>
    users.find(u => u.id === userId)?.display_name || "Unknown User";

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
          {Object.entries(reactionCounts).map(([type, { count }]) => {
            const emoji = REACTION_EMOJIS.find((e) => e.type === type)?.emoji || "❤️";
            return (
              <Button
                key={type}
                variant={viewingType === type ? "secondary" : "ghost"}
                size="sm"
                onClick={() => onChangeType(type)}
                className="h-8 px-2 gap-1"
              >
                <span>{emoji}</span>
                <span className="text-xs">{count}</span>
              </Button>
            );
          })}
        </div>

        <ScrollArea className="max-h-[300px]">
          <div className="space-y-2">
            {viewingReactors.map((r) => {
              const isCurrentUser = r.user_id === currentUserId;
              return (
                <div key={r.id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/20 text-primary text-sm">
                      {getUserName(r.user_id)?.charAt(0)?.toUpperCase() || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <span className="text-sm font-medium flex-1">
                    {getUserName(r.user_id)}
                    {isCurrentUser && <span className="text-muted-foreground font-normal"> (you)</span>}
                  </span>
                  {isCurrentUser && (
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={(e) => {
                        e.stopPropagation();
                        onRemoveReaction(r.reaction_type);
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
});
