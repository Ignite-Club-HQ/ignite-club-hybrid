import { useEffect, MutableRefObject } from "react";
import type { TeamSize, PitchBoardState } from "../types";
import { FORMATIONS } from "../types";
import { loadTimerStateForMinutes } from "../pitchStateUtils";

const SAVED_DEFAULT_TEAM_SIZES: TeamSize[] = ["3", "4", "5", "7", "9", "11"];
const isSavedDefaultTeamSize = (value: string): value is TeamSize =>
  SAVED_DEFAULT_TEAM_SIZES.includes(value as TeamSize);

export interface SavedTeamDefaults {
  minutesPerHalf: number;
  rotationSpeed: number;
  disablePositionSwaps: boolean;
  disableBatchSubs: boolean;
  rotateGkAtHalftime: boolean;
  maxSpreadMinutes: number;
  teamSize: TeamSize;
  formation: string | null;
}

interface UsePitchBoardPropSyncArgs {
  teamId: string;
  savedState: PitchBoardState | null;
  // Initial props from parent
  initialTeamSize: string | number | undefined;
  initialFormation: string | null | undefined;
  initialMinutesPerHalf: number;
  initialRotationSpeed: number;
  initialDisablePositionSwaps: boolean;
  initialDisableBatchSubs: boolean;
  initialRotateGkAtHalftime: boolean;
  initialMaxSpreadMinutes: number;
  // Live state
  gameInProgress: boolean;
  minutesPerHalf: number;
  // Setters
  setTeamSize: (v: TeamSize) => void;
  setSelectedFormation: (v: number) => void;
  setMinutesPerHalf: (v: number) => void;
  setRotationSpeed: (v: number) => void;
  setDisablePositionSwaps: (v: boolean) => void;
  setDisableBatchSubs: (v: boolean) => void;
  setRotateGkAtHalftime: (v: boolean) => void;
  setMaxSpreadMinutes: (v: number) => void;
  // Defaults ref
  savedTeamDefaultsRef: MutableRefObject<SavedTeamDefaults>;
}

/**
 * Step 9a — Prop → state sync effects for PitchBoard.
 *
 * Mirrors parent-provided team defaults into local board state when no
 * saved state exists, with timer-aware guards on `minutesPerHalf` so a
 * mid-game React Query refetch can never clobber the live half length.
 */
export function usePitchBoardPropSync({
  teamId,
  savedState,
  initialTeamSize,
  initialFormation,
  initialMinutesPerHalf,
  initialRotationSpeed,
  initialDisablePositionSwaps,
  initialDisableBatchSubs,
  initialRotateGkAtHalftime,
  initialMaxSpreadMinutes,
  gameInProgress,
  minutesPerHalf,
  setTeamSize,
  setSelectedFormation,
  setMinutesPerHalf,
  setRotationSpeed,
  setDisablePositionSwaps,
  setDisableBatchSubs,
  setRotateGkAtHalftime,
  setMaxSpreadMinutes,
  savedTeamDefaultsRef,
}: UsePitchBoardPropSyncArgs) {
  useEffect(() => {
    setRotationSpeed(initialRotationSpeed);
  }, [initialRotationSpeed, setRotationSpeed]);

  useEffect(() => {
    setDisablePositionSwaps(initialDisablePositionSwaps);
  }, [initialDisablePositionSwaps, setDisablePositionSwaps]);

  useEffect(() => {
    setDisableBatchSubs(initialDisableBatchSubs);
  }, [initialDisableBatchSubs, setDisableBatchSubs]);

  useEffect(() => {
    setRotateGkAtHalftime(initialRotateGkAtHalftime);
  }, [initialRotateGkAtHalftime, setRotateGkAtHalftime]);

  // Sync minutesPerHalf from props ONLY before the game starts. Once the
  // timer is running (or any elapsed time accumulated), a React Query
  // refetch must NEVER clobber the live half-duration — that would silently
  // shorten/extend the current half and was the cause of the
  // "resets to 10 mins as soon as game starts" bug.
  useEffect(() => {
    if (gameInProgress) {
      console.info('[TimerAudit] PitchBoard mph-sync skipped: gameInProgress', {
        teamId, initialMinutesPerHalf, currentMph: minutesPerHalf,
      });
      return;
    }
    if (!initialMinutesPerHalf || initialMinutesPerHalf <= 0) {
      console.info('[TimerAudit] PitchBoard mph-sync skipped: invalid prop', {
        teamId, initialMinutesPerHalf,
      });
      return;
    }
    // Belt-and-braces: also consult localStorage so a parent refetch landing
    // in the ~1s gap between Play press and the first tick (where
    // `gameInProgress` is still false) cannot snap the live half to a stale
    // `|| 10` fallback. Timer writes `isRunning: true` synchronously on start.
    try {
      const t = loadTimerStateForMinutes(teamId);
      if (t && (t.isRunning || (t.elapsedSeconds && t.elapsedSeconds > 0) || t.currentHalf === 2 || t.isGameFinished)) {
        console.info('[TimerAudit] PitchBoard mph-sync blocked by localStorage', {
          teamId, initialMinutesPerHalf, currentMph: minutesPerHalf, localStorageState: t,
        });
        return;
      }
    } catch { }
    console.info('[TimerAudit] PitchBoard setMinutesPerHalf', {
      teamId, from: minutesPerHalf, to: initialMinutesPerHalf, gameInProgress,
      ts: new Date().toISOString(),
    });
    setMinutesPerHalf(initialMinutesPerHalf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialMinutesPerHalf, gameInProgress, teamId]);

  useEffect(() => {
    setMaxSpreadMinutes(initialMaxSpreadMinutes);
  }, [initialMaxSpreadMinutes, setMaxSpreadMinutes]);

  // Sync team size and formation from props if no saved state - runs on
  // mount and when props change. Also keeps savedTeamDefaultsRef in sync
  // with backend defaults for the Reset action.
  useEffect(() => {
    const candidateSize = String(initialTeamSize || "");
    const nextDefaultSize: TeamSize = isSavedDefaultTeamSize(candidateSize) ? candidateSize : "7";
    savedTeamDefaultsRef.current = {
      minutesPerHalf: initialMinutesPerHalf,
      rotationSpeed: initialRotationSpeed,
      disablePositionSwaps: initialDisablePositionSwaps,
      disableBatchSubs: initialDisableBatchSubs,
      rotateGkAtHalftime: initialRotateGkAtHalftime,
      maxSpreadMinutes: initialMaxSpreadMinutes,
      teamSize: nextDefaultSize,
      formation: initialFormation || null,
    };

    if (!savedState && initialTeamSize) {
      const validSize = String(initialTeamSize) as TeamSize;
      if (isSavedDefaultTeamSize(validSize)) {
        setTeamSize(validSize);
        if (initialFormation) {
          const formations = FORMATIONS[validSize];
          const index = formations.findIndex(f => f.name === initialFormation);
          if (index >= 0) {
            setSelectedFormation(index);
          }
        } else {
          setSelectedFormation(0);
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    initialTeamSize, initialFormation, initialMinutesPerHalf, initialRotationSpeed,
    initialDisablePositionSwaps, initialDisableBatchSubs, initialRotateGkAtHalftime,
    savedState,
  ]);
}
