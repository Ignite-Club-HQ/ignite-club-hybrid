import { useMemo, useState, Suspense } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Trophy, ChevronRight, Star } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import type { SummaryPlayerStat, PerQuarterScore } from "@/components/scoreboard/GameSummaryDialog";
import { lazyWithRetry } from "@/lib/lazyWithRetry";

const GameSummaryDialog = lazyWithRetry(() => import("@/components/scoreboard/GameSummaryDialog"));

interface ClubRecentGamesProps {
  clubId: string;
  /** Maximum rows to show inline. */
  limit?: number;
}

interface ClubGameRow {
  id: string;
  team_id: string;
  sport: "basketball" | "netball";
  home_label: string;
  away_label: string;
  home_score: number;
  away_score: number;
  period_scores: PerQuarterScore[];
  player_stats: SummaryPlayerStat[];
  mvp_player_id: string | null;
  mvp_player_name: string | null;
  played_at: string;
  teams?: { id: string; name: string } | null;
}

const sportLabel = (s: string) => (s === "basketball" ? "Basketball" : "Netball");

export default function ClubRecentGames({ clubId, limit = 5 }: ClubRecentGamesProps) {
  const [openRow, setOpenRow] = useState<ClubGameRow | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ["club-recent-games", clubId, limit],
    queryFn: async () => {
      // Fetch team ids for this club, then results for those teams.
      const { data: teamRows, error: teamErr } = await supabase
        .from("teams")
        .select("id")
        .eq("club_id", clubId)
        .is("deleted_at", null);
      if (teamErr) throw teamErr;
      const teamIds = (teamRows ?? []).map((t) => t.id);
      if (teamIds.length === 0) return [];

      const { data, error } = await supabase
        .from("game_results")
        .select("*, teams:team_id ( id, name )")
        .in("team_id", teamIds)
        .order("played_at", { ascending: false })
        .limit(limit);
      if (error) throw error;
      return (data ?? []) as unknown as ClubGameRow[];
    },
  });

  const rows = useMemo(() => data ?? [], [data]);

  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-sm flex items-center gap-2">
            <Trophy className="h-4 w-4 text-primary" />
            Recent Games
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-14 w-full" />
          ))}
        </CardContent>
      </Card>
    );
  }

  if (rows.length === 0) return null;

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Trophy className="h-4 w-4 text-primary" />
          Recent Games
          <span className="text-[10px] font-normal text-muted-foreground ml-auto">
            Across all teams
          </span>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-1.5 pt-0">
        {rows.map((row) => {
          const result =
            row.home_score > row.away_score
              ? "WIN"
              : row.home_score < row.away_score
                ? "LOSS"
                : "DRAW";
          const resultClass =
            result === "WIN"
              ? "bg-primary/15 text-primary"
              : result === "LOSS"
                ? "bg-destructive/15 text-destructive"
                : "bg-muted text-muted-foreground";

          return (
            <button
              key={row.id}
              type="button"
              onClick={() => setOpenRow(row)}
              className="w-full text-left rounded-md border bg-card hover:bg-muted/30 transition-colors p-2.5 flex items-center gap-2"
            >
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-1.5 flex-wrap">
                  <Badge variant="outline" className="text-[9px] px-1.5 py-0 h-4">
                    {sportLabel(row.sport)}
                  </Badge>
                  <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded-full", resultClass)}>
                    {result}
                  </span>
                  {row.teams?.name && (
                    <Link
                      to={`/teams/${row.teams.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-[10px] text-primary hover:underline truncate"
                    >
                      {row.teams.name}
                    </Link>
                  )}
                  <span className="text-[10px] text-muted-foreground ml-auto">
                    {formatDistanceToNow(new Date(row.played_at), { addSuffix: true })}
                  </span>
                </div>
                <p className="text-xs font-semibold truncate">
                  {row.home_label}{" "}
                  <span className="tabular-nums">
                    {row.home_score}–{row.away_score}
                  </span>{" "}
                  {row.away_label}
                </p>
                {row.mvp_player_name && (
                  <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1">
                    <Star className="h-2.5 w-2.5 text-primary fill-primary" />
                    MVP {row.mvp_player_name}
                  </p>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
            </button>
          );
        })}
      </CardContent>

      <Suspense fallback={null}>
        {openRow && (
          <GameSummaryDialog
            open={!!openRow}
            onOpenChange={(o) => !o && setOpenRow(null)}
            sport={openRow.sport}
            homeLabel={openRow.home_label}
            awayLabel={openRow.away_label}
            homeScore={openRow.home_score}
            awayScore={openRow.away_score}
            perQuarter={openRow.period_scores ?? []}
            players={openRow.player_stats ?? []}
            mvpPlayerId={openRow.mvp_player_id}
            readOnly
          />
        )}
      </Suspense>
    </Card>
  );
}
