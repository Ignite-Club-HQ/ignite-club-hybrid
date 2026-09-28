import { Button } from "@/components/ui/button";
import { ArrowLeftRight, AlertTriangle, CheckCircle, X } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { getSpecificPositionLabel } from "./types";
import { cn } from "@/lib/utils";
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

interface AccommodationOption {
  accommodator: Player;
  accommodatorMovesTo: PitchPosition;
  description: string;
}

interface PitchSwapConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player1: Player | null;
  player2: Player | null;
  allPitchPlayers?: Player[];
  onConfirm: () => void;
  onCancel: () => void;
  onConfirmWithAccommodation?: (accommodatorId: string, accommodatorNewPosition: PitchPosition) => void;
}

export default function PitchSwapConfirmDialog({
  open,
  onOpenChange,
  player1,
  player2,
  allPitchPlayers = [],
  onConfirm,
  onCancel,
  onConfirmWithAccommodation,
}: PitchSwapConfirmDialogProps) {
  if (!player1 || !player2) return null;

  const pos1 = player1.currentPitchPosition;
  const pos2 = player2.currentPitchPosition;

  const specificPos1 = pos1 ? getSpecificPositionLabel(player1.position?.x, pos1) : null;
  const specificPos2 = pos2 ? getSpecificPositionLabel(player2.position?.x, pos2) : null;
  
  const canPlayPosition = (player: Player, position: PitchPosition): boolean => {
    if (!player.assignedPositions?.length) return true;
    return player.assignedPositions.includes(position);
  };

  const player1CanPlayPos2 = !pos2 || canPlayPosition(player1, pos2);
  const player2CanPlayPos1 = !pos1 || canPlayPosition(player2, pos1);
  const canSwap = player1CanPlayPos2 && player2CanPlayPos1;
  
  const pos1Colors = pos1 ? POSITION_COLORS[pos1] : null;
  const pos2Colors = pos2 ? POSITION_COLORS[pos2] : null;

  // Find accommodation options when there's a mismatch
  const accommodationOptions: AccommodationOption[] = [];
  
  if (!canSwap && pos1 && pos2) {
    const otherPlayers = allPitchPlayers.filter(
      p => p.id !== player1.id && p.id !== player2.id && p.currentPitchPosition
    );

    for (const accommodator of otherPlayers) {
      const accPos = accommodator.currentPitchPosition!;
      
      // Case 1: player1 can't play pos2
      // Find accommodator who can play pos2, and player1 can play accommodator's position
      if (!player1CanPlayPos2 && canPlayPosition(accommodator, pos2) && canPlayPosition(player1, accPos) && player2CanPlayPos1) {
        accommodationOptions.push({
          accommodator,
          accommodatorMovesTo: pos2,
          description: `${accommodator.name} moves from ${accPos} → ${pos2}, ${player1.name} takes ${accPos}`,
        });
      }
      
      // Case 2: player2 can't play pos1
      // Find accommodator who can play pos1, and player2 can play accommodator's position
      if (!player2CanPlayPos1 && canPlayPosition(accommodator, pos1) && canPlayPosition(player2, accPos) && player1CanPlayPos2) {
        accommodationOptions.push({
          accommodator,
          accommodatorMovesTo: pos1,
          description: `${accommodator.name} moves from ${accPos} → ${pos1}, ${player2.name} takes ${accPos}`,
        });
      }

      // Case 3: both can't play - accommodator covers pos2, another path for pos1
      // (This gets complex; keep it simple for now with single-accommodator solutions)
    }
  }

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <ArrowLeftRight className="h-5 w-5" />
            {canSwap ? "Confirm Position Swap" : "Position Swap"}
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {!canSwap ? "Position mismatch — choose an option below" : ""}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 overflow-y-auto space-y-3 py-2">
          {/* Player 1 swap */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
              {player1.number || player1.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{player1.name}</div>
              <div className="text-xs text-muted-foreground">
                {specificPos1 || pos1} → {specificPos2 || pos2 || 'new position'}
              </div>
            </div>
            {pos2 && pos2Colors && (
              <span className={cn("text-xs font-bold flex-shrink-0 uppercase", pos2Colors.text)}>{specificPos2 || pos2}</span>
            )}
          </div>
          
          {/* Swap arrow */}
          <div className="flex justify-center">
            <ArrowLeftRight className="h-4 w-4 text-muted-foreground" />
          </div>

          {/* Player 2 swap */}
          <div className="flex items-center gap-3 p-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
            <div className="flex items-center justify-center w-7 h-7 rounded-full bg-blue-500 text-white text-sm font-bold flex-shrink-0">
              {player2.number || player2.name.slice(0, 2).toUpperCase()}
            </div>
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-sm">{player2.name}</div>
              <div className="text-xs text-muted-foreground">
                {specificPos2 || pos2} → {specificPos1 || pos1 || 'new position'}
              </div>
            </div>
            {pos1 && pos1Colors && (
              <span className={cn("text-xs font-bold flex-shrink-0 uppercase", pos1Colors.text)}>{specificPos1 || pos1}</span>
            )}
          </div>

          {/* Warning + accommodation options if mismatch */}
          {!canSwap && (
            <>
              <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
                <div>
                  <p className="font-medium text-yellow-600 dark:text-yellow-400 text-sm">Position Mismatch</p>
                  <p className="text-muted-foreground text-xs mt-0.5">
                    {!player1CanPlayPos2 && `${player1.name} isn't assigned to ${pos2}. `}
                    {!player2CanPlayPos1 && `${player2.name} isn't assigned to ${pos1}.`}
                  </p>
                </div>
              </div>

              {accommodationOptions.length > 0 && onConfirmWithAccommodation && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                    Suggested Accommodations
                  </p>
                  {accommodationOptions.map((option, idx) => {
                    const accPos = option.accommodator.currentPitchPosition!;
                    const accPosColors = POSITION_COLORS[accPos];
                    const targetPosColors = POSITION_COLORS[option.accommodatorMovesTo];
                    return (
                      <Button
                        key={idx}
                        variant="outline"
                        className="w-full justify-start h-auto p-3 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
                        onClick={() => onConfirmWithAccommodation(option.accommodator.id, option.accommodatorMovesTo)}
                      >
                        <div className="flex flex-col gap-1 w-full text-left">
                          <div className="flex items-center gap-2">
                            <div className={cn(
                              "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                              "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                            )}>
                              {option.accommodator.number || option.accommodator.name.slice(0, 2).toUpperCase()}
                            </div>
                            <span className="font-medium text-sm">{option.accommodator.name}</span>
                            <span className={cn("text-xs font-bold", accPosColors.text)}>{accPos}</span>
                            <span className="text-xs text-muted-foreground">→</span>
                            <span className={cn("text-xs font-bold", targetPosColors.text)}>{option.accommodatorMovesTo}</span>
                          </div>
                          <p className="text-xs text-muted-foreground pl-9">
                            {option.description}
                          </p>
                        </div>
                      </Button>
                    );
                  })}
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
            <CheckCircle className="h-4 w-4" />
            {canSwap ? "Confirm" : "Swap Anyway"}
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
