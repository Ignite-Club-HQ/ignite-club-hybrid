import { Button } from "@/components/ui/button";
import { ArrowLeftRight, Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { getSpecificPositionLabel } from "./types";
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

interface PositionSwap {
  player: Player;
  fromPosition: PitchPosition;
  toPosition: PitchPosition;
}

interface ManualSubConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  playerOut: Player | null;
  playerIn: Player | null;
  positionSwap?: PositionSwap | null;
  onConfirm: () => void;
  onCancel: () => void;
}

export default function ManualSubConfirmDialog({
  open,
  onOpenChange,
  playerOut,
  playerIn,
  positionSwap,
  onConfirm,
  onCancel,
}: ManualSubConfirmDialogProps) {
  if (!playerOut || !playerIn) return null;

  const outPos = playerOut.currentPitchPosition;
  const specificOutPos = outPos ? getSpecificPositionLabel(playerOut.position?.x, outPos) : 'Unknown';
  const inTargetPos = positionSwap ? positionSwap.fromPosition : outPos;
  const specificInPos = inTargetPos ? getSpecificPositionLabel(
    positionSwap ? positionSwap.player.position?.x : playerOut.position?.x,
    inTargetPos
  ) : 'Unknown';
  const outPosColors = outPos ? POSITION_COLORS[outPos] : null;
  const inPosColors = inTargetPos ? POSITION_COLORS[inTargetPos] : null;
  
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-sm">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <ArrowLeftRight className="h-5 w-5" />
            Make This Substitution
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="sr-only">
            Substitution details
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>
        
        <div className="space-y-3 py-2">
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
          
          {/* Position swap (if applicable) */}
          {positionSwap && (() => {
            const swapFromSpecific = getSpecificPositionLabel(positionSwap.player.position?.x, positionSwap.fromPosition);
            const swapToSpecific = getSpecificPositionLabel(playerOut.position?.x, positionSwap.toPosition);
            const toColors = POSITION_COLORS[positionSwap.toPosition];
            return (
              <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
                  {positionSwap.player.number || positionSwap.player.name.slice(0, 2).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm">{positionSwap.player.name}</div>
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
        
        <ResponsiveDialogFooter className="flex-row gap-2 sm:gap-2">
          <Button variant="outline" onClick={onCancel} className="flex-1 gap-2 h-12 text-base">
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button onClick={onConfirm} className="flex-1 gap-2 h-12 text-base">
            <Check className="h-4 w-4" />
            Confirm
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
