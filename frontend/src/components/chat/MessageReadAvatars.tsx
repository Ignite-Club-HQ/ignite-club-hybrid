import { memo } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import type { ReaderInfo } from "@/hooks/useMessageReads";
import { getAvatarFallbackStyle, getAvatarInitial } from "@/lib/avatarColor";

interface MessageReadAvatarsProps {
  readers: ReaderInfo[];
  isOwn: boolean;
}

/**
 * Social, human read receipts: overlapping reader avatars with a soft
 * "Seen by …" label. Replaces letter-only chips with gradient-fallback
 * avatars consistent with the rest of the chat surface. Compact and
 * secondary to the message itself; expansion (ReadReceiptSheet) is
 * handled by the parent.
 */
export const MessageReadAvatars = memo(function MessageReadAvatars({
  readers,
  isOwn,
}: MessageReadAvatarsProps) {
  if (readers.length === 0) return null;

  const visible = readers.slice(0, 4);
  const overflow = readers.length - visible.length;

  const label = readers.length === 1
    ? `Seen by ${(readers[0].display_name || "1 person").split(" ")[0]}`
    : `Seen by ${readers.length}`;

  return (
    <div
      className={`flex items-center gap-1.5 mt-0.5 px-0.5 ${isOwn ? "justify-end" : ""}`}
    >
      <div className="flex items-center -space-x-1.5">
        {visible.map((reader) => {
          const name = reader.display_name || "?";
          return (
            <Avatar
              key={reader.user_id}
              className="h-[18px] w-[18px] ring-1 ring-background shadow-[0_1px_2px_-1px_rgba(0,0,0,0.18)]"
              title={reader.display_name || undefined}
            >
              <AvatarImage src={reader.avatar_url || undefined} />
              <AvatarFallback
                className="text-[9px] font-medium"
                style={getAvatarFallbackStyle(name)}
              >
                {getAvatarInitial(name)}
              </AvatarFallback>
            </Avatar>
          );
        })}
        {overflow > 0 && (
          <span className="inline-flex items-center justify-center h-[18px] min-w-[18px] px-1 rounded-full bg-muted text-muted-foreground/80 text-[9px] font-medium ring-1 ring-background">
            +{overflow}
          </span>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground/80 tracking-tight tabular-nums">
        {label}
      </span>

    </div>
  );
});
