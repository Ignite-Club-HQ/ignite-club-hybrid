import { memo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Smile } from "lucide-react";

const REACTION_EMOJIS = [
  { type: "like", emoji: "❤️" },
  { type: "fire", emoji: "🔥" },
  { type: "clap", emoji: "👏" },
  { type: "laugh", emoji: "😂" },
  { type: "thumbsup", emoji: "👍" },
  { type: "sad", emoji: "😢" },
];

interface Reaction {
  user_id: string;
  reaction_type: string;
  profiles?: { display_name: string | null; avatar_url: string | null } | null;
}

interface EmojiReactionsProps {
  reactions: Reaction[];
  currentUserId?: string;
  onReact: (reactionType: string) => void;
  onRemove: () => void;
}

export const EmojiReactions = memo(function EmojiReactions({ reactions, currentUserId, onReact, onRemove }: EmojiReactionsProps) {
  const [viewingReactionType, setViewingReactionType] = useState<string | null>(null);
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const userReaction = reactions.find((r) => r.user_id === currentUserId);
  
  // Group reactions by type
  const reactionCounts = reactions.reduce((acc, r) => {
    acc[r.reaction_type] = (acc[r.reaction_type] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Get users who reacted with a specific type
  const getReactorsForType = (type: string) => {
    return reactions.filter(r => r.reaction_type === type);
  };

  const handleEmojiClick = (type: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setIsPickerOpen(false);
    if (!currentUserId) return;
    if (userReaction?.reaction_type === type) {
      onRemove();
    } else {
      onReact(type);
    }
  };

  const handleViewReactors = (type: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setViewingReactionType(type);
  };

  const viewingReactors = viewingReactionType ? getReactorsForType(viewingReactionType) : [];
  const viewingEmoji = REACTION_EMOJIS.find(e => e.type === viewingReactionType)?.emoji || "";

  // Tap a reaction pill → open the reactors dialog (matches Instagram/Facebook
  // photo-feed conventions). Use the smile (+) picker to add or change your
  // own reaction. Long-press removes your reaction if it matches this pill.
  const longPressTimer = useRef<number | null>(null);
  const longPressFired = useRef(false);

  const clearLongPress = () => {
    if (longPressTimer.current !== null) {
      window.clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  };

  const handlePillPointerDown = (type: string) => {
    longPressFired.current = false;
    clearLongPress();
    longPressTimer.current = window.setTimeout(() => {
      longPressFired.current = true;
      if (currentUserId && userReaction?.reaction_type === type) {
        onRemove();
      }
    }, 500);
  };

  const handlePillClick = (type: string, e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    clearLongPress();
    if (longPressFired.current) {
      longPressFired.current = false;
      return;
    }
    setViewingReactionType(type);
  };

  return (
    <>
      <div className="flex items-center gap-2 flex-wrap">
        {/* Display existing reactions */}
        {Object.entries(reactionCounts).map(([type, count]) => {
          const emojiData = REACTION_EMOJIS.find((e) => e.type === type);
          if (!emojiData) return null;
          const isUserReaction = userReaction?.reaction_type === type;

          return (
            <Button
              key={type}
              variant="ghost"
              size="sm"
              onPointerDown={() => handlePillPointerDown(type)}
              onPointerUp={clearLongPress}
              onPointerLeave={clearLongPress}
              onPointerCancel={clearLongPress}
              onContextMenu={(e) => e.preventDefault()}
              onClick={(e) => handlePillClick(type, e)}
              className={`h-7 px-2 gap-1 text-sm select-none ${
                isUserReaction ? "bg-primary/20 hover:bg-primary/30" : "hover:bg-accent"
              }`}
              title="Tap to see who reacted, long-press to remove your reaction"
            >
              <span>{emojiData.emoji}</span>
              <span className="text-xs">{count}</span>
            </Button>
          );
        })}

        {/* Add reaction button */}
        <Popover open={isPickerOpen} onOpenChange={setIsPickerOpen}>
          <PopoverTrigger asChild>
            <Button variant="ghost" size="sm" className="h-7 w-7 p-0">
              <Smile className="h-4 w-4" />
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-2" align="start">
            <div className="flex gap-1">
              {REACTION_EMOJIS.map(({ type, emoji }) => (
                <Button
                  key={type}
                  variant="ghost"
                  size="sm"
                  onClick={(e) => handleEmojiClick(type, e)}
                  className={`h-8 w-8 p-0 text-lg ${
                    userReaction?.reaction_type === type ? "bg-primary/20" : ""
                  }`}
                >
                  {emoji}
                </Button>
              ))}
            </div>
          </PopoverContent>
        </Popover>

      </div>

      {/* Reactors Dialog */}
      <Dialog open={!!viewingReactionType} onOpenChange={(open) => !open && setViewingReactionType(null)}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <span className="text-xl">{viewingEmoji}</span>
              <span>Reactions</span>
            </DialogTitle>
          </DialogHeader>
          
          {/* Reaction type tabs */}
          <div className="flex gap-1 pb-2 border-b">
            {Object.entries(reactionCounts).map(([type, count]) => {
              const emojiData = REACTION_EMOJIS.find((e) => e.type === type);
              if (!emojiData) return null;
              return (
                <Button
                  key={type}
                  variant={viewingReactionType === type ? "secondary" : "ghost"}
                  size="sm"
                  onClick={() => setViewingReactionType(type)}
                  className="h-8 px-2 gap-1"
                >
                  <span>{emojiData.emoji}</span>
                  <span className="text-xs">{count}</span>
                </Button>
              );
            })}
          </div>

          <ScrollArea className="max-h-[300px]">
            <div className="space-y-2">
              {viewingReactors.map((reactor) => {
                const isCurrentUser = reactor.user_id === currentUserId;
                return (
                  <div key={reactor.user_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-accent/50">
                    <Avatar className="h-8 w-8">
                      <AvatarImage src={reactor.profiles?.avatar_url || undefined} />
                      <AvatarFallback className="bg-primary/20 text-primary text-sm">
                        {reactor.profiles?.display_name?.charAt(0)?.toUpperCase() || "?"}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-sm font-medium flex-1">
                      {reactor.profiles?.display_name || "Unknown User"}
                      {isCurrentUser && <span className="text-muted-foreground font-normal"> (you)</span>}
                    </span>
                    {isCurrentUser && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          onRemove();
                          setViewingReactionType(null);
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
    </>
  );
});

export function getEmojiForType(type: string): string {
  return REACTION_EMOJIS.find((e) => e.type === type)?.emoji || "❤️";
}