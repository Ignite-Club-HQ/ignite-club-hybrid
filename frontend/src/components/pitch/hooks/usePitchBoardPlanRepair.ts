import { useCallback, useEffect, useRef } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Player } from "../types";
import type { SubstitutionEvent } from "../types";
import type { GameTimerRef } from "../GameTimer";
import {
  findOrphanedReferences,
  repairForComposition,
  repairForInjury,
} from "../autoSub/repairPlan";

interface UsePitchBoardPlanRepairArgs {
  players: Player[];
  playersOnPitch: Player[];
  playersRef: MutableRefObject<Player[]>;
  autoSubActive: boolean;
  autoSubPlan: SubstitutionEvent[];
  setAutoSubPlan: Dispatch<SetStateAction<SubstitutionEvent[]>>;
  regeneratePlanRef: MutableRefObject<(() => void) | null>;
  handleCancelAutoSubPlan: () => void;
  gameTimerRef: MutableRefObject<GameTimerRef | null>;
  teamSize: string;
  rotateGkAtHalftime: boolean;
  toast: (opts: { title: string; description?: string }) => void;
}

/**
 * Thin React layer over the pure `repairPlan` intentions:
 *  - Composition-change effect → repairForComposition()
 *  - Orphan-player effect      → findOrphanedReferences()
 *  - Injury recalc handler     → repairForInjury()
 *
 * All algorithmic logic now lives in `autoSub/repairPlan.ts` and is unit-
 * testable in isolation. This hook only handles debouncing, side-effects
 * (toast, regenerate dispatch), and committing the resulting plan.
 */
export function usePitchBoardPlanRepair({
  players,
  playersOnPitch,
  playersRef,
  autoSubActive,
  autoSubPlan,
  setAutoSubPlan,
  regeneratePlanRef,
  handleCancelAutoSubPlan,
  gameTimerRef,
  teamSize,
  rotateGkAtHalftime,
  toast,
}: UsePitchBoardPlanRepairArgs) {
  // ── Auto-repair when on-pitch composition changes ──────────────
  const onPitchSignatureRef = useRef<string>("");
  const lastRegenAtRef = useRef<number>(0);
  useEffect(() => {
    if (!autoSubActive) return;
    if (autoSubPlan.length === 0) return;
    const sig = playersOnPitch.map((p) => p.id).sort().join("|");
    const prev = onPitchSignatureRef.current;
    if (!prev) {
      onPitchSignatureRef.current = sig;
      return;
    }
    if (prev === sig) return;
    onPitchSignatureRef.current = sig;

    const now = Date.now();
    if (now - lastRegenAtRef.current < 250) return;
    lastRegenAtRef.current = now;

    const t = setTimeout(() => {
      const intent = repairForComposition(autoSubPlan, playersRef.current);
      if (intent.kind === "noop") return;
      if (intent.kind === "regenerate") {
        regeneratePlanRef.current?.();
        return;
      }
      if (intent.kind === "replace") {
        setAutoSubPlan([...intent.executed, ...intent.remaining]);
      }
    }, 50);
    return () => clearTimeout(t);
  }, [
    playersOnPitch,
    autoSubActive,
    autoSubPlan,
    regeneratePlanRef,
    playersRef,
    setAutoSubPlan,
  ]);

  // ── Cancel plan if a referenced player has been removed ────────
  useEffect(() => {
    if (!autoSubActive || autoSubPlan.length === 0) return;
    if (findOrphanedReferences(autoSubPlan, players)) {
      handleCancelAutoSubPlan();
      toast({
        title: "Auto-subs cancelled",
        description: "A player in the plan was removed",
      });
    }
  }, [players, autoSubActive, autoSubPlan, handleCancelAutoSubPlan, toast]);

  /**
   * Recalculate the remaining plan when a player becomes injured.
   * Returns the new full plan committed (or null if no-op).
   */
  const recalcPlanForInjury = useCallback(
    (updatedPlayers: Player[], injuredId: string, replacementId?: string) => {
      const intent = repairForInjury({
        plan: autoSubPlan,
        updatedPlayers,
        injuredId,
        replacementId,
        teamSize: parseInt(teamSize),
        minutesPerHalfSecs:
          (gameTimerRef.current?.getMinutesPerHalf() || 10) * 60,
        currentElapsed: gameTimerRef.current?.getElapsedSeconds() || 0,
        currentHalf: gameTimerRef.current?.getCurrentHalf() || 1,
        rotateGkAtHalftime,
      });

      if (intent.kind === "noop") return null;
      if (intent.kind !== "replace") return null;

      if (intent.injuryFallback) {
        console.warn(
          "[PitchBoard] Injury recalculation returned empty — preserving existing plan"
        );
      }

      const finalPlan = [...intent.executed, ...intent.remaining];
      setAutoSubPlan(finalPlan);
      toast({
        title: "Sub plan updated",
        description: "Auto-substitution plan recalculated due to injury",
      });
      return finalPlan;
    },
    [autoSubPlan, gameTimerRef, teamSize, rotateGkAtHalftime, setAutoSubPlan, toast]
  );

  return { recalcPlanForInjury };
}
