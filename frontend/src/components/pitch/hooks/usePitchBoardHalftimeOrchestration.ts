import { useCallback } from "react";
import { playSubAlertBeep, type GameTimerRef } from "../GameTimer";
import type { PitchBoardState, Player, SubstitutionEvent } from "../types";
import { loadTimerStateForMinutes } from "../pitchStateUtils";
import {
  canShowHalftimePrompt,
  hasAcknowledgedHalftimePrompt,
} from "../halftimePromptAck";

type HalfChangeSource = "live" | "reconcile";

interface HalftimeOrchestrationArgs {
  gameTimerRef: { current: GameTimerRef | null };
  halftimePromptAckKey: string | null;
  checkHalftimeSubs: (newHalf: 1 | 2) => boolean;
  preferredSecondHalfGkId?: string;
  players: Player[];
  savedState: PitchBoardState | null;
  teamId: string;
  setPendingAutoSub: (sub: SubstitutionEvent | null) => void;
  setPendingBatchSubs: (subs: SubstitutionEvent[]) => void;
  setSubConfirmDialogOpen: (open: boolean) => void;
}

export function findHalftimeGoalkeeperSwap(
  players: Player[],
  preferredSecondHalfGkId?: string,
): { currentGk: Player; secondHalfGk: Player } | null {
  if (!preferredSecondHalfGkId) return null;
  const currentGk = players.find(
    (candidate) => candidate.currentPitchPosition === "GK" && candidate.position !== null,
  );
  const secondHalfGk = players.find(
    (candidate) => candidate.id === preferredSecondHalfGkId,
  );
  if (!currentGk || !secondHalfGk || currentGk.id === secondHalfGk.id) return null;
  return { currentGk, secondHalfGk };
}

export function usePitchBoardHalftimeOrchestration({
  gameTimerRef,
  halftimePromptAckKey,
  checkHalftimeSubs,
  preferredSecondHalfGkId,
  players,
  savedState,
  teamId,
  setPendingAutoSub,
  setPendingBatchSubs,
  setSubConfirmDialogOpen,
}: HalftimeOrchestrationArgs) {
  return useCallback((newHalf: 1 | 2, source: HalfChangeSource = "live") => {
    if (newHalf === 2) {
      const elapsedInHalf2 = gameTimerRef.current?.getElapsedSeconds?.() ?? 0;
      if (
        elapsedInHalf2 > 30
        || hasAcknowledgedHalftimePrompt(halftimePromptAckKey)
      ) {
        return;
      }
    }

    if (checkHalftimeSubs(newHalf)) return;

    if (newHalf === 2) {
      const goalkeeperSwap = findHalftimeGoalkeeperSwap(
        players,
        preferredSecondHalfGkId,
      );
      if (goalkeeperSwap) {
        const { currentGk, secondHalfGk } = goalkeeperSwap;
        const gkSwapEvent: SubstitutionEvent = {
          time: 0,
          half: 2,
          playerOut: currentGk,
          playerIn: secondHalfGk,
          executed: false,
        };

        setTimeout(() => {
          if (!canShowHalftimePrompt(loadTimerStateForMinutes(teamId), savedState)) return;
          playSubAlertBeep(`Halftime GK swap: ${currentGk.name} ➜ ${secondHalfGk.name}`);
          setPendingAutoSub(gkSwapEvent);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(true);
        }, 500);
        return;
      }
    }

    if (newHalf === 2 && source === "live") {
      setTimeout(() => {
        if (!canShowHalftimePrompt(loadTimerStateForMinutes(teamId), savedState)) return;
        playSubAlertBeep("Half Time!");
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(true);
      }, 500);
    }
  }, [
    checkHalftimeSubs,
    gameTimerRef,
    halftimePromptAckKey,
    players,
    preferredSecondHalfGkId,
    savedState,
    setPendingAutoSub,
    setPendingBatchSubs,
    setSubConfirmDialogOpen,
    teamId,
  ]);
}
