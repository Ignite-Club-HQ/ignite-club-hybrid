import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Skeleton } from "@/components/ui/skeleton";
import { Activity, Trophy } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { detectGameBoardKind, type GameBoardKind } from "@/lib/sportDetection";

interface BoardPickerSheetProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectBoard: (gameId: string) => void;
}

interface ActiveGameRow {
  id: string;
  team_id: string | null;
  updated_at: string;
  pitch_state: any;
  timer_state: any;
  teams: {
    id: string;
    name: string;
    club_id: string;
    clubs: { sport: string | null } | null;
  } | null;
}

/**
 * Bottom-sheet picker mirroring EventPickerSheet. Lists every active_games
 * row whose team_id belongs to the current user (any sport: soccer / netball
 * / basketball). RLS enforces team-member visibility, so the list naturally
 * filters to boards the user can actually open.
 */
export function BoardPickerSheet({
  open,
  onOpenChange,
  onSelectBoard,
}: BoardPickerSheetProps) {
  const { user } = useAuth();

  const { data: games, isLoading } = useQuery({
    queryKey: ["board-picker-active-games", user?.id],
    queryFn: async () => {
      if (!user?.id) return [];
      const { data, error } = await supabase
        .from("active_games")
        .select(
          "id, team_id, updated_at, pitch_state, timer_state, teams!inner(id, name, club_id, clubs!club_id(sport))"
        )
        .eq("is_active", true)
        .order("updated_at", { ascending: false })
        .limit(20);
      if (error) {
        console.error("[BoardPickerSheet] load failed", error);
        return [];
      }
      return (data ?? []) as unknown as ActiveGameRow[];
    },
    enabled: open && !!user?.id,
    staleTime: 15 * 1000,
    refetchInterval: open ? 15 * 1000 : false,
  });

  const items = useMemo(() => {
    return (games ?? []).map((g) => {
      const sport: string | null = g.teams?.clubs?.sport ?? null;
      const kind: GameBoardKind = detectGameBoardKind(sport) ?? "soccer";
      const timer = g.timer_state ?? {};
      const home: number = timer.homeScore ?? 0;
      const away: number = timer.awayScore ?? 0;
      const opponent: string = timer.opponentName ?? "Opponent";
      const isRunning = !!timer.isRunning;
      const isFinished = !!timer.isGameFinished;
      const period = (timer.currentQuarter ?? timer.currentPeriod ?? null) as
        | number
        | null;
      return {
        id: g.id,
        teamName: g.teams?.name ?? "Team",
        kind,
        home,
        away,
        opponent,
        isRunning,
        isFinished,
        period,
      };
    });
  }, [games]);

  const handleSelect = (gameId: string) => {
    onSelectBoard(gameId);
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        onOpenAutoFocus={(event) => event.preventDefault()}
        className="!left-0 !right-0 !top-auto !bottom-0 !w-full !max-w-none !translate-x-0 !translate-y-0 !rounded-t-[10px] !rounded-b-none !border-x-0 !border-b-0 !p-0 !gap-0 !max-h-[85vh] !overflow-hidden !flex !flex-col"
      >
        <div className="mx-auto mt-4 mb-2 h-2 w-[100px] rounded-full bg-muted" />

        <DialogHeader className="px-4 pb-2">
          <DialogTitle>Share Live Board</DialogTitle>
        </DialogHeader>

        <div
          data-chat-scroll-lock="true"
          className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-4 pb-6 space-y-1.5"
          style={{ WebkitOverflowScrolling: "touch", touchAction: "pan-y" }}
        >
          {isLoading ? (
            Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" />
            ))
          ) : items.length === 0 ? (
            <p className="text-center text-sm text-muted-foreground py-8">
              No active boards. Start a game from a team page first.
            </p>
          ) : (
            items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelect(item.id)}
                className="flex items-center gap-2.5 w-full rounded-lg border border-border/50 p-2.5 text-left transition-colors active:bg-muted/50 hover:bg-muted/30 touch-manipulation"
              >
                <div className="flex flex-col items-center justify-center rounded-lg bg-primary/10 p-1.5 min-w-[42px] aspect-square">
                  <SportIcon kind={item.kind} />
                  <span className="text-[9px] text-primary/70 uppercase mt-0.5 leading-none">
                    {item.kind === "basketball"
                      ? "Bball"
                      : item.kind === "netball"
                      ? "Netball"
                      : "Soccer"}
                  </span>
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    {item.isRunning && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold text-destructive uppercase">
                        <span className="h-1.5 w-1.5 rounded-full bg-destructive animate-pulse" />
                        Live
                      </span>
                    )}
                    {item.isFinished && (
                      <span className="text-[10px] font-semibold text-muted-foreground uppercase">
                        Final
                      </span>
                    )}
                    {item.period != null && (
                      <span className="text-[10px] text-muted-foreground uppercase">
                        Q{item.period}
                      </span>
                    )}
                  </div>
                  <p className="text-sm font-semibold truncate leading-tight">
                    {item.teamName}{" "}
                    <span className="text-muted-foreground font-normal">
                      vs {item.opponent}
                    </span>
                  </p>
                  <div className="flex items-center gap-2 text-[12px] tabular-nums font-semibold">
                    <span>{item.home}</span>
                    <span className="text-muted-foreground">–</span>
                    <span>{item.away}</span>
                  </div>
                </div>
              </button>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SportIcon({ kind }: { kind: GameBoardKind }) {
  if (kind === "basketball" || kind === "netball") {
    return <Trophy className="h-4 w-4 text-primary" strokeWidth={2.25} />;
  }
  return <Activity className="h-4 w-4 text-primary" strokeWidth={2.25} />;
}
