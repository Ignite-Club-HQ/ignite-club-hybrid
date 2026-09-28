import { Button } from "@/components/ui/button";
import { ArrowLeftRight, ArrowRight, AlertCircle } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { MiniLeagueTeams } from "./types";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  teamSide?: "a" | "b";
}

interface PositionSwapDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  benchPlayer: Player | null;
  pitchPlayers: Player[];
  requiredPosition: PitchPosition | null;
  onSwapAndSubstitute: (pitchPlayerId: string, swapWithId: string) => void;
  onCancel: () => void;
  miniLeagueTeams?: MiniLeagueTeams;
}

export default function PositionSwapDialog({
  open,
  onOpenChange,
  benchPlayer,
  pitchPlayers,
  requiredPosition,
  onSwapAndSubstitute,
  onCancel,
  miniLeagueTeams,
}: PositionSwapDialogProps) {
  const benchPlayerTeam = benchPlayer?.teamSide;
  const isMiniLeague = !!miniLeagueTeams && !!benchPlayerTeam;

  // Filter pitch players to same team in mini-league mode
  const filteredPitchPlayers = isMiniLeague
    ? pitchPlayers.filter(p => p.teamSide === benchPlayerTeam)
    : pitchPlayers;

  // Find a player currently in the required position (this is the player being subbed off)
  const playerInPosition = filteredPitchPlayers.find(p => p.currentPitchPosition === requiredPosition);

  // Helper to check if a player can play a position
  const canPlayPosition = (player: Player | null, position: PitchPosition): boolean => {
    if (!player) return false;
    // No assigned positions means can play anywhere
    if (!player.assignedPositions?.length) return true;
    return player.assignedPositions.includes(position);
  };

  // Find players who can swap to the required position AND whose position the bench player can take
  const playersWhoCanSwap = filteredPitchPlayers.filter(p => {
    // Can't swap with the player being subbed off (the one in the required position)
    if (p.id === playerInPosition?.id) return false;
    // Swap player must be able to play the required position
    if (!canPlayPosition(p, requiredPosition!)) return false;
    // Bench player must be able to play the swap player's current position
    if (p.currentPitchPosition && !canPlayPosition(benchPlayer, p.currentPitchPosition)) return false;
    return true;
  });

  if (!benchPlayer || !requiredPosition) return null;

  const positionColors = POSITION_COLORS[requiredPosition];

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md max-h-[80vh] overflow-hidden flex flex-col">
        <ResponsiveDialogHeader>
          <ResponsiveDialogTitle className="flex items-center gap-2 text-lg">
            <ArrowLeftRight className="h-5 w-5" />
            Position Swap Needed
          </ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {benchPlayer.name} can't play{" "}
            <span className={cn("font-bold", positionColors.text)}>{requiredPosition}</span>
            {" — choose a player to swap"}
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          {playersWhoCanSwap.length > 0 ? (
            <div className="space-y-2">
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">
                Available Swaps
              </p>
              {playersWhoCanSwap.map(player => {
                const currentPos = player.currentPitchPosition!;
                const currentColors = POSITION_COLORS[currentPos];
                return (
                  <Button
                    key={player.id}
                    variant="outline"
                    className="w-full justify-start h-auto p-3 border-amber-500/30 bg-amber-500/5 hover:bg-amber-500/10"
                    onClick={() => onSwapAndSubstitute(playerInPosition!.id, player.id)}
                  >
                    <div className="flex flex-col gap-1 w-full text-left">
                      <div className="flex items-center gap-2">
                        <div className={cn(
                          "w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                          "bg-amber-500/20 text-amber-500 border border-amber-500/30"
                        )}>
                          {player.number || player.name.slice(0, 2).toUpperCase()}
                        </div>
                        <span className="font-medium text-sm">{player.name}</span>
                        <span className={cn("text-xs font-bold", currentColors.text)}>{currentPos}</span>
                        <ArrowRight className="h-3 w-3 text-muted-foreground" />
                        <span className={cn("text-xs font-bold", positionColors.text)}>{requiredPosition}</span>
                      </div>
                      <p className="text-xs text-muted-foreground pl-9">
                        {playerInPosition?.name} → Bench, {benchPlayer.name} takes{" "}
                        <span className={cn("font-bold", currentColors.text)}>{currentPos}</span>
                      </p>
                    </div>
                  </Button>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-6 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No swap options available.</p>
              <p className="text-xs mt-1">
                No players on the pitch can swap to {requiredPosition}.
                Assign more position options to your players.
              </p>
            </div>
          )}
        </div>

        <ResponsiveDialogFooter>
          <Button variant="outline" onClick={onCancel} className="w-full h-12 text-base">
            Cancel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
