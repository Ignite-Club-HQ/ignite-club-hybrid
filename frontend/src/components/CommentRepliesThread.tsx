import { useState, memo } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PhotoComment } from "./PhotoComment";

interface Reply {
  id: string;
  text: string;
  user_id: string;
  created_at?: string;
  profiles?: {
    display_name?: string | null;
    avatar_url?: string | null;
  };
}

interface CommentRepliesThreadProps {
  replies: Reply[];
  parentDisplayName?: string | null;
  currentUserId?: string;
  onReply: (commentId: string, name: string) => void;
  initialVisibleCount?: number;
  onInteractionChange?: (active: boolean) => void;
  onLongPressGestureStateChange?: (active: boolean) => void;
}

export const CommentRepliesThread = memo(function CommentRepliesThread({
  replies,
  parentDisplayName,
  currentUserId,
  onReply,
  initialVisibleCount = 2,
  onInteractionChange,
  onLongPressGestureStateChange,
}: CommentRepliesThreadProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (replies.length === 0) return null;

  const shouldCollapse = replies.length > initialVisibleCount;
  const visibleReplies = shouldCollapse && !isExpanded 
    ? replies.slice(0, initialVisibleCount) 
    : replies;
  const hiddenCount = replies.length - initialVisibleCount;

  return (
    <div className="space-y-1">
      {visibleReplies.map((reply) => (
        <PhotoComment
          key={reply.id}
          id={reply.id}
          text={reply.text}
          userId={reply.user_id}
          displayName={reply.profiles?.display_name}
          avatarUrl={reply.profiles?.avatar_url}
          currentUserId={currentUserId}
          replyToName={parentDisplayName}
          createdAt={reply.created_at}
          isReply
          onReply={onReply}
          onInteractionChange={onInteractionChange}
          onLongPressGestureStateChange={onLongPressGestureStateChange}
        />
      ))}
      
      {shouldCollapse && (
        <Button
          variant="ghost"
          size="sm"
          className="ml-8 h-6 text-xs text-muted-foreground hover:text-foreground"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? (
            <>
              <ChevronUp className="h-3 w-3 mr-1" />
              Hide replies
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3 mr-1" />
              View {hiddenCount} more {hiddenCount === 1 ? "reply" : "replies"}
            </>
          )}
        </Button>
      )}
    </div>
  );
});