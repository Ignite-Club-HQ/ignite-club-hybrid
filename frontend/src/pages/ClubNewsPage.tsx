import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { format, parseISO } from "date-fns";
import { ArrowLeft, ChevronRight, Newspaper, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { useClubTheme } from "@/hooks/useClubTheme";
import {
  useClubNewsFeed,
  useClubTeamsForNews,
  useNewsPublishableClubs,
  useTeamNamesByIds,
} from "@/features/news/useClubNews";
import ClubNewsComposer from "@/components/news/ClubNewsComposer";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";

/** Club News archive — newest first. */
export default function ClubNewsPage() {
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const { activeClubFilter } = useClubTheme();
  const { data: posts = [], isLoading } = useClubNewsFeed(activeClubFilter);
  const { data: publishableClubs = [] } = useNewsPublishableClubs();
  const { data: teams = [] } = useClubTeamsForNews(activeClubFilter ?? null);
  const targetIds = useMemo(
    () => posts.flatMap((p) => p.target_team_ids || []),
    [posts],
  );
  const { data: targetTeams = [] } = useTeamNamesByIds(targetIds);
  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((t) => map.set(t.id, t.name));
    targetTeams.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [teams, targetTeams]);

  const [composerOpen, setComposerOpen] = useState(false);

  const canPublish = publishableClubs.length > 0;

  return (
    <div className="container mx-auto max-w-2xl space-y-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="flex-1 text-lg font-bold">Club News</h1>
        {canPublish && (
          <Button size="sm" onClick={() => setComposerOpen(true)} aria-label="New post">
            <Plus className="h-4 w-4" />
          </Button>
        )}
      </div>

      {useIcpLab && (
        <Alert>
          <AlertDescription>
            Club news is read-only in the ICP lab. Publishing remains unavailable until its backend service is ported.
          </AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-20 w-full rounded-lg" />
          ))}
        </div>
      ) : posts.length === 0 ? (
        <Card className="flex flex-col items-center gap-2 p-8 text-center">
          <Newspaper className="h-6 w-6 text-muted-foreground" />
          <p className="text-sm font-medium">No club news yet</p>
          <p className="text-xs text-muted-foreground">
            Official club updates will appear here.
          </p>
        </Card>
      ) : (
        <div className="space-y-3">
          {posts.map((post) => (
            <Card
              key={post.id}
              role="button"
              tabIndex={0}
              onClick={() => navigate(`/news/${post.id}`)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  navigate(`/news/${post.id}`);
                }
              }}
              className="flex cursor-pointer items-center gap-3 p-3 transition-colors hover:bg-accent/50 active:bg-accent"
            >
              {post.image_url && (
                <img
                  src={post.image_url}
                  alt=""
                  loading="lazy"
                  className="h-14 w-14 shrink-0 rounded-md object-cover"
                />
              )}
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2 text-sm font-semibold">{post.title}</p>
                <div className="mt-1 flex items-center gap-2">
                  <span className="text-[11px] text-muted-foreground">
                    {format(parseISO(post.published_at), "d MMM yyyy")}
                  </span>
                  {post.is_important && (
                    <Badge variant="destructive" className="h-4 px-1.5 text-[10px]">
                      Important
                    </Badge>
                  )}
                  {(() => {
                    const ids = post.target_team_ids || [];
                    if (ids.length === 0) return null;
                    const names = ids
                      .map((id) => teamNameMap.get(id))
                      .filter(Boolean) as string[];
                    if (names.length === 0) return null;
                    return (
                      <Badge variant="secondary" className="h-4 max-w-[60%] truncate px-1.5 text-[10px]">
                        {names.join(", ")}
                      </Badge>
                    );
                  })()}

                </div>
              </div>
              <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
            </Card>
          ))}
        </div>
      )}

      {!useIcpLab && (
        <ClubNewsComposer
          open={composerOpen}
          onOpenChange={setComposerOpen}
          defaultClubId={activeClubFilter}
        />
      )}
    </div>
  );
}
