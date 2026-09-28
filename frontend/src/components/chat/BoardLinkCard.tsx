import { useEffect, useState, useCallback, useMemo, memo } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Trophy, ExternalLink } from "lucide-react";
import { detectGameBoardKind, type GameBoardKind } from "@/lib/sportDetection";
import { BoardViewerDialog } from "./BoardViewerDialog";

interface BoardLinkCardProps {
  gameId: string;
}

/**
 * In-chat preview for a [board:gameId] token.
 * - Loads the active_games row (RLS gates this — non-team members see "no access")
 * - Subscribes to realtime updates so score/quarter stay live
 * - Tap → opens the appropriate sport board read-only via BoardViewerDialog
 */
export const BoardLinkCard = memo(function BoardLinkCard({
  gameId,
}: BoardLinkCardProps) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ["board-link-card", gameId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("active_games")
        .select(
          "id, team_id, is_active, updated_at, pitch_state, timer_state, teams(id, name, club_id, clubs!club_id(sport))"
        )
        .eq("id", gameId)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!gameId,
    staleTime: 5 * 1000,
  });

  // Realtime: refresh card whenever this active_games row changes
  useEffect(() => {
    if (!gameId) return;
    const channel = supabase
      .channel(`board-card-${gameId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "active_games",
          filter: `id=eq.${gameId}`,
        },
        () => {
          queryClient.invalidateQueries({ queryKey: ["board-link-card", gameId] });
        }
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [gameId, queryClient]);

  const view = useMemo(() => {
    if (!data) return null;
    const sport: string | null = (data as any).teams?.clubs?.sport ?? null;
    const kind: GameBoardKind = detectGameBoardKind(sport) ?? "soccer";
    const timer: any = data.timer_state ?? {};
    return {
      kind,
      teamName: (data as any).teams?.name ?? "Team",
      home: timer.homeScore ?? 0,
      away: timer.awayScore ?? 0,
      opponent: timer.opponentName ?? "Opponent",
      isRunning: !!timer.isRunning,
      isFinished: !!timer.isGameFinished,
      period: (timer.currentQuarter ?? timer.currentPeriod ?? null) as
        | number
        | null,
    };
  }, [data]);

  const handleOpen = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (view) setOpen(true);
    },
    [view]
  );

  if (isLoading) {
    // Match loaded card height (icon column + 3 text rows + p-2.5 ≈ 80px)
    // so resolving the query doesn't grow the row mid-idle.
    return <Skeleton className="h-[80px] w-full max-w-[280px] rounded-lg" />;
  }

  // RLS denial OR row deleted → friendly fallback (no leaked details)
  if (error || !data || !view) {
    return (
      <div className="rounded-lg border border-border/50 bg-muted/30 px-3 py-2 text-xs text-muted-foreground max-w-[280px]">
        🏀 Live board · you don't have access
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={handleOpen}
        className="flex items-stretch gap-2.5 rounded-lg border border-primary/20 bg-primary/[0.06] p-2.5 max-w-[280px] w-full text-left transition-colors active:bg-primary/[0.12] touch-manipulation"
      >
        <div className="flex flex-col items-center justify-center rounded-lg bg-primary/15 p-1.5 min-w-[42px]">
          {view.kind === "basketball" || view.kind === "netball" ? (
            <Trophy className="h-4 w-4 text-primary" strokeWidth={2.25} />
          ) : (
            <Activity className="h-4 w-4 text-primary" strokeWidth={2.25} />
          )}
          <span className="text-[9px] text-primary/70 uppercase mt-0.5 leading-none">
            {view.kind === "basketball"
              ? "Bball"
              : view.kind === "netball"
              ? "Netball"
              : "Soccer"}
          </span>
        </div>

        <div className="flex-1 min-w-0 space-y-0.5">
          <div className="flex items-center gap-1.5">
            {view.isRunning && (
              <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive uppercase">
                <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                Live
              </span>
            )}
            {view.isFinished && (
              <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                Final
              </span>
            )}
            {view.period != null && (
              <span className="text-[10px] text-muted-foreground uppercase">
                Q{view.period}
              </span>
            )}
            <ExternalLink className="ml-auto h-3 w-3 text-muted-foreground" />
          </div>
          <p className="text-sm font-semibold truncate leading-tight">
            {view.teamName}{" "}
            <span className="text-muted-foreground font-normal">
              vs {view.opponent}
            </span>
          </p>
          <div className="flex items-center gap-2 text-[14px] font-bold tabular-nums leading-none">
            <span>{view.home}</span>
            <span className="text-muted-foreground font-normal">–</span>
            <span>{view.away}</span>
          </div>
        </div>
      </button>

      {open && (
        <BoardViewerDialog
          open={open}
          onOpenChange={setOpen}
          gameId={gameId}
        />
      )}
    </>
  );
});
