import { useMemo } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { format, parseISO } from "date-fns";
import { ArrowLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import { useClubNewsPost, useClubTeamsForNews, useTeamNamesByIds } from "@/features/news/useClubNews";
import { parseNewsAttachments } from "@/features/news/newsAttachments";
import NewsArticleBody from "@/components/news/NewsArticleBody";
import { resolveLocalAuthMode } from "@/lab/localRuntimeMode";



/** Full Club News article. */
export default function ClubNewsPostPage() {
  const { newsId } = useParams<{ newsId: string }>();
  const navigate = useNavigate();
  const useIcpLab = resolveLocalAuthMode(typeof window !== "undefined" ? window.location.search : "", true);
  const { data: post, isLoading } = useClubNewsPost(newsId);
  const { data: teams = [] } = useClubTeamsForNews(post?.club_id ?? null);
  const { data: targetTeams = [] } = useTeamNamesByIds(post?.target_team_ids);
  const teamNameMap = useMemo(() => {
    const map = new Map<string, string>();
    teams.forEach((t) => map.set(t.id, t.name));
    targetTeams.forEach((t) => map.set(t.id, t.name));
    return map;
  }, [teams, targetTeams]);

  const audienceLabel = useMemo(() => {
    if (!post) return null;
    const ids = post.target_team_ids || [];
    if (ids.length === 0) return "Sent to the whole club";
    const names = ids.map((id) => teamNameMap.get(id)).filter(Boolean) as string[];
    if (names.length === 0) return null;
    if (names.length === 1) return `Sent to ${names[0]}`;
    return `Sent to ${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  }, [post, teamNameMap]);


  const { data: author } = useQuery({
    queryKey: ["club-news-author", post?.author_id],
    queryFn: async () => {
      if (useIcpLab) return "Local ICP Member";
      const { data } = await supabase
        .from("profiles")
        .select("display_name")
        .eq("id", post!.author_id!)
        .maybeSingle();
      return data?.display_name ?? null;
    },
    enabled: !!post?.author_id,
  });

  return (
    <div className="container mx-auto max-w-2xl space-y-4 px-4 py-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => navigate(-1)} aria-label="Back">
          <ArrowLeft className="h-5 w-5" />
        </Button>
        <h1 className="text-lg font-bold">Club News</h1>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          <Skeleton className="h-6 w-3/4" />
          <Skeleton className="h-40 w-full rounded-lg" />
          <Skeleton className="h-24 w-full" />
        </div>
      ) : !post ? (
        <Card className="p-8 text-center text-sm text-muted-foreground">
          This post is no longer available.
        </Card>
      ) : (
        <article className="space-y-3">
          {post.image_url && (
            <img
              src={post.image_url}
              alt=""
              className="max-h-64 w-full rounded-lg object-cover"
            />
          )}
          <div className="space-y-1.5">
            <div className="flex items-center gap-2">
              {post.is_important && (
                <Badge variant="destructive" className="h-5 px-2 text-[10px]">
                  Important
                </Badge>
              )}
              <span className="text-xs text-muted-foreground">
                {format(parseISO(post.published_at), "d MMM yyyy, h:mm a")}
              </span>
            </div>
            <h2 className="text-xl font-bold leading-tight">{post.title}</h2>
            {author && <p className="text-xs text-muted-foreground">By {author}</p>}
            {audienceLabel && <p className="text-xs text-muted-foreground">{audienceLabel}</p>}
          </div>
          <NewsArticleBody
            content={post.content || ""}
            attachments={parseNewsAttachments(post.attachments)}
          />

        </article>

      )}
    </div>
  );
}
