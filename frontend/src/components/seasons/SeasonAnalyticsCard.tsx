import { useState } from "react";
import { BarChart3, ChevronDown, Users, Calendar, TrendingUp, Trophy } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { useSeasonTeamSummary, useSeasonPlayerStats } from "@/hooks/useSeasonAnalytics";

interface Props {
  seasonId: string;
}

export function SeasonAnalyticsCard({ seasonId }: Props) {
  const { data: summary = [], isLoading, error } = useSeasonTeamSummary(seasonId);

  if (error) {
    // Access denied or RPC error — hide silently (coach/admin only feature)
    return null;
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <BarChart3 className="h-4 w-4" /> Season analytics
        </CardTitle>
        <CardDescription>
          Attendance, games played, and roster stats for each team.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-2">
        {isLoading && (
          <>
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </>
        )}
        {!isLoading && summary.length === 0 && (
          <p className="text-sm text-muted-foreground">No teams in this season yet.</p>
        )}
        {summary.map((s) => (
          <TeamAnalyticsRow key={s.team_id} seasonId={seasonId} summary={s} />
        ))}
      </CardContent>
    </Card>
  );
}

function TeamAnalyticsRow({
  seasonId,
  summary,
}: {
  seasonId: string;
  summary: {
    team_id: string;
    team_name: string;
    events_count: number;
    avg_attendance_pct: number;
    roster_size: number;
  };
}) {
  const [open, setOpen] = useState(false);
  const { data: players = [], isLoading: playersLoading } = useSeasonPlayerStats(
    seasonId,
    summary.team_id,
    open,
  );

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="rounded-lg border overflow-hidden">
        <CollapsibleTrigger asChild>
          <button className="w-full p-3 flex items-center gap-3 hover:bg-muted/40 transition-colors text-left">
            <div className="flex-1 min-w-0">
              <p className="font-medium truncate">{summary.team_name}</p>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground mt-1">
                <span className="inline-flex items-center gap-1">
                  <Users className="h-3 w-3" />
                  {summary.roster_size}
                </span>
                <span className="inline-flex items-center gap-1">
                  <Calendar className="h-3 w-3" />
                  {summary.events_count} event{summary.events_count === 1 ? "" : "s"}
                </span>
                <span className="inline-flex items-center gap-1">
                  <TrendingUp className="h-3 w-3" />
                  {Number(summary.avg_attendance_pct).toFixed(0)}% attendance
                </span>
              </div>
            </div>
            <ChevronDown
              className={`h-4 w-4 text-muted-foreground flex-shrink-0 transition-transform ${open ? "rotate-180" : ""}`}
            />
          </button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="border-t p-3 bg-muted/20">
            {playersLoading && <Skeleton className="h-32 w-full" />}
            {!playersLoading && players.length === 0 && (
              <p className="text-sm text-muted-foreground">No player data yet.</p>
            )}
            {!playersLoading && players.length > 0 && (
              <Tabs defaultValue="attendance">
                <TabsList className="grid grid-cols-2 w-full">
                  <TabsTrigger value="attendance">Attendance</TabsTrigger>
                  <TabsTrigger value="games">Games</TabsTrigger>
                </TabsList>
                <TabsContent value="attendance" className="mt-3 space-y-1">
                  {players.slice(0, 10).map((p, i) => (
                    <div
                      key={p.club_player_id}
                      className="flex items-center gap-3 py-1.5 text-sm"
                    >
                      <span className="w-5 text-xs text-muted-foreground text-right">
                        {i + 1}
                      </span>
                      <span className="flex-1 min-w-0 truncate">{p.player_name}</span>
                      <span className="text-xs text-muted-foreground">
                        {p.events_attended}/{p.events_total}
                      </span>
                      <span className="font-medium tabular-nums w-12 text-right">
                        {Number(p.attendance_pct).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </TabsContent>
                <TabsContent value="games" className="mt-3 space-y-1">
                  {[...players]
                    .sort((a, b) => b.games_played - a.games_played)
                    .slice(0, 10)
                    .map((p, i) => (
                      <div
                        key={p.club_player_id}
                        className="flex items-center gap-3 py-1.5 text-sm"
                      >
                        <span className="w-5 text-xs text-muted-foreground text-right">
                          {i + 1}
                        </span>
                        <span className="flex-1 min-w-0 truncate">{p.player_name}</span>
                        <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                          <Trophy className="h-3 w-3" />
                          {p.games_played} game{p.games_played === 1 ? "" : "s"}
                        </span>
                      </div>
                    ))}
                </TabsContent>
              </Tabs>
            )}
          </div>
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
