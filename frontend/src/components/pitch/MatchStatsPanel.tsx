import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog";
import { Badge } from "@/components/ui/badge";
import { Clock, Target, Trophy, Users, TrendingUp } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
}

interface Goal {
  id: string;
  scorerId?: string;
  scorerName?: string;
  time: number;
  half: 1 | 2;
  isOpponentGoal?: boolean;
}

interface MatchStatsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  players: Player[];
  elapsedGameTime?: number;
  goals?: Goal[];
  teamName?: string;
  opponentName?: string;
  hideScores?: boolean;
}

export default function MatchStatsPanel({ open, onOpenChange, players, elapsedGameTime = 0, goals = [], teamName = "Team", opponentName = "Opponent", hideScores = false }: MatchStatsPanelProps) {
  const sortedPlayers = [...players].sort((a, b) => (b.minutesPlayed || 0) - (a.minutesPlayed || 0));
  
  // Defensive cap: a player's on-pitch time can never logically exceed
  // total game elapsed. Protects the displayed stats even if the underlying
  // state has been inflated by an upstream bug.
  const cappedMinutes = (p: Player) => Math.min(p.minutesPlayed || 0, elapsedGameTime);
  const totalMinutesAll = players.reduce((sum, p) => sum + cappedMinutes(p), 0);
  // Average across players who actually took the field — including bench
  // players who never came on would always understate the figure.
  const playedCount = players.filter(p => (p.minutesPlayed || 0) > 0).length;
  const avgMinutes = playedCount > 0 ? Math.round(totalMinutesAll / playedCount) : 0;
  const onPitchCount = players.filter(p => p.position !== null).length;
  const benchCount = players.filter(p => p.position === null).length;
  const teamGoals = goals.filter(g => !g.isOpponentGoal);
  const opponentGoals = goals.filter(g => g.isOpponentGoal);
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const getBarColor = (player: Player) => {
    if (player.position !== null) return "bg-primary";
    return "bg-muted-foreground/40";
  };

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md max-h-[85vh] overflow-hidden flex flex-col">
        <ResponsiveDialogHeader className="pb-0">
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <div className="p-1.5 rounded-lg bg-primary/10">
              <Trophy className="h-4 w-4 text-primary" />
            </div>
            Match Statistics
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            View match statistics and player minutes
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        
        <div className="flex-1 min-h-0 overflow-y-auto space-y-4 py-2">
          {/* Score display */}
          {!hideScores && goals.length > 0 && (
            <div className="relative overflow-hidden rounded-xl border border-primary/20 bg-gradient-to-br from-primary/10 via-primary/5 to-transparent p-5">
              <div className="absolute top-0 right-0 w-24 h-24 bg-primary/5 rounded-full -translate-y-1/2 translate-x-1/2" />
              <div className="flex items-center justify-center gap-6">
                <div className="text-center flex-1">
                  <p className="text-5xl font-black tracking-tighter tabular-nums">{teamGoals.length}</p>
                  <p className="text-xs font-semibold text-muted-foreground truncate mt-1">{teamName}</p>
                </div>
                <div className="flex flex-col items-center gap-1 px-3">
                  <Target className="h-5 w-5 text-primary/60" />
                  <span className="text-[10px] font-bold text-muted-foreground/60 tracking-[0.2em]">VS</span>
                </div>
                <div className="text-center flex-1">
                  <p className="text-5xl font-black tracking-tighter tabular-nums">{opponentGoals.length}</p>
                  <p className="text-xs font-semibold text-muted-foreground truncate mt-1">{opponentName}</p>
                </div>
              </div>
              
              {/* Goal scorers */}
              {teamGoals.length > 0 && (
                <div className="mt-3 pt-3 border-t border-primary/10">
                  <div className="flex flex-wrap gap-1.5 justify-center">
                    {teamGoals.map((goal) => (
                      <span key={goal.id} className="text-[11px] text-muted-foreground bg-background/60 px-2 py-0.5 rounded-full">
                        ⚽ {goal.scorerName || "Goal"} {formatTime(goal.time)}'
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          
          {/* Summary stats grid */}
          <div className="grid grid-cols-3 gap-2">
            <div className="rounded-xl border border-border/50 bg-card p-3 text-center space-y-1">
              <Clock className="h-4 w-4 text-primary mx-auto" />
              <p className="text-xl font-bold tabular-nums">{formatTime(elapsedGameTime)}</p>
              <p className="text-[10px] font-medium text-muted-foreground leading-tight">Game Time</p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-3 text-center space-y-1">
              <TrendingUp className="h-4 w-4 text-primary mx-auto" />
              <p className="text-xl font-bold tabular-nums">{formatTime(avgMinutes)}</p>
              <p className="text-[10px] font-medium text-muted-foreground leading-tight">Avg / Player</p>
            </div>
            <div className="rounded-xl border border-border/50 bg-card p-3 text-center space-y-1">
              <Users className="h-4 w-4 text-primary mx-auto" />
              <p className="text-xl font-bold tabular-nums">{onPitchCount}<span className="text-muted-foreground/60 text-sm">/{players.length}</span></p>
              <p className="text-[10px] font-medium text-muted-foreground leading-tight">On Pitch</p>
            </div>
          </div>

          {/* Player minutes list */}
          <div>
            <div className="flex items-center justify-between mb-2.5">
              <p className="text-sm font-semibold">Minutes by Player</p>
              <Badge variant="secondary" className="text-[10px]">
                {onPitchCount} on · {benchCount} bench
              </Badge>
            </div>
            <div className="space-y-1.5">
              {sortedPlayers.map((player, index) => {
                const minutes = cappedMinutes(player);
                const maxMinutes = sortedPlayers.length > 0 ? cappedMinutes(sortedPlayers[0]) : 0;
                const percentage = maxMinutes > 0 ? (minutes / maxMinutes) * 100 : 0;
                const isOnPitch = player.position !== null;
                const playerGoals = goals.filter(g => g.scorerId === player.id);
                
                return (
                  <div 
                    key={player.id} 
                    className={cn(
                      "flex items-center gap-2.5 p-2 rounded-lg transition-colors",
                      isOnPitch ? "bg-primary/5 border border-primary/10" : "bg-muted/30"
                    )}
                  >
                    <span className="text-[11px] text-muted-foreground/60 w-4 text-right font-medium tabular-nums">{index + 1}</span>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {player.number && (
                          <span className="text-[11px] font-bold text-muted-foreground bg-muted rounded px-1 tabular-nums">
                            {player.number}
                          </span>
                        )}
                        <span className="font-medium text-sm truncate">{player.name}</span>
                        {playerGoals.length > 0 && (
                          <span className="text-[11px]">{"⚽".repeat(playerGoals.length)}</span>
                        )}
                        {player.currentPitchPosition && isOnPitch && (
                          <span className={cn(
                            "text-[10px] font-semibold px-1 rounded",
                            POSITION_COLORS[player.currentPitchPosition]?.bg || "bg-muted",
                            POSITION_COLORS[player.currentPitchPosition]?.text || "text-foreground"
                          )}>
                            {player.currentPitchPosition}
                          </span>
                        )}
                      </div>
                      <div className="flex items-center gap-2 mt-1">
                        <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                          <div 
                            className={cn("h-full rounded-full transition-all duration-500", getBarColor(player))}
                            style={{ width: `${Math.max(percentage, 2)}%` }}
                          />
                        </div>
                        <span className="text-[11px] font-semibold text-muted-foreground w-10 text-right tabular-nums">
                          {formatTime(minutes)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
