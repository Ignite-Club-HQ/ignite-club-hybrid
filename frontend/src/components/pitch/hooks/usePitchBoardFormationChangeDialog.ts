import { useCallback, useState, MutableRefObject } from "react";
import { Player, TeamSize } from "../types";
import { PitchPosition } from "../PositionBadge";

export interface PendingFormationChange {
  index: number;
  newTeamSize?: TeamSize;
  positionSwaps: { player: Player; fromPosition: PitchPosition; toPosition: PitchPosition; fromX?: number; toX?: number }[];
  benchMoves: { player: Player; direction: "to-pitch" | "to-bench"; position?: PitchPosition }[];
  minorAdjustments?: { player: Player; fromLabel: string; toLabel: string }[];
}

export interface FormationChangeDialogDeps {
  players: Player[];
  setPlayers: (p: Player[]) => void;
  setTeamSize: (s: TeamSize) => void;
  setSelectedFormation: (i: number) => void;
  autoPlacePlayersOnPitch: (players: Player[], teamSize: TeamSize, formationIndex: number) => Player[];
  persistTeamSizeToDb: (size: TeamSize) => void;
  notifyFormationOrSizeChange: (
    kind: 'formation' | 'team_size',
    value: string,
    details: {
      positionSwaps: PendingFormationChange["positionSwaps"];
      benchMoves: PendingFormationChange["benchMoves"];
    }
  ) => void;
  applyFormationChange: (
    index: number,
    changeDetails?: {
      positionSwaps: PendingFormationChange["positionSwaps"];
      benchMoves: PendingFormationChange["benchMoves"];
    }
  ) => void;
  setToolbarCollapsed: (v: boolean) => void;
  setPortraitSheetOpen: (v: boolean) => void;
  autoSubActive: boolean;
  regeneratePlanRef: MutableRefObject<(() => void) | null>;
  toast: (opts: { title: string; description?: string }) => void;
}

/**
 * Owns formation-change confirmation dialog state and the confirm/cancel
 * handlers. Reads dependencies via a ref so it can be called early in the
 * component (before `applyFormationChange` etc. are defined).
 */
export function usePitchBoardFormationChangeDialog(
  depsRef: MutableRefObject<FormationChangeDialogDeps | null>
) {
  const [formationChangeDialogOpen, setFormationChangeDialogOpen] = useState(false);
  const [pendingFormationChange, setPendingFormationChange] = useState<PendingFormationChange | null>(null);

  const handleFormationChangeConfirm = useCallback(() => {
    const deps = depsRef.current;
    if (!deps) return;
    if (pendingFormationChange) {
      if (pendingFormationChange.newTeamSize) {
        const newSize = pendingFormationChange.newTeamSize;
        deps.setTeamSize(newSize);
        deps.setSelectedFormation(0);
        const placedPlayers = deps.autoPlacePlayersOnPitch(deps.players, newSize, 0);
        deps.setPlayers(placedPlayers);
        deps.persistTeamSizeToDb(newSize);
        deps.notifyFormationOrSizeChange('team_size', newSize, {
          positionSwaps: pendingFormationChange.positionSwaps,
          benchMoves: pendingFormationChange.benchMoves,
        });
      } else {
        deps.applyFormationChange(pendingFormationChange.index, {
          positionSwaps: pendingFormationChange.positionSwaps,
          benchMoves: pendingFormationChange.benchMoves,
        });
      }
    }
    setFormationChangeDialogOpen(false);
    setPendingFormationChange(null);
    deps.setToolbarCollapsed(true);
    deps.setPortraitSheetOpen(false);

    if (deps.autoSubActive) {
      setTimeout(() => {
        deps.regeneratePlanRef.current?.();
        deps.toast({ title: "Auto-sub plan updated", description: "Plan regenerated to account for formation change" });
      }, 300);
    }
  }, [depsRef, pendingFormationChange]);

  const handleFormationChangeCancel = useCallback(() => {
    setFormationChangeDialogOpen(false);
    setPendingFormationChange(null);
  }, []);

  return {
    formationChangeDialogOpen,
    setFormationChangeDialogOpen,
    pendingFormationChange,
    setPendingFormationChange,
    handleFormationChangeConfirm,
    handleFormationChangeCancel,
  };
}
