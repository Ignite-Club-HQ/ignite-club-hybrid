import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from "react";
import { clearPitchState } from "../pitchStateUtils";
import { FORMATIONS, type Player, type SubstitutionEvent, type TeamSize } from "../types";
import type { GameTimerRef } from "../GameTimer";

export interface PitchBoardSavedDefaults {
  minutesPerHalf: number;
  rotationSpeed: number;
  disablePositionSwaps: boolean;
  disableBatchSubs: boolean;
  rotateGkAtHalftime: boolean;
  maxSpreadMinutes: number;
  teamSize: TeamSize;
  formation: string | null;
}

interface PitchBoardResetGameArgs {
  teamId: string;
  players: Player[];
  gameTimerRef: { current: GameTimerRef | null };
  savedTeamDefaultsRef: MutableRefObject<PitchBoardSavedDefaults>;
  hasLoadedRef: MutableRefObject<boolean>;
  autoPlacePlayersOnPitch: (
    players: Player[],
    teamSize: TeamSize,
    formationIndex: number,
  ) => Player[];
  setMinutesPerHalf: Dispatch<SetStateAction<number>>;
  setRotationSpeed: Dispatch<SetStateAction<number>>;
  setDisablePositionSwaps: Dispatch<SetStateAction<boolean>>;
  setDisableBatchSubs: Dispatch<SetStateAction<boolean>>;
  setRotateGkAtHalftime: Dispatch<SetStateAction<boolean>>;
  setMaxSpreadMinutes: Dispatch<SetStateAction<number>>;
  setTeamSize: Dispatch<SetStateAction<TeamSize>>;
  setSelectedFormation: Dispatch<SetStateAction<number>>;
  setPlayers: Dispatch<SetStateAction<Player[]>>;
  setAutoSubPlan: Dispatch<SetStateAction<SubstitutionEvent[]>>;
  setAutoSubActive: Dispatch<SetStateAction<boolean>>;
  setAutoSubPaused: Dispatch<SetStateAction<boolean>>;
  setSubMode: Dispatch<SetStateAction<boolean>>;
  setSelectedOnPitch: Dispatch<SetStateAction<string | null>>;
  setSelectedOnBench: Dispatch<SetStateAction<string | null>>;
  setGameInProgress: Dispatch<SetStateAction<boolean>>;
  setTimerResetKey: Dispatch<SetStateAction<number>>;
  notifyReset: () => void;
}

export function resolveDefaultFormationIndex(
  teamSize: TeamSize,
  formationName: string | null,
): number {
  if (!formationName) return 0;
  const index = FORMATIONS[teamSize].findIndex(
    (formation) => formation.name === formationName,
  );
  return index >= 0 ? index : 0;
}

export function usePitchBoardResetGame({
  teamId,
  players,
  gameTimerRef,
  savedTeamDefaultsRef,
  hasLoadedRef,
  autoPlacePlayersOnPitch,
  setMinutesPerHalf,
  setRotationSpeed,
  setDisablePositionSwaps,
  setDisableBatchSubs,
  setRotateGkAtHalftime,
  setMaxSpreadMinutes,
  setTeamSize,
  setSelectedFormation,
  setPlayers,
  setAutoSubPlan,
  setAutoSubActive,
  setAutoSubPaused,
  setSubMode,
  setSelectedOnPitch,
  setSelectedOnBench,
  setGameInProgress,
  setTimerResetKey,
  notifyReset,
}: PitchBoardResetGameArgs) {
  return useCallback((silent = false, opts?: { preserveLineup?: boolean }) => {
    const preserveLineup = opts?.preserveLineup === true;
    gameTimerRef.current?.resetTimer();

    if (!preserveLineup) {
      const savedDefaults = savedTeamDefaultsRef.current;
      setMinutesPerHalf(savedDefaults.minutesPerHalf);
      setRotationSpeed(savedDefaults.rotationSpeed);
      setDisablePositionSwaps(savedDefaults.disablePositionSwaps);
      setDisableBatchSubs(savedDefaults.disableBatchSubs);
      setRotateGkAtHalftime(savedDefaults.rotateGkAtHalftime);
      setMaxSpreadMinutes(savedDefaults.maxSpreadMinutes);
      setTeamSize(savedDefaults.teamSize);

      const defaultFormationIndex = resolveDefaultFormationIndex(
        savedDefaults.teamSize,
        savedDefaults.formation,
      );
      setSelectedFormation(defaultFormationIndex);

      const resetPlayers = players
        .filter((player) => !player.isFillIn)
        .map((player) => ({ ...player, minutesPlayed: 0 }));
      setPlayers(autoPlacePlayersOnPitch(
        resetPlayers,
        savedDefaults.teamSize,
        defaultFormationIndex,
      ));

      setAutoSubPlan([]);
      setAutoSubActive(false);
      setAutoSubPaused(false);
    } else {
      setPlayers((currentPlayers) => currentPlayers.map((player) => ({
        ...player,
        minutesPlayed: 0,
      })));
    }

    setSubMode(false);
    setSelectedOnPitch(null);
    setSelectedOnBench(null);
    setGameInProgress(false);
    setTimerResetKey((currentKey) => currentKey + 1);

    if (!preserveLineup) {
      clearPitchState(teamId);
      hasLoadedRef.current = false;
    }

    if (!silent) notifyReset();
  }, [
    autoPlacePlayersOnPitch,
    gameTimerRef,
    hasLoadedRef,
    notifyReset,
    players,
    savedTeamDefaultsRef,
    setAutoSubActive,
    setAutoSubPaused,
    setAutoSubPlan,
    setDisableBatchSubs,
    setDisablePositionSwaps,
    setGameInProgress,
    setMaxSpreadMinutes,
    setMinutesPerHalf,
    setPlayers,
    setRotateGkAtHalftime,
    setRotationSpeed,
    setSelectedFormation,
    setSelectedOnBench,
    setSelectedOnPitch,
    setSubMode,
    setTeamSize,
    setTimerResetKey,
    teamId,
  ]);
}
