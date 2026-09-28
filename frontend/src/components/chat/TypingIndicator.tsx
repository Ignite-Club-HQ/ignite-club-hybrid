import { memo } from "react";

interface TypingIndicatorProps {
  typingUsers: { id: string; name: string }[];
}

export const TypingIndicator = memo(function TypingIndicator({
  typingUsers,
}: TypingIndicatorProps) {
  if (typingUsers.length === 0) return null;

  const getText = () => {
    if (typingUsers.length === 1) {
      return `${typingUsers[0].name} is typing`;
    }
    if (typingUsers.length === 2) {
      return `${typingUsers[0].name} and ${typingUsers[1].name} are typing`;
    }
    return `${typingUsers[0].name} and ${typingUsers.length - 1} others are typing`;
  };

  return (
    <div className="flex items-center gap-2 px-2 py-1 text-xs text-muted-foreground">
      <div className="flex gap-1">
        <span className="animate-bounce" style={{ animationDelay: "0ms" }}>•</span>
        <span className="animate-bounce" style={{ animationDelay: "150ms" }}>•</span>
        <span className="animate-bounce" style={{ animationDelay: "300ms" }}>•</span>
      </div>
      <span>{getText()}</span>
    </div>
  );
});
