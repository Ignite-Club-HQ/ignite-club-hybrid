import { memo, useState } from "react";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { HeartOff, UserRoundCheck } from "lucide-react";
import { Player } from "./types";
import PositionBadge from "./PositionBadge";
import { cn } from "@/lib/utils";
import { ScrollArea } from "@/components/ui/scroll-area";

interface PitchPlayerActionMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  player: Player | null;
  benchPlayers: Player[];
  onMarkInjured: (playerId: string, replacementId?: string) => void;
}

const PitchPlayerActionMenu = memo(function PitchPlayerActionMenu({
  open,
  onOpenChange,
  player,
  benchPlayers,
  onMarkInjured,
}: PitchPlayerActionMenuProps) {
  const [step, setStep] = useState<"action" | "pick-replacement">("action");
  const [selectedReplacement, setSelectedReplacement] = useState<string | null>(null);

  if (!player) return null;

  const injuredPos = player.currentPitchPosition;
  // Filter to eligible bench players: prefer those assigned to the injured player's position, then others
  const eligibleBench = benchPlayers.filter(p => !p.isInjured);
  const positionMatch = injuredPos ? eligibleBench.filter(p => p.assignedPositions?.includes(injuredPos)) : [];
  const others = injuredPos ? eligibleBench.filter(p => !p.assignedPositions?.includes(injuredPos)) : eligibleBench;
  const availableBench = [...positionMatch, ...others];

  const handleClose = () => {
    onOpenChange(false);
    // Reset state after close animation
    setTimeout(() => {
      setStep("action");
      setSelectedReplacement(null);
    }, 200);
  };

  const handleConfirmInjury = () => {
    const id = player.id;
    const repId = selectedReplacement || undefined;
    handleClose();
    setTimeout(() => onMarkInjured(id, repId), 50);
  };

  return (
    <AlertDialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <AlertDialogContent className="max-w-[320px] rounded-xl p-4 z-[999999]">
        {step === "action" && (
          <>
            <AlertDialogHeader className="pb-2">
              <AlertDialogTitle className="text-base">
                {player.number ? `#${player.number} ` : ""}{player.name}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                {player.currentPitchPosition || "On pitch"}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <div className="space-y-2">
              <Button
                variant="destructive"
                size="sm"
                className="w-full h-10 text-sm gap-2 justify-start"
                onClick={() => {
                  if (availableBench.length > 0) {
                    setStep("pick-replacement");
                  } else {
                    // No bench players, just mark injured without replacement
                    handleConfirmInjury();
                  }
                }}
              >
                <HeartOff className="h-4 w-4" />
                Mark Injured &amp; Sub Off
              </Button>
            </div>
            <AlertDialogFooter className="pt-1">
              <AlertDialogCancel className="h-9 text-sm">Cancel</AlertDialogCancel>
            </AlertDialogFooter>
          </>
        )}

        {step === "pick-replacement" && (
          <>
            <AlertDialogHeader className="pb-2">
              <AlertDialogTitle className="text-sm">
                Replace {player.name}
              </AlertDialogTitle>
              <AlertDialogDescription className="text-xs">
                Choose who comes on{injuredPos ? ` at ${injuredPos}` : ""}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <ScrollArea className="max-h-[240px]">
              <div className="space-y-1">
                {availableBench.map(bp => (
                  <button
                    key={bp.id}
                    onClick={() => setSelectedReplacement(bp.id)}
                    className={cn(
                      "flex items-center gap-2 w-full px-2.5 py-2 rounded-lg text-left transition-all border",
                      selectedReplacement === bp.id
                        ? "border-primary bg-primary/10 ring-1 ring-primary"
                        : "border-transparent hover:bg-muted"
                    )}
                  >
                    <div className="w-7 h-7 rounded-full bg-primary/20 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                      {bp.number || bp.name.split(" ").map(n => n[0]).join("").toUpperCase().slice(0, 2)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <span className="text-sm font-medium truncate block">{bp.name}</span>
                      {bp.assignedPositions && bp.assignedPositions.length > 0 && (
                        <div className="flex gap-0.5 mt-0.5">
                          {bp.assignedPositions.map(pos => (
                            <PositionBadge key={pos} position={pos} size="sm" />
                          ))}
                        </div>
                      )}
                    </div>
                    {selectedReplacement === bp.id && (
                      <UserRoundCheck className="h-4 w-4 text-primary shrink-0" />
                    )}
                  </button>
                ))}
              </div>
            </ScrollArea>

            <div className="flex gap-2 pt-2">
              <Button variant="outline" className="flex-1 h-9 text-sm" onClick={handleClose}>
                Cancel
              </Button>
              <Button
                variant="destructive"
                className="flex-1 h-9 text-sm"
                disabled={!selectedReplacement}
                onClick={handleConfirmInjury}
              >
                Confirm Sub
              </Button>
            </div>
          </>
        )}
      </AlertDialogContent>
    </AlertDialog>
  );
});

export default PitchPlayerActionMenu;
