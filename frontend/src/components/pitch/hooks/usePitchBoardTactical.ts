import { useCallback, useMemo, useState } from "react";
import type { MutableRefObject } from "react";
import {
  TacticalMode,
  computeTacticalOffsets,
  computeBallOffset,
  RECOMMENDED_FORMATIONS,
} from "../tacticalMode";
import { FORMATIONS, type TeamSize, type Player } from "../types";

export type TacticalFormationSuggestion = {
  mode: Exclude<TacticalMode, "neutral">;
  formationIndex: number;
  formationName: string;
};

interface UsePitchBoardTacticalArgs {
  players: Player[];
  teamSize: TeamSize;
  selectedFormation: number;
  miniLeagueTeams: unknown;
  ballPosition: { x: number; y: number };
  isDraggingBall: boolean;
  recentlyDraggedBallRef: MutableRefObject<boolean>;
  handleFormationChange: (index: string) => void;
  setToolbarCollapsed: (v: boolean) => void;
  setPortraitSheetOpen: (v: boolean) => void;
}

export function usePitchBoardTactical({
  players,
  teamSize,
  selectedFormation,
  miniLeagueTeams,
  ballPosition,
  isDraggingBall,
  recentlyDraggedBallRef,
  handleFormationChange,
  setToolbarCollapsed,
  setPortraitSheetOpen,
}: UsePitchBoardTacticalArgs) {
  const [tacticalMode, setTacticalMode] = useState<TacticalMode>("neutral");
  const [tacticalFormationSuggestion, setTacticalFormationSuggestion] =
    useState<TacticalFormationSuggestion | null>(null);

  const handleTacticalModeChange = useCallback(
    (mode: TacticalMode) => {
      setTacticalMode(mode);

      if (mode === "neutral") {
        setTacticalFormationSuggestion(null);
        return;
      }

      const rec = RECOMMENDED_FORMATIONS[teamSize];
      const suggestedIndex = mode === "attack" ? rec.attack : rec.defend;
      const suggestedFormation = FORMATIONS[teamSize]?.[suggestedIndex];

      if (suggestedIndex !== selectedFormation && suggestedFormation) {
        setTacticalFormationSuggestion({
          mode,
          formationIndex: suggestedIndex,
          formationName: suggestedFormation.name,
        });
      } else {
        setTacticalFormationSuggestion(null);
      }
    },
    [teamSize, selectedFormation]
  );

  const handleApplyTacticalSuggestion = useCallback(() => {
    if (!tacticalFormationSuggestion) return;
    handleFormationChange(String(tacticalFormationSuggestion.formationIndex));
    setTacticalFormationSuggestion(null);
  }, [tacticalFormationSuggestion, handleFormationChange]);

  const handleDismissTacticalSuggestion = useCallback(() => {
    setTacticalFormationSuggestion(null);
    setToolbarCollapsed(true);
    setPortraitSheetOpen(false);
  }, [setToolbarCollapsed, setPortraitSheetOpen]);

  const tacticalOffsets = useMemo(
    () => computeTacticalOffsets(players, tacticalMode, teamSize, !!miniLeagueTeams),
    [players, tacticalMode, teamSize, miniLeagueTeams]
  );

  const ballOffset = useMemo(
    () =>
      isDraggingBall || recentlyDraggedBallRef.current
        ? { dx: 0, dy: 0 }
        : computeBallOffset(ballPosition, players, tacticalOffsets, tacticalMode),
    [ballPosition, players, tacticalOffsets, tacticalMode, isDraggingBall, recentlyDraggedBallRef]
  );

  return {
    tacticalMode,
    setTacticalMode,
    tacticalFormationSuggestion,
    setTacticalFormationSuggestion,
    handleTacticalModeChange,
    handleApplyTacticalSuggestion,
    handleDismissTacticalSuggestion,
    tacticalOffsets,
    ballOffset,
  };
}
