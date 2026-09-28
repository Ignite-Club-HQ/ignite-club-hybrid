import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
  ResponsiveDialogFooter,
} from "@/components/ui/responsive-dialog";
import { Button } from "@/components/ui/button";
import { ArrowRight, Check, AlertCircle } from "lucide-react";
import { PitchPosition, POSITION_COLORS } from "./PositionBadge";
import { cn } from "@/lib/utils";
import { MiniLeagueTeams, getSpecificPositionLabel } from "./types";

interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  isInjured?: boolean;
  teamSide?: "a" | "b";
}

interface SubOption {
  pitchPlayer: Player;
  positionLabel: string;
}

interface BenchToSubDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  benchPlayer: Player | null;
  allPitchPlayers: Player[];
  onSelectOption: (pitchPlayerId: string, swapPlayerId?: string) => void;
  miniLeagueTeams?: MiniLeagueTeams;
}

export default function BenchToSubDialog({
  open,
  onOpenChange,
  benchPlayer,
  allPitchPlayers,
  onSelectOption,
  miniLeagueTeams,
}: BenchToSubDialogProps) {
  if (!benchPlayer) return null;

  const benchPlayerTeam = benchPlayer.teamSide;
  const isMiniLeague = !!miniLeagueTeams && !!benchPlayerTeam;

  const filteredPitchPlayers = isMiniLeague
    ? allPitchPlayers.filter(p => p.teamSide === benchPlayerTeam)
    : allPitchPlayers;

  const canPlayPosition = (player: Player, position: PitchPosition): boolean => {
    if (!player.assignedPositions?.length) return true;
    return player.assignedPositions.includes(position);
  };

  // Find pitch players this bench player can replace directly. Position-swap
  // permutations are intentionally not listed here: they create noisy duplicate
  // rows and are handled by drag-to-swap on the pitch before making a sub.
  const options: SubOption[] = [];

  filteredPitchPlayers.forEach(pitchPlayer => {
    if (!pitchPlayer.currentPitchPosition) return;
    
    const pos = pitchPlayer.currentPitchPosition;
    if (!canPlayPosition(benchPlayer, pos)) return;
    options.push({
      pitchPlayer,
      positionLabel: getSpecificPositionLabel(pitchPlayer.position?.x, pos),
    });
  });

  const hasNoOptions = options.length === 0;

  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent className="sm:max-w-md max-h-[82vh] overflow-hidden flex flex-col p-0">
        <ResponsiveDialogHeader className="px-5 pt-5 pb-3 border-b border-border text-left">
          <ResponsiveDialogTitle>Choose player off</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            <span className="font-medium text-foreground">{benchPlayer.name}</span> will come onto the pitch.
          </ResponsiveDialogDescription>
        </ResponsiveDialogHeader>

        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-4 space-y-2">
          {options.length > 0 && (
            <div className="space-y-2">
              {options.map((option) => {
                const pos = option.pitchPlayer.currentPitchPosition!;
                const posColors = POSITION_COLORS[pos];
                return (
                  <button
                    key={option.pitchPlayer.id}
                    type="button"
                    className="w-full rounded-lg border border-border bg-card p-3 text-left transition-colors hover:bg-muted/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => onSelectOption(option.pitchPlayer.id)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full border border-destructive/30 bg-destructive/10 text-sm font-bold text-destructive">
                        {option.pitchPlayer.number || option.pitchPlayer.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 min-w-0">
                          <p className="truncate text-sm font-semibold text-foreground">{option.pitchPlayer.name}</p>
                          <span className={cn("shrink-0 text-[10px] font-bold uppercase", posColors.text)}>
                            {option.positionLabel}
                          </span>
                        </div>
                        <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground min-w-0">
                          <span className="shrink-0">Bench</span>
                          <ArrowRight className="h-3 w-3 shrink-0" />
                          <span className="truncate">{benchPlayer.name} takes {option.positionLabel}</span>
                        </div>
                      </div>
                      <Check className="h-4 w-4 shrink-0 text-muted-foreground" />
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {hasNoOptions && (
            <div className="text-center py-8 text-muted-foreground">
              <AlertCircle className="h-8 w-8 mx-auto mb-2 opacity-50" />
              <p className="text-sm">No substitution options available.</p>
              <p className="text-xs mt-1">
                {benchPlayer.name} cannot cover any current pitch positions.
              </p>
            </div>
          )}
        </div>

        <ResponsiveDialogFooter className="border-t border-border px-5 py-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} className="w-full h-11 text-base">
            Cancel
          </Button>
        </ResponsiveDialogFooter>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
