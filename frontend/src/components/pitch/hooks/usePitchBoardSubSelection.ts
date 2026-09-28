import { useMemo, useState } from "react";
import type { Player } from "../types";

interface UsePitchBoardSubSelectionArgs {
  players: Player[];
  swapMode: boolean;
  swapPlayer1: string | null;
  miniLeagueTeams: unknown;
}

/**
 * Step 8a — Substitution / swap selection state and the
 * derived "who can come on / who can swap / who can move" sets.
 *
 * Pure selection + computation; does NOT trigger the manual-sub
 * confirm dialog (that lives in PitchBoard for now and will move
 * in step 8b).
 */
export function usePitchBoardSubSelection({
  players,
  swapMode,
  swapPlayer1,
  miniLeagueTeams,
}: UsePitchBoardSubSelectionArgs) {
  const [subMode, setSubMode] = useState(false);
  const [selectedOnPitch, setSelectedOnPitch] = useState<string | null>(null);
  const [selectedOnBench, setSelectedOnBench] = useState<string | null>(null);

  const playersOnPitch = useMemo(
    () => players.filter((p) => p.position !== null),
    [players]
  );
  const playersOnBench = useMemo(
    () => players.filter((p) => p.position === null),
    [players]
  );

  // Which bench players can come on for the selected pitch player
  const getValidBenchPlayerIds = useMemo(() => {
    if (!subMode || !selectedOnPitch) return new Set<string>();

    const pitchPlayer = players.find((p) => p.id === selectedOnPitch);
    if (!pitchPlayer?.currentPitchPosition) return new Set<string>();

    const requiredPos = pitchPlayer.currentPitchPosition;
    const validIds = new Set<string>();

    playersOnBench.forEach((benchPlayer) => {
      if (benchPlayer.isInjured) return;

      const canPlayDirectly =
        !benchPlayer.assignedPositions?.length ||
        benchPlayer.assignedPositions.includes(requiredPos);

      if (canPlayDirectly) {
        validIds.add(benchPlayer.id);
        return;
      }

      const otherPitchPlayers = playersOnPitch.filter(
        (p) => p.id !== selectedOnPitch
      );

      for (const otherPitchPlayer of otherPitchPlayers) {
        const canCoverRequiredPos =
          !otherPitchPlayer.assignedPositions?.length ||
          otherPitchPlayer.assignedPositions.includes(requiredPos);

        const benchCanPlayOtherPos =
          !benchPlayer.assignedPositions?.length ||
          benchPlayer.assignedPositions.includes(
            otherPitchPlayer.currentPitchPosition!
          );

        if (
          otherPitchPlayer.currentPitchPosition !== requiredPos &&
          canCoverRequiredPos &&
          benchCanPlayOtherPos
        ) {
          validIds.add(benchPlayer.id);
          break;
        }
      }
    });

    return validIds;
  }, [subMode, selectedOnPitch, players, playersOnBench, playersOnPitch]);

  // Which pitch players can swap with the selected pitch player
  const getValidSwapPlayerIds = useMemo(() => {
    if (!swapMode || !swapPlayer1) return new Set<string>();

    const selectedPlayer = players.find((p) => p.id === swapPlayer1);
    if (!selectedPlayer?.currentPitchPosition) return new Set<string>();

    const selectedPos = selectedPlayer.currentPitchPosition;
    const validIds = new Set<string>();

    playersOnPitch.forEach((pitchPlayer) => {
      if (pitchPlayer.id === swapPlayer1) return;

      if (
        miniLeagueTeams &&
        selectedPlayer.teamSide &&
        pitchPlayer.teamSide &&
        selectedPlayer.teamSide !== pitchPlayer.teamSide
      )
        return;

      const targetPos = pitchPlayer.currentPitchPosition;
      if (!targetPos) return;

      const selectedCanPlayTarget =
        !selectedPlayer.assignedPositions?.length ||
        selectedPlayer.assignedPositions.includes(targetPos);

      const targetCanPlaySelected =
        !pitchPlayer.assignedPositions?.length ||
        pitchPlayer.assignedPositions.includes(selectedPos);

      if (selectedCanPlayTarget && targetCanPlaySelected) {
        validIds.add(pitchPlayer.id);
      }
    });

    return validIds;
  }, [swapMode, swapPlayer1, players, playersOnPitch, miniLeagueTeams]);

  // Which pitch players need to move to accommodate the selected bench player
  const movablePitchPlayerIds = useMemo(() => {
    if (!subMode || !selectedOnBench || !selectedOnPitch)
      return new Set<string>();

    const benchPlayer = players.find((p) => p.id === selectedOnBench);
    const pitchPlayer = players.find((p) => p.id === selectedOnPitch);

    if (!benchPlayer || !pitchPlayer?.currentPitchPosition)
      return new Set<string>();

    const requiredPos = pitchPlayer.currentPitchPosition;

    const canPlayDirectly =
      !benchPlayer.assignedPositions?.length ||
      benchPlayer.assignedPositions.includes(requiredPos);

    if (canPlayDirectly) return new Set<string>();

    const movableIds = new Set<string>();

    playersOnPitch
      .filter((p) => p.id !== selectedOnPitch)
      .forEach((otherPitchPlayer) => {
        const canCoverRequired =
          !otherPitchPlayer.assignedPositions?.length ||
          otherPitchPlayer.assignedPositions.includes(requiredPos);

        const benchCanPlayOther =
          !benchPlayer.assignedPositions?.length ||
          benchPlayer.assignedPositions.includes(
            otherPitchPlayer.currentPitchPosition!
          );

        if (
          otherPitchPlayer.currentPitchPosition !== requiredPos &&
          canCoverRequired &&
          benchCanPlayOther
        ) {
          movableIds.add(otherPitchPlayer.id);
        }
      });

    return movableIds;
  }, [subMode, selectedOnBench, selectedOnPitch, players, playersOnPitch]);

  return {
    subMode,
    setSubMode,
    selectedOnPitch,
    setSelectedOnPitch,
    selectedOnBench,
    setSelectedOnBench,
    getValidBenchPlayerIds,
    getValidSwapPlayerIds,
    movablePitchPlayerIds,
  };
}
