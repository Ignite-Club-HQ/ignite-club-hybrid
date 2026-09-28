import { useMemo, useState } from "react";
import { format, parseISO } from "date-fns";
import { Newspaper, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useClubNewsFeed } from "@/features/news/useClubNews";

interface NewsPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectNews: (newsId: string) => void;
  /** Active club — news is always club-scoped. */
  clubId?: string | null;
}

/**
 * Pick a published Club News post to attach to a chat message.
 * The list comes straight from club_news (RLS-scoped), so only posts the
 * sender is allowed to read can be shared.
 */
export function NewsPickerSheet({ open, onOpenChange, onSelectNews, clubId }: NewsPickerSheetProps) {
  const [search, setSearch] = useState("");
  const { data: posts, isLoading } = useClubNewsFeed(clubId ?? undefined, 50);

  const filtered = useMemo(() => {
    const list = posts || [];
    const q = search.trim().toLowerCase();
    if (!q) return list;
    return list.filter(
      (p) =>
        p.title.toLowerCase().includes(q) ||
        (p.content || "").toLowerCase().includes(q),
    );
  }, [posts, search]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle>Share club news</DialogTitle>
        </DialogHeader>

        <div className="px-4 pb-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search news"
              className="pl-9"
            />
          </div>
        </div>

        <div className="max-h-[60vh] overflow-y-auto px-2 pb-4 space-y-1.5">
          {isLoading ? (
            <>
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
              <Skeleton className="h-16 w-full rounded-lg" />
            </>
          ) : filtered.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">
              {posts && posts.length > 0 ? "No matching news posts." : "No club news posts yet."}
            </p>
          ) : (
            filtered.map((post) => (
              <button
                key={post.id}
                type="button"
                onClick={() => {
                  onSelectNews(post.id);
                  onOpenChange(false);
                }}
                className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-muted/60 active:bg-muted"
              >
                <div className="flex items-center justify-center rounded-lg bg-primary/15 p-2 shrink-0">
                  <Newspaper className="h-4 w-4 text-primary" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium text-foreground">{post.title}</span>
                    {post.is_important && (
                      <span className="rounded-full bg-destructive/15 px-1.5 text-[10px] font-semibold text-destructive">
                        Important
                      </span>
                    )}
                  </div>
                  <p className="truncate text-xs text-muted-foreground">
                    {post.published_at ? format(parseISO(post.published_at), "d MMM yyyy") : ""}
                    {post.target_team_ids && post.target_team_ids.length > 0
                      ? ` · ${post.target_team_ids.length} team${post.target_team_ids.length === 1 ? "" : "s"}`
                      : " · Whole club"}
                  </p>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
