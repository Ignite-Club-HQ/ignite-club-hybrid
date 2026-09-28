import { useState, useEffect } from "react";
import { loadPitchState, loadTimerStateForMinutes } from "./pitchStateUtils";
import { canShowHalftimePrompt } from "./halftimePromptAck";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeftRight, Check, X, Clock, Users, Timer } from "lucide-react";
import { cn } from "@/lib/utils";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { getSpecificPositionLabel } from "./types";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
}

interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
  skipped?: boolean;
}

interface SubConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  substitution: SubstitutionEvent | null;
  batchSubstitutions?: SubstitutionEvent[];
  onConfirm: () => void;
  onSkip: () => void;
  onAcknowledgeHalftime?: () => void;
  players: Player[];
  secondsUntilDue?: number;
  isGameFinished?: boolean;
}

export default function SubConfirmDialog({
  open,
  onOpenChange,
  substitution,
  batchSubstitutions = [],
  onConfirm,
  onSkip,
  onAcknowledgeHalftime,
  players,
  secondsUntilDue = 0,
  isGameFinished = false,
}: SubConfirmDialogProps) {
  const [countdown, setCountdown] = useState(secondsUntilDue);
  
  const allSubs = substitution ? [substitution, ...batchSubstitutions] : [];
  const isBatchSub = allSubs.length > 1;
  const alreadyExecuted = substitution?.executed === true && !substitution?.skipped;
  const wasSkipped = substitution?.skipped === true;
  const isHalftime = !substitution || (substitution?.half === 2 && substitution?.time === 0);
  const isHalftimeOnly = !substitution; // No subs, just a halftime notification
  
  useEffect(() => {
    setCountdown(secondsUntilDue);
  }, [secondsUntilDue, open]);
  
  useEffect(() => {
    if (!open || countdown <= 0) return;
    const interval = setInterval(() => {
      setCountdown(prev => Math.max(0, prev - 1));
    }, 1000);
    return () => clearInterval(interval);
  }, [open, countdown]);

  // Guard: the informational "Half Time" popup should ONLY render at the
  // genuine halftime boundary (timer paused at H2/elapsed≤5) AND only when
  // the user hasn't already acknowledged this game's halftime prompt.
  // Uses the shared `canShowHalftimePrompt` helper so every open site —
  // PitchBoard.handleHalfChange, useAutoSubScheduler.checkHalftimeSubs,
  // GlobalSubMonitor — applies the exact same gating, and the dialog
  // self-dismisses if it somehow opens outside that window.
  useEffect(() => {
    if (!open || !isHalftimeOnly) return;
    const t = loadTimerStateForMinutes();
    const p = t?.teamId ? loadPitchState(t.teamId) : null;
    if (!canShowHalftimePrompt(t, p)) {
      onAcknowledgeHalftime?.();
      onOpenChange(false);
    }
  }, [open, isHalftimeOnly, onAcknowledgeHalftime, onOpenChange]);

  if (!open) return null;
  if (!substitution && !isHalftimeOnly) return null;
  
  const isDue = countdown <= 0;
  
  const formatTime = (seconds: number) => {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };
  
  const getTotalSteps = () => {
    let steps = 0;
    for (const sub of allSubs) {
      steps += 2;
      if (sub.positionSwap) steps += 1;
    }
    return steps;
  };
  
  const renderSubSteps = (sub: SubstitutionEvent, startStep: number, subIndex: number) => {
    const playerOut = players.find(p => p.id === sub.playerOut.id) || sub.playerOut;
    const playerIn = players.find(p => p.id === sub.playerIn.id) || sub.playerIn;
    
    const outPos = playerOut.currentPitchPosition || sub.playerOut.currentPitchPosition;
    const specificOutPos = outPos ? getSpecificPositionLabel(playerOut.position?.x, outPos) : 'Unknown';
    const inTargetPos = sub.positionSwap ? sub.positionSwap.fromPosition : outPos;
    const specificInPos = inTargetPos ? getSpecificPositionLabel(
      sub.positionSwap ? sub.positionSwap.player.position?.x : playerOut.position?.x,
      inTargetPos
    ) : 'Unknown';
    const inPosColors = inTargetPos ? POSITION_COLORS[inTargetPos] : null;
    
    return (
      <div key={sub.playerOut.id + sub.playerIn.id} className="space-y-2">
        {isBatchSub && (
          <div className="flex items-center gap-2 pt-2 first:pt-0">
            <Badge variant="outline" className="text-xs">
              Sub {subIndex + 1}
            </Badge>
          </div>
        )}
        
        {/* Player coming off */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-destructive text-destructive-foreground text-sm font-bold flex-shrink-0">
            {playerOut.number || playerOut.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{playerOut.name}</div>
            <div className="text-xs text-muted-foreground">
              {specificOutPos} → Bench
            </div>
          </div>
          <span className="text-sm font-bold text-destructive flex-shrink-0">OUT</span>
        </div>
        
        {/* Player coming on */}
        <div className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white text-sm font-bold flex-shrink-0">
            {playerIn.number || playerIn.name.slice(0, 2).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="font-semibold text-sm">{playerIn.name}</div>
            <div className="text-xs text-muted-foreground">
              Bench → {specificInPos}
            </div>
          </div>
          {inPosColors && (
            <span className={cn("text-xs font-bold flex-shrink-0 uppercase", inPosColors.text)}>
              {specificInPos}
            </span>
          )}
        </div>
        
        {/* Position swap */}
        {sub.positionSwap && (() => {
          const swapFromSpecific = getSpecificPositionLabel(sub.positionSwap!.player.position?.x, sub.positionSwap!.fromPosition);
          const swapToSpecific = getSpecificPositionLabel(playerOut.position?.x, sub.positionSwap!.toPosition);
          const toColors = POSITION_COLORS[sub.positionSwap!.toPosition];
          return (
            <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
              <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
                {sub.positionSwap!.player.number || sub.positionSwap!.player.name.slice(0, 2).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-semibold text-sm">{sub.positionSwap!.player.name}</div>
                <div className="text-xs text-muted-foreground">
                  {swapFromSpecific} → {swapToSpecific}
                </div>
              </div>
              <span className={cn("text-xs font-bold flex-shrink-0 uppercase", toColors.text)}>
                {swapToSpecific}
              </span>
            </div>
          );
        })()}
      </div>
    );
  };
  
  const getStepOffset = (subIndex: number) => {
    let offset = 1;
    for (let i = 0; i < subIndex; i++) {
      offset += 2;
      if (allSubs[i].positionSwap) offset += 1;
    }
    return offset;
  };
  
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className={cn("sm:max-w-sm", isBatchSub && "sm:max-w-md")}>
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            {wasSkipped ? (
              <>
                <X className="h-5 w-5 text-muted-foreground" />
                Substitution Was Skipped
              </>
            ) : alreadyExecuted ? (
              <>
                <Check className="h-5 w-5 text-muted-foreground" />
                Substitution Already Made
              </>
            ) : isGameFinished ? (
              <>
                <Timer className="h-5 w-5 text-muted-foreground" />
                Game Has Finished
              </>
            ) : isHalftimeOnly ? (
              <>
                <Timer className="h-5 w-5" />
                Half Time
              </>
            ) : isHalftime ? (
              <>
                <Timer className="h-5 w-5" />
                {isBatchSub ? `Halftime — ${allSubs.length} Substitutions` : "Halftime Substitution"}
              </>
            ) : isBatchSub ? (
              <>
                <Users className="h-5 w-5" />
                {isDue ? `Make ${allSubs.length} Substitutions` : `${allSubs.length} Upcoming Substitutions`}
              </>
            ) : (
              <>
                <ArrowLeftRight className="h-5 w-5" />
                {isDue ? "Make This Substitution" : "Upcoming Substitution"}
              </>
            )}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {isHalftimeOnly
              ? "It's half time! No substitutions are scheduled for this break."
              : wasSkipped
              ? "This substitution was skipped and not made"
              : alreadyExecuted
              ? "This substitution has already been completed"
              : isGameFinished
              ? "This substitution was not made before the game ended"
              : isHalftime
              ? `${isBatchSub ? `${allSubs.length} substitutions are` : "A substitution is"} scheduled for the halftime break`
              : isDue 
                ? undefined
                : `${formatTime(substitution!.time)} - ${substitution!.half === 1 ? "1st" : "2nd"} Half`}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        
        {/* Halftime banner */}
        {isHalftime && isDue && !alreadyExecuted && !wasSkipped && (
          <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-amber-500/15 border border-amber-500/30">
            <Timer className="h-5 w-5 text-amber-500" />
            <span className="text-sm font-bold text-amber-600 dark:text-amber-400 uppercase tracking-wide">
              Half Time
            </span>
          </div>
        )}
        
        {/* Countdown timer when not yet due */}
        {!isDue && !isHalftime && (
          <div className="flex items-center justify-center gap-2 p-3 rounded-lg bg-primary/10 border border-primary/20">
            <Clock className="h-5 w-5 text-primary animate-pulse" />
            <div className="text-center">
              <div className="text-lg font-bold text-primary">
                {Math.floor(countdown / 60)}:{(countdown % 60).toString().padStart(2, '0')}
              </div>
              <div className="text-xs text-muted-foreground">until sub{isBatchSub ? 's are' : ' is'} due</div>
            </div>
          </div>
        )}
        
        {/* Scrollable area for sub steps */}
        {allSubs.length > 0 && (
          <div className="overflow-y-auto overscroll-contain py-2" style={{ maxHeight: '50vh' }}>
            <div className="space-y-3 pr-1">
              {allSubs.map((sub, index) => (
                renderSubSteps(sub, getStepOffset(index), index)
              ))}
            </div>
          </div>
        )}
        
        <ResponsiveDialogFooter className="flex-row gap-2 sm:gap-2">
          {isHalftimeOnly ? (
            <Button onClick={() => { onAcknowledgeHalftime?.(); onOpenChange(false); }} className="flex-1 gap-2 h-12 text-base">
              <Check className="h-4 w-4" />
              OK
            </Button>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)} className="gap-2 h-12 text-base">
                <X className="h-4 w-4" />
                Close
              </Button>
              {isDue && !wasSkipped && !isGameFinished && (
                <>
                  <Button variant="outline" onClick={onSkip} disabled={alreadyExecuted} className="gap-2 h-12 text-base">
                    <X className="h-4 w-4" />
                    Skip
                  </Button>
                  <Button onClick={onConfirm} disabled={alreadyExecuted} className="flex-1 gap-2 h-12 text-base">
                    <Check className="h-4 w-4" />
                    {alreadyExecuted ? 'Done' : `Confirm${isBatchSub ? ` All` : ''}`}
                  </Button>
                </>
              )}
            </>
          )}
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
