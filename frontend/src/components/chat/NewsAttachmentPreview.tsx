import { Newspaper, X } from "lucide-react";
import { useClubNewsPost } from "@/features/news/useClubNews";

interface NewsAttachmentPreviewProps {
  newsId: string;
  onRemove: () => void;
  disabled?: boolean;
}

/**
 * Compact preview card shown above the chat composer when a Club News post
 * is attached. Mirrors PollAttachmentPreview so the raw [news:uuid] token
 * never appears in the message input.
 */
export function NewsAttachmentPreview({ newsId, onRemove, disabled }: NewsAttachmentPreviewProps) {
  const { data } = useClubNewsPost(newsId);

  return (
    <div className="flex items-center gap-2 rounded-xl bg-background/70 dark:bg-background/40 border border-border/40 px-2 py-1.5">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-primary/15 text-primary">
        <Newspaper className="h-4 w-4" strokeWidth={2.25} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold text-foreground leading-tight">
          {data?.title || "News post attached"}
        </p>
        <p className="truncate text-[11px] text-muted-foreground leading-tight">
          Club News · Tap send to share
        </p>
      </div>
      <button
        type="button"
        onClick={onRemove}
        disabled={disabled}
        aria-label="Remove news attachment"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-muted-foreground hover:bg-muted hover:text-foreground transition-colors disabled:opacity-50"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
