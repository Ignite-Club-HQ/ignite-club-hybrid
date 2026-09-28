import { useRef } from "react";
import type { TeamSize, PitchBoardState } from "../types";
import { FORMATIONS } from "../types";
import { loadPitchState } from "../pitchStateUtils";

const SAVED_DEFAULT_TEAM_SIZES: TeamSize[] = ["3", "4", "5", "7", "9", "11"];
export const isSavedDefaultTeamSize = (value: string): value is TeamSize =>
  SAVED_DEFAULT_TEAM_SIZES.includes(value as TeamSize);

interface UsePitchBoardInitialStateArgs {
  teamId: string;
  initialTeamSize: string | number | undefined;
  initialFormation: string | null | undefined;
}

export interface UsePitchBoardInitialStateResult {
  savedState: PitchBoardState | null;
  getInitialTeamSize: () => TeamSize;
  getInitialFormationIndex: (size: TeamSize) => number;
}

/**
 * Step 9b — One-shot saved-state load + initial team-size/formation resolution
 * for PitchBoard. Saved state always wins; otherwise falls back to the parent
 * defaults; otherwise the canonical "7" / first formation.
 */
export function usePitchBoardInitialState({
  teamId,
  initialTeamSize,
  initialFormation,
}: UsePitchBoardInitialStateArgs): UsePitchBoardInitialStateResult {
  const savedStateLoadedRef = useRef(false);
  const savedStateRef = useRef<PitchBoardState | null>(null);
  if (!savedStateLoadedRef.current) {
    savedStateLoadedRef.current = true;
    const loaded = loadPitchState(teamId);
    savedStateRef.current = loaded;
    console.log(
      "[PitchState] Initial load result:",
      loaded ? "found" : "not found",
      "teamId:",
      teamId,
    );
  }
  const savedState = savedStateRef.current;

  const getInitialTeamSize = (): TeamSize => {
    if (savedState?.teamSize) return savedState.teamSize;
    const candidateSize = String(initialTeamSize || "");
    if (candidateSize && isSavedDefaultTeamSize(candidateSize)) {
      return candidateSize;
    }
    return "7";
  };

  const getInitialFormationIndex = (size: TeamSize): number => {
    if (savedState?.selectedFormation !== undefined) return savedState.selectedFormation;
    if (initialFormation) {
      const formations = FORMATIONS[size];
      const index = formations.findIndex((f) => f.name === initialFormation);
      if (index >= 0) return index;
    }
    return 0;
  };

  return { savedState, getInitialTeamSize, getInitialFormationIndex };
}
