import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { 
  Pause, Play, SkipForward, Lock, Unlock, 
  X, ChevronDown, ChevronUp, Check, Pencil, Clock,
  MoreHorizontal
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Player, SubstitutionEvent } from "./types";
import { PitchPosition } from "./PositionBadge";
import { findRelevantNextSub } from "./autoSubHelpers";

interface AutoSubManagerProps {
  autoSubPlan: SubstitutionEvent[];
  autoSubPaused: boolean;
  players: Player[];
  lockedPlayerIds: Set<string>;
  currentElapsedSeconds: number;
  currentHalf: 1 | 2;
  minutesPerHalf: number;
  onTogglePause: () => void;
  onCancelPlan: () => void;
  onSkipNext: () => void;
  onExecuteNow: () => void;
  onEditPlan: () => void;
  onRegeneratePlan: () => void;
  onToggleLockPlayer: (playerId: string) => void;
  compact?: boolean;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${secs.toString().padStart(2, "0")}`;
};

export default function AutoSubManager({
  autoSubPlan,
  autoSubPaused,
  players,
  lockedPlayerIds,
  currentElapsedSeconds,
  currentHalf,
  minutesPerHalf,
  onTogglePause,
  onCancelPlan,
  onSkipNext,
  onExecuteNow,
  onEditPlan,
  onRegeneratePlan,
  onToggleLockPlayer,
  compact = false,
}: AutoSubManagerProps) {
  const [showMore, setShowMore] = useState(false);
  const [showLockPanel, setShowLockPanel] = useState(false);
  const [showTimeline, setShowTimeline] = useState(false);

  const executedSubs = useMemo(() => autoSubPlan.filter(s => s.executed), [autoSubPlan]);
  const remainingSubs = useMemo(() => autoSubPlan.filter(s => !s.executed), [autoSubPlan]);
  
  const nextSub = useMemo(() => {
    return findRelevantNextSub(
      remainingSubs,
      currentHalf,
      currentElapsedSeconds,
      minutesPerHalf * 60
    );
  }, [remainingSubs, currentHalf, currentElapsedSeconds, minutesPerHalf]);

  const onPitchPlayers = useMemo(() => 
    players.filter(p => p.position !== null && p.currentPitchPosition !== "GK"),
    [players]
  );

  return (
    <div className="space-y-2">
      {/* 1. Tappable Next Sub Card */}
      {nextSub && (
        <button
          type="button"
          className={cn(
            "w-full rounded-lg border p-3.5 text-left transition-colors",
            autoSubPaused 
              ? "border-muted bg-muted/30 opacity-60" 
              : "border-primary/30 bg-primary/5 hover:bg-primary/10 active:bg-primary/15 cursor-pointer"
          )}
          onClick={!autoSubPaused ? onExecuteNow : undefined}
          disabled={autoSubPaused}
          title={autoSubPaused ? "Resume to execute" : "Tap to execute this sub now"}
        >
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs uppercase tracking-wider text-muted-foreground font-medium">
              Next Sub {!autoSubPaused && <span className="text-primary">· Tap to execute</span>}
            </span>
            <Badge variant="secondary" className="font-mono text-xs h-6 px-2">
              {nextSub.half === 2 && nextSub.time === 0 
                ? "HT" 
                : `${nextSub.half === 2 ? "2H " : ""}${formatTime(nextSub.time)}`}
            </Badge>
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-1.5 text-base">
              <span className="text-[10px] uppercase font-bold text-destructive w-7 shrink-0">OUT</span>
              <span className="text-destructive font-medium truncate">
                {nextSub.playerOut.number ? `#${nextSub.playerOut.number} ` : ""}{nextSub.playerOut.name}
              </span>
            </div>
            <div className="flex items-center gap-1.5 text-base">
              <span className="text-[10px] uppercase font-bold text-green-600 dark:text-green-400 w-7 shrink-0">IN</span>
              <span className="text-green-600 dark:text-green-400 font-medium truncate">
                {nextSub.playerIn.number ? `#${nextSub.playerIn.number} ` : ""}{nextSub.playerIn.name}
              </span>
            </div>
          </div>
          {nextSub.positionSwap && (
            <p className="text-xs text-muted-foreground mt-1.5">
              + {nextSub.positionSwap.player.name} moves {nextSub.positionSwap.fromPosition} → {nextSub.positionSwap.toPosition}
            </p>
          )}
        </button>
      )}

      {/* 2. Primary Actions: Pause + Skip + More toggle */}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          variant={autoSubPaused ? "default" : "outline"}
          className="h-9 text-xs gap-1.5 flex-1 min-w-0"
          onClick={onTogglePause}
        >
          {autoSubPaused ? <Play className="h-3.5 w-3.5" /> : <Pause className="h-3.5 w-3.5" />}
          {autoSubPaused ? "Resume" : "Pause"}
        </Button>

        <Button
          size="sm"
          variant="outline"
          className="h-9 text-xs gap-1.5 flex-1 min-w-0"
          onClick={onSkipNext}
          disabled={!nextSub || autoSubPaused}
        >
          <SkipForward className="h-3.5 w-3.5" />
          Skip
        </Button>

        <Button
          size="sm"
          variant="ghost"
          className={cn("h-9 w-9 shrink-0 p-0", showMore && "bg-accent")}
          onClick={() => setShowMore(prev => !prev)}
          title="More options"
        >
          <MoreHorizontal className="h-4 w-4" />
        </Button>
      </div>

      {/* 3. Collapsible "More" panel */}
      {showMore && (
        <div className="rounded-lg border border-border bg-muted/20 p-2 space-y-2">
          {/* Lock row */}
          <div className="flex gap-1.5">

            <Button
              size="sm"
              variant="outline"
              className={cn("h-8 text-xs gap-1 flex-1", showLockPanel && "bg-accent")}
              onClick={() => setShowLockPanel(prev => !prev)}
            >
              <Lock className="h-3.5 w-3.5" />
              Lock ({lockedPlayerIds.size})
            </Button>
          </div>

          {/* Lock Player Panel */}
          {showLockPanel && (
            <div className="rounded-lg border border-border bg-muted/30 p-2 space-y-1.5">
              <p className="text-[10px] text-muted-foreground uppercase tracking-wider font-medium">
                Locked players won't be subbed off
              </p>
              <div className="flex flex-wrap gap-1">
                {onPitchPlayers.map(player => {
                  const isLocked = lockedPlayerIds.has(player.id);
                  return (
                    <Button
                      key={player.id}
                      size="sm"
                      variant={isLocked ? "default" : "outline"}
                      className={cn("h-7 text-[10px] gap-1 px-2", isLocked && "bg-amber-600 hover:bg-amber-700 text-white")}
                      onClick={() => onToggleLockPlayer(player.id)}
                    >
                      {isLocked ? <Lock className="h-3 w-3" /> : <Unlock className="h-3 w-3" />}
                      {player.number ? `#${player.number} ` : ""}{player.name}
                    </Button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Edit Plan + Timeline row */}
          <div className="flex gap-1.5">
            <Button
              size="sm"
              variant="outline"
              className="h-8 text-xs gap-1 flex-1"
              onClick={onEditPlan}
            >
              <Pencil className="h-3.5 w-3.5" />
              Edit Plan
            </Button>
            <Button
              size="sm"
              variant="ghost"
              className="h-8 text-xs gap-1 flex-1"
              onClick={() => setShowTimeline(prev => !prev)}
            >
              {showTimeline ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
              Timeline ({executedSubs.length}/{autoSubPlan.length})
            </Button>
          </div>

          {/* Timeline */}
          {showTimeline && (
            <ScrollArea className="max-h-[50vh]">
              <div className="space-y-0">
                {[1, 2].map((half) => {
                  const halfSubs = autoSubPlan
                    .map((sub, idx) => ({ sub, idx }))
                    .filter(({ sub }) => sub.half === half);
                  if (halfSubs.length === 0) return null;

                  // Group by time
                  const groups: { time: number; items: { sub: SubstitutionEvent; idx: number }[] }[] = [];
                  halfSubs.forEach(({ sub, idx }) => {
                    const existing = groups.find(g => g.time === sub.time);
                    if (existing) {
                      existing.items.push({ sub, idx });
                    } else {
                      groups.push({ time: sub.time, items: [{ sub, idx }] });
                    }
                  });
                  groups.sort((a, b) => a.time - b.time);

                  return (
                    <div key={half}>
                      <div className="px-2 py-1 text-[10px] font-semibold text-muted-foreground bg-muted/40 rounded-t">
                        {half === 1 ? "1st Half" : "2nd Half"}
                      </div>
                      {groups.map((group) => {
                        const timeLabel = group.time === 0 && half === 2
                          ? "HT"
                          : formatTime(group.time);
                        const allExecuted = group.items.every(({ sub }) => sub.executed);
                        const allSkipped = group.items.every(({ sub }) => sub.skipped);
                        const anyNext = group.items.some(({ sub }) => nextSub && sub === nextSub);
                        const anyDue = group.items.some(({ sub }) => !sub.executed && sub.half === currentHalf && sub.time <= currentElapsedSeconds);

                        return (
                          <div
                            key={`${half}-${group.time}`}
                            className={cn(
                              "flex gap-2 px-2 py-1.5 text-xs",
                              allExecuted
                                ? allSkipped ? "bg-muted/10 opacity-60" : "bg-muted/30"
                                : anyNext
                                  ? "bg-primary/10 border border-primary/30"
                                  : anyDue
                                    ? "bg-amber-500/10 border border-amber-500/30"
                                    : "bg-muted/20",
                              "rounded mb-1"
                            )}
                          >
                            {/* Status + time column */}
                            <div className="flex flex-col items-center pt-0.5 shrink-0 w-12">
                              <div className="shrink-0 mb-0.5">
                                {allExecuted ? (
                                  allSkipped ? (
                                    <X className="h-3 w-3 text-muted-foreground" />
                                  ) : (
                                    <Check className="h-3 w-3 text-green-500" />
                                  )
                                ) : anyNext ? (
                                  <Clock className="h-3 w-3 text-primary" />
                                ) : (
                                  <div className="w-3 h-3 rounded-full border border-muted-foreground/40" />
                                )}
                              </div>
                              <Badge className="font-mono text-[10px] h-5 border-transparent bg-foreground/15 text-foreground hover:bg-foreground/20">
                                {timeLabel}
                              </Badge>
                              {group.items.length > 1 && (
                                <div className="w-px flex-1 bg-border mt-0.5" />
                              )}
                            </div>
                            {/* Subs column */}
                            <div className="flex-1 space-y-0.5 min-w-0">
                              {group.items.map(({ sub, idx }) => (
                                <div
                                  key={idx}
                                  className={cn(
                                    "flex items-center gap-1",
                                    sub.skipped && "text-muted-foreground/50 line-through",
                                    sub.executed && !sub.skipped && "text-muted-foreground"
                                  )}
                                >
                                    <span className={cn("truncate", sub.skipped ? "text-muted-foreground/50" : "text-destructive")}>
                                      {sub.playerOut.name}
                                    </span>
                                    <span className="text-muted-foreground">→</span>
                                    <span className={cn("truncate", sub.skipped ? "text-muted-foreground/50" : "text-green-600 dark:text-green-400")}>
                                      {sub.playerIn.name}
                                    </span>
                                  {!sub.executed && lockedPlayerIds.has(sub.playerOut.id) && (
                                    <Lock className="h-3 w-3 text-amber-500 shrink-0" />
                                  )}
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          )}

          {/* Cancel Plan */}
          <Button 
            variant="ghost" 
            size="sm" 
            className="w-full h-9 text-sm text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={onCancelPlan}
          >
            <X className="h-3.5 w-3.5 mr-1" />
            Cancel Plan
          </Button>
        </div>
      )}
    </div>
  );
}
