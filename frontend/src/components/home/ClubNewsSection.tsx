import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ChevronRight, Newspaper } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { useClubTheme } from "@/hooks/useClubTheme";
import { useLatestClubNews, useNewsPublishableClubs } from "@/features/news/useClubNews";
import { stripAttachmentTokens } from "@/features/news/newsAttachments";

/**
 * Compact Home "Club News" section — surfaces only the latest post and hides
 * itself entirely when the club has published nothing. The full archive lives
 * behind "See all" (/news) so Home stays clean and navigation is unchanged.
 */
export default function ClubNewsSection() {
  const navigate = useNavigate();
  const { activeClubFilter } = useClubTheme();
  const { latest } = useLatestClubNews(activeClubFilter);
  const { data: publishableClubs = [] } = useNewsPublishableClubs();
  const canPublish = publishableClubs.length > 0;

  // No posts yet: stay hidden for members, but give club admins a way in.
  if (!latest) {
    if (!canPublish) return null;
    return (
      <div className="space-y-2">
        <div className="flex items-center gap-2 px-1">
          <Newspaper className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Club News</h2>
        </div>
        <Card
          role="button"
          tabIndex={0}
          onClick={() => navigate("/news")}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              navigate("/news");
            }
          }}
          className="flex cursor-pointer items-center gap-3 bg-card p-3 transition-colors hover:bg-accent/50 active:bg-accent"
        >
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Post your first club news</p>
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Only club admins see this. Members see nothing until you publish.
            </p>
          </div>
          <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Card>
      </div>
    );
  }

  const preview = stripAttachmentTokens(latest.content).replace(/\s+/g, " ").trim();

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2">
          <Newspaper className="h-4 w-4 text-primary" />
          <h2 className="text-base font-semibold text-foreground">Club News</h2>
        </div>
        <button
          type="button"
          onClick={() => navigate("/news")}
          className="flex items-center gap-0.5 text-xs font-medium text-primary"
        >
          See all <ChevronRight className="h-3.5 w-3.5" />
        </button>
      </div>

      <Card
        role="button"
        tabIndex={0}
        onClick={() => navigate(`/news/${latest.id}`)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            navigate(`/news/${latest.id}`);
          }
        }}
        className="flex cursor-pointer items-center gap-3 bg-card p-3 transition-colors hover:bg-accent/50 active:bg-accent"
      >
        {latest.image_url && (
          <img
            src={latest.image_url}
            alt=""
            loading="lazy"
            className="h-12 w-12 shrink-0 rounded-md object-cover"
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="line-clamp-1 text-sm font-semibold text-foreground">{latest.title}</p>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[11px] text-muted-foreground">
              {format(parseISO(latest.published_at), "d MMM yyyy")}
            </span>
            {latest.is_important && (
              <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                Important
              </Badge>
            )}
          </div>
          {preview && (
            <p className="mt-0.5 line-clamp-1 text-[11px] text-muted-foreground">{preview}</p>
          )}
        </div>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </Card>
    </div>
  );
}
