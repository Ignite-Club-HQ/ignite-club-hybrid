import { Button } from "@/components/ui/button";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Users, Check, X } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { Player, getSpecificPositionLabel } from "./types";

interface PositionSwap {
  player: Player;
  fromPosition: PitchPosition;
  toPosition: PitchPosition;
  fromX?: number;
  toX?: number;
}

interface BenchMove {
  player: Player;
  direction: "to-pitch" | "to-bench";
  position?: PitchPosition;
}

interface MinorAdjustment {
  player: Player;
  fromLabel: string;
  toLabel: string;
}

interface FormationChangeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  currentFormation: string;
  newFormation: string;
  positionSwaps: PositionSwap[];
  benchMoves?: BenchMove[];
  minorAdjustments?: MinorAdjustment[];
  onConfirm: () => void;
  onCancel: () => void;
  isTeamSizeChange?: boolean;
  currentTeamSize?: string;
  newTeamSize?: string;
}

export default function FormationChangeDialog({
  open,
  onOpenChange,
  currentFormation,
  newFormation,
  positionSwaps,
  benchMoves = [],
  minorAdjustments = [],
  onConfirm,
  onCancel,
  isTeamSizeChange,
  currentTeamSize,
  newTeamSize,
}: FormationChangeDialogProps) {
  const playersGoingToPitch = benchMoves.filter(m => m.direction === "to-pitch");
  const playersGoingToBench = benchMoves.filter(m => m.direction === "to-bench");
  const hasChanges = positionSwaps.length > 0 || benchMoves.length > 0 || minorAdjustments.length > 0;

  const subtitle = isTeamSizeChange
    ? `${currentTeamSize} players (${currentFormation}) → ${newTeamSize} players (${newFormation})`
    : `${currentFormation} → ${newFormation}`;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <Users className="h-5 w-5" />
            {isTeamSizeChange ? "Team Size Change" : "Formation Change"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {subtitle}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {!hasChanges ? (
            <p className="text-sm text-muted-foreground">
              No player changes needed. Players will maintain their current roles.
            </p>
          ) : (
            <>
              {/* Players going to bench */}
              {playersGoingToBench.map((move) => (
                <div
                  key={`bench-${move.player.id}`}
                  className="flex items-center gap-3 p-3 rounded-lg bg-destructive/10 border border-destructive/20"
                >
                  <div className="flex items-center justify-center w-7 h-7 rounded-full bg-destructive text-destructive-foreground text-sm font-bold flex-shrink-0">
                    {move.player.number || move.player.name.slice(0, 2).toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-semibold text-sm">{move.player.name}</div>
                    <div className="text-xs text-muted-foreground">
                      {move.position || 'Pitch'} → Bench
                    </div>
                  </div>
                  <span className="text-sm font-bold text-destructive flex-shrink-0">OUT</span>
                </div>
              ))}

              {/* Players coming on to pitch */}
              {playersGoingToPitch.map((move) => {
                const posColors = move.position ? POSITION_COLORS[move.position] : null;
                return (
                  <div
                    key={`pitch-${move.player.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20"
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-emerald-500 text-white text-sm font-bold flex-shrink-0">
                      {move.player.number || move.player.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{move.player.name}</div>
                      <div className="text-xs text-muted-foreground">
                        Bench → {move.position || 'Pitch'}
                      </div>
                    </div>
                    {posColors && (
                      <span className={cn("text-sm font-bold flex-shrink-0", posColors.text)}>
                        {move.position}
                      </span>
                    )}
                  </div>
                );
              })}

              {/* Position swaps */}
              {positionSwaps.map((swap) => {
                const toColors = POSITION_COLORS[swap.toPosition];
                const specificFrom = getSpecificPositionLabel(swap.fromX, swap.fromPosition);
                const specificTo = getSpecificPositionLabel(swap.toX, swap.toPosition);
                return (
                  <div
                    key={`swap-${swap.player.id}`}
                    className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20"
                  >
                    <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
                      {swap.player.number || swap.player.name.slice(0, 2).toUpperCase()}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-sm">{swap.player.name}</div>
                      <div className="text-xs text-muted-foreground">
                        {specificFrom} → {specificTo}
                      </div>
                    </div>
                    <span className={cn("text-xs font-bold flex-shrink-0 uppercase", toColors.text)}>
                      {specificTo}
                    </span>
                  </div>
                );
              })}
              {/* Minor adjustments — subtle compact list */}
              {minorAdjustments.length > 0 && (
                <div className="space-y-1.5 pt-1">
                  <p className="text-[11px] font-medium text-muted-foreground uppercase tracking-wider">
                    Position adjustments
                  </p>
                  {minorAdjustments.map((adj) => (
                    <div
                      key={`minor-${adj.player.id}`}
                      className="flex items-center gap-2 px-3 py-1.5 rounded bg-muted/50 text-sm"
                    >
                      <span className="font-medium text-foreground">{adj.player.name}</span>
                      <span className="text-muted-foreground text-xs">{adj.fromLabel} → {adj.toLabel}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
        </div>

        <ResponsiveDialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1 gap-2 h-12 text-base">
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={onConfirm} className="flex-1 gap-2 h-12 text-base">
            <Check className="h-4 w-4" />
            Apply {isTeamSizeChange ? "Change" : "Formation"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
