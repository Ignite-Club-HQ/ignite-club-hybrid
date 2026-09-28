import { useNavigate } from "react-router-dom";
import { memo, useCallback } from "react";
import { Newspaper } from "lucide-react";
import { format, parseISO } from "date-fns";
import { Skeleton } from "@/components/ui/skeleton";
import { useClubNewsPost } from "@/features/news/useClubNews";
import { stripAttachmentTokens } from "@/features/news/newsAttachments";

interface NewsLinkCardProps {
  newsId: string;
}

/**
 * Chat card for a shared Club News post ([news:uuid] token).
 * Visibility is enforced by club_news RLS — members who are not in the
 * post's audience simply see the "not available" placeholder.
 */
export const NewsLinkCard = memo(function NewsLinkCard({ newsId }: NewsLinkCardProps) {
  const navigate = useNavigate();
  const { data: post, isLoading } = useClubNewsPost(newsId);

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (post?.id) navigate(`/news/${post.id}`);
    },
    [post?.id, navigate],
  );

  if (isLoading) {
    return <Skeleton className="h-[76px] w-full max-w-[280px] rounded-lg" />;
  }

  if (!post) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground max-w-[280px]">
        News post not available
      </div>
    );
  }

  const excerpt = stripAttachmentTokens(post.content || "").replace(/\s+/g, " ").trim();

  return (
    <button
      type="button"
      onClick={handleClick}
      className="flex items-start gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.06] p-2.5 max-w-[280px] w-full text-left transition-colors active:bg-primary/[0.12] touch-manipulation"
    >
      <div className="flex items-center justify-center rounded-lg bg-primary/15 p-2 shrink-0">
        <Newspaper className="h-4 w-4 text-primary" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className="text-[10px] font-semibold uppercase tracking-wide text-primary">
            Club News
          </span>
          {post.is_important && (
            <span className="rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold text-destructive">
              Important
            </span>
          )}
        </div>
        <p className="truncate text-sm font-semibold text-foreground">{post.title}</p>
        <p className="truncate text-xs text-muted-foreground">
          {post.published_at ? format(parseISO(post.published_at), "d MMM yyyy") : ""}
          {excerpt ? ` · ${excerpt}` : ""}
        </p>
      </div>
    </button>
  );
});
