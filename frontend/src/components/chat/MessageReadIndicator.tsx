import { memo } from "react";
import { Eye } from "lucide-react";

interface MessageReadIndicatorProps {
  readCount: number;
  isOwn: boolean;
  readerName?: string | null;
  /** True when the message text has been edited since it was sent. */
  isEdited?: boolean;
}

/**
 * Compact inline read state shown next to a timestamp when avatar clusters
 * aren't available (e.g. non-last own messages). Uses warm, human phrasing
 * ("Seen by …") with a small eye glyph to feel social rather than technical.
 * Deliberately avoids WhatsApp-style ticks.
 */
export const MessageReadIndicator = memo(function MessageReadIndicator({
  readCount,
  isOwn,
  readerName,
  isEdited = false,
}: MessageReadIndicatorProps) {
  if (!isOwn) return null;

  if (readCount <= 0) {
    return (
      <span className="text-[11px] leading-none text-muted-foreground/70 tracking-tight">
        {isEdited ? "Edited" : "Sent"}
      </span>
    );
  }

  const label = readerName
    ? `Seen by ${readerName.split(" ")[0]}`
    : `Seen by ${readCount}`;

  return (
    <span className="inline-flex items-center gap-0.5 text-[11px] leading-none text-muted-foreground/80 tracking-tight">
      <Eye className="h-3 w-3 opacity-80" strokeWidth={2.25} />
      {label}
      {isEdited ? <span className="opacity-70"> · Edited</span> : null}
    </span>

  );
});
