/**
 * useAutoSubs — centralizes auto-sub plan state & handlers extracted from PitchBoard.
 *
 * Manages:
 *  • plan state (autoSubPlan, autoSubActive, autoSubPaused)
 *  • pending sub dialog state (pendingAutoSub, pendingBatchSubs, subConfirmDialogOpen)
 *  • locked players
 *  • plan lifecycle: start, cancel, pause/resume, skip-next, execute-now, regenerate
 *  • confirm / skip handlers (with recalculation, validation, undo)
 *  • due-sub detection (called from timer update)
 */

import { useState, useRef, useCallback, useReducer, useEffect } from "react";
import { useToast } from "@/hooks/use-toast";
import type { Player, SubstitutionEvent, TeamSize } from "@/components/pitch/types";
import type { GameTimerRef } from "@/components/pitch/GameTimer";
import { playSubAlertBeep } from "@/components/pitch/GameTimer";
import {
  getSubKey,
  executeSubsOnPlayers,
  markSubsExecuted,
  calculateSubDelay,
  findRelevantNextSub,
} from "@/components/pitch/autoSubHelpers";
import {
  recalculateRemainingPlanTeamAware as recalculateRemainingPlan,
  validateAndFixRemainingPlan,
} from "@/components/pitch/pitchStateUtils";
import {
  autoSubReducer,
  initialAutoSubState,
  type AutoSubState,
} from "@/components/pitch/autoSub/autoSubReducer";
import { useAutoSubScheduler } from "@/hooks/useAutoSubScheduler";
import {
  selectRemaining,
  selectExecuted,
  selectRemainingCount,
  selectIsPlanComplete,
} from "@/components/pitch/autoSub/selectors";
import { recordAutoSubTransition } from "@/components/pitch/autoSub/debugLog";


export interface UseAutoSubsOptions {
  /** Initial plan from saved state */
  initialPlan?: SubstitutionEvent[];
  /** Initial active flag from saved state */
  initialActive?: boolean;
  /** Initial paused flag from saved state */
  initialPaused?: boolean;
  /** Ref to the game timer component */
  gameTimerRef: React.RefObject<GameTimerRef | null>;
  /** Current players getter (ref-based for stable identity) */
  playersRef: React.MutableRefObject<Player[]>;
  /** Setter to update players in PitchBoard */
  setPlayers: React.Dispatch<React.SetStateAction<Player[]>>;
  /** Current team size */
  teamSize: TeamSize;
  /** Stable key for suppressing the half-time dialog after it is acknowledged. */
  halftimePromptAckKey?: string | null;
  /** Whether GK rotation at halftime is enabled */
  rotateGkAtHalftime: boolean;
  /** Push to undo history before making changes (ref to avoid hook ordering issues) */
  pushToUndoHistoryRef: React.MutableRefObject<((description: string, snapshot: Player[]) => void) | null>;
  /** Run the sub animation effect (ref to avoid hook ordering issues) */
  runSubAnimationRef: React.MutableRefObject<((playerOutId: string, playerInId: string, swapPlayerId?: string) => void) | null>;
}

export function useAutoSubs({
  initialPlan = [],
  initialActive = false,
  initialPaused = false,
  gameTimerRef,
  playersRef,
  setPlayers,
  teamSize,
  halftimePromptAckKey,
  rotateGkAtHalftime,
  pushToUndoHistoryRef,
  runSubAnimationRef,
}: UseAutoSubsOptions) {
  const { toast } = useToast();

  // ── Core state (Step B: backed by useReducer; external API unchanged) ──
  //
  // The reducer is the single choke point for plan mutation. Compat setters
  // below preserve the legacy useState-style API used by ~9 handlers and by
  // PitchBoard.tsx. Plan invariants (no duplicates, executed-immutable,
  // no locked-player subs) are enforced on every SET_PLAN dispatch via
  // `validatePlanIntegrity`. On a rejected transition the reducer keeps
  // the previous state and surfaces `lastError` for a dev-time toast.
  // playersRef-backed ctx so every dispatch sees the freshest roster.
  // Re-built per render but captured by the React-shaped reducer below.
  const ctxRef = useRef({ playersRef });
  ctxRef.current = { playersRef };

  // React's useReducer takes a 2-arg reducer. Our pure reducer takes
  // (state, ev, ctx) for testability — wrap it here, injecting ctx from
  // the ref above. `now` comes from Date.now() at dispatch time.
  const reactReducer = useCallback(
    (state: AutoSubState, ev: Parameters<typeof autoSubReducer>[1]) => {
      const next = autoSubReducer(state, ev, {
        players: ctxRef.current.playersRef.current,
        now: Date.now(),
      });
      recordAutoSubTransition(ev, state, next);
      return next;
    },
    []
  );

  const [reducerState, dispatch] = useReducer(reactReducer, undefined, (): AutoSubState => ({
    ...initialAutoSubState,
    plan: initialPlan,
    active: initialActive,
    paused: initialPaused,
  }));
  const autoSubPlan = reducerState.plan;
  const autoSubActive = reducerState.active;
  const autoSubPaused = reducerState.paused;

  const setAutoSubPlan = useCallback(
    (next: SubstitutionEvent[] | ((prev: SubstitutionEvent[]) => SubstitutionEvent[])) => {
      const resolved = typeof next === "function" ? next(planRef.current) : next;
      dispatch({ type: "SET_PLAN", plan: resolved });
    },
    []
  );
  const setAutoSubActive = useCallback((active: boolean) => {
    dispatch({ type: "SET_ACTIVE", active });
  }, []);
  const setAutoSubPaused = useCallback(
    (next: boolean | ((prev: boolean) => boolean)) => {
      const resolved = typeof next === "function" ? next(pausedRef.current) : next;
      dispatch({ type: "SET_PAUSED", paused: resolved });
    },
    []
  );
  // Kept as separate useState for Step B; will migrate to reducer LOCK_TOGGLE
  // in Step E when UI consumers are reworked.
  const [lockedPlayerIds, setLockedPlayerIds] = useState<Set<string>>(new Set());

  // Refs mirror reducer state so compat updater-form setters
  // (`setAutoSubPlan(prev => ...)`, `setAutoSubPaused(prev => ...)`) can
  // resolve against the freshest value without re-renders chasing them.
  const planRef = useRef<SubstitutionEvent[]>(autoSubPlan);
  const pausedRef = useRef<boolean>(autoSubPaused);
  useEffect(() => { planRef.current = autoSubPlan; }, [autoSubPlan]);
  useEffect(() => { pausedRef.current = autoSubPaused; }, [autoSubPaused]);

  // Dev-time: log validator rejections so invariant violations surface loudly.
  useEffect(() => {
    if (!reducerState.lastError) return;
    if (import.meta.env.DEV) {
      console.warn(
        `[AutoSub] reducer rejected transition: ${reducerState.lastError.code} — ${reducerState.lastError.message}`
      );
    }
  }, [reducerState.lastError]);

  // ── Internal refs ───────────────────────────────────────
  const planActivationTimeRef = useRef<{ seconds: number; half: 1 | 2 } | null>(null);
  const skipCooldownRef = useRef<number>(0);
  const regeneratePlanRef = useRef<(() => void) | null>(null);


  // ── Safeguard: prevent recalculation from wiping plan ──

  const shouldRecalculateAfterSkip = useCallback(
    (
      skippedSubs: SubstitutionEvent[],
      currentElapsed: number,
      half: 1 | 2,
      halfDurationSeconds: number
    ) => skippedSubs.some(sub => calculateSubDelay(sub, currentElapsed, half, halfDurationSeconds) > 30),
    []
  );

  /**
   * If recalculation returns fewer subs than expected (e.g. due to threshold edge cases),
   * fall back to the existing unexecuted plan (minus skipped subs) with validated references.
   */
  const safeRecalculate = useCallback(
    (
      players: Player[],
      halfDurationSeconds: number,
      currentElapsed: number,
      half: 1 | 2,
      skippedSub: SubstitutionEvent,
      existingUnexecuted: SubstitutionEvent[]
    ): SubstitutionEvent[] => {
      const recalculated = recalculateRemainingPlan(
        players,
        parseInt(teamSize),
        halfDurationSeconds,
        currentElapsed,
        half,
        skippedSub,
        rotateGkAtHalftime
      );

      // If recalculation shrinks the remaining plan, preserve the existing schedule.
      // Skipping a single sub should not collapse all future subs.
      if (existingUnexecuted.length > 0 && recalculated.length < existingUnexecuted.length) {
        console.warn("[AutoSub] Recalculation shortened remaining plan — preserving existing plan", {
          recalculated: recalculated.length,
          existing: existingUnexecuted.length,
        });
        return existingUnexecuted;
      }

      if (recalculated.length === 0 && existingUnexecuted.length > 0) {
        const benchPlayers = players.filter(p => p.position === null && !p.isInjured);
        if (benchPlayers.length > 0) {
          console.warn("[AutoSub] Recalculation returned empty but bench players remain — preserving existing plan");
          return existingUnexecuted;
        }
      }

      return recalculated;
    },
    [teamSize, rotateGkAtHalftime]
  );

  // ── Scheduler (clock-driven sub detection + dialog state) ──
  // Extracted to `useAutoSubScheduler` so timer logic and dialog UI state
  // live in one place. The handlers below consume the setters returned
  // here to clear the pending dialog after confirm/skip/cancel.
  const {
    pendingAutoSub,
    setPendingAutoSub,
    pendingBatchSubs,
    setPendingBatchSubs,
    subConfirmDialogOpen,
    setSubConfirmDialogOpen,
    subDuePlayerIds,
    setSubDuePlayerIds,
    subDueTimerRef,
    nextSubInfo,
    checkForDueSubs,
    updateNextSubInfo,
    checkHalftimeSubs,
  } = useAutoSubScheduler({
    autoSubActive,
    autoSubPaused,
    autoSubPlan,
    setAutoSubPlan,
    halftimePromptAckKey,
    lockedPlayerIds,
    playersRef,
    gameTimerRef,
    skipCooldownRef,
    planActivationTimeRef,
    safeRecalculate,
    shouldRecalculateAfterSkip,
    toast,
  });
  // The scheduler's `setNextSubInfo` is internal; the local `setNextSubInfo`
  // call inside handleCancelAutoSubPlan below clears via `updateNextSubInfo`
  // path on the next tick. To preserve immediate-clear semantics we expose
  // a no-op wrapper here. (No call sites use this externally.)
  const setNextSubInfo = useCallback((_v: typeof nextSubInfo) => {
    // No-op: nextSubInfo is owned by useAutoSubScheduler and naturally
    // clears on the next timer tick after a cancel.
  }, []);

  // ── Plan lifecycle ──────────────────────────────────────



  const handleStartAutoSubPlan = useCallback((plan: SubstitutionEvent[]) => {
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const currentHalf = gameTimerRef.current?.getCurrentHalf() || 1;
    planActivationTimeRef.current = { seconds: currentElapsed, half: currentHalf };
    setAutoSubPlan(plan);
    setAutoSubActive(true);
    toast({ title: "Auto-sub plan started", description: `${plan.length} substitutions scheduled` });
  }, [toast, gameTimerRef]);

  const handleCancelAutoSubPlan = useCallback(() => {
    setAutoSubPlan([]);
    setAutoSubActive(false);
    setAutoSubPaused(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    setSubConfirmDialogOpen(false);
    setNextSubInfo(null);
    setSubDuePlayerIds(new Set());
    if (subDueTimerRef.current) {
      clearTimeout(subDueTimerRef.current);
      subDueTimerRef.current = null;
    }
    planActivationTimeRef.current = null;
    toast({ title: "Auto-sub plan cancelled" });
  }, [toast]);

  const handleTogglePauseAutoSub = useCallback(() => {
    setAutoSubPaused(prev => {
      const newPaused = !prev;
      toast({
        title: newPaused ? "Auto-subs paused" : "Auto-subs resumed",
        description: newPaused
          ? "Sub alerts will not trigger until resumed"
          : "Sub alerts will trigger when due",
      });
      return newPaused;
    });
  }, [toast]);

  const handleToggleLockPlayer = useCallback((playerId: string) => {
    setLockedPlayerIds(prev => {
      const next = new Set(prev);
      if (next.has(playerId)) next.delete(playerId);
      else next.add(playerId);
      return next;
    });
  }, []);

  // ── Skip next sub ──────────────────────────────────────

  const handleSkipNextSub = useCallback(() => {
    const players = playersRef.current;
    const remainingSubs = autoSubPlan.filter(s => !s.executed);
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;
    const nextSub = findRelevantNextSub(remainingSubs, half, currentElapsed, halfDurationSeconds);
    if (!nextSub) return;

    const skippedKeys = [getSubKey(nextSub)];
    const updatedPlan = markSubsExecuted(autoSubPlan, skippedKeys, true);

    const existingUnexecuted = updatedPlan.filter(s => !s.executed);
    const shouldRecalculate = shouldRecalculateAfterSkip(
      [nextSub],
      currentElapsed,
      half,
      halfDurationSeconds
    );
    const recalculated = shouldRecalculate
      ? safeRecalculate(
          players,
          halfDurationSeconds,
          currentElapsed,
          half,
          nextSub,
          existingUnexecuted
        )
      : existingUnexecuted;

    const executedSubs = updatedPlan.filter(s => s.executed);
    const finalPlan = validateAndFixRemainingPlan([...executedSubs, ...recalculated], players);
    const remainingCount = finalPlan.filter(sub => !sub.executed).length;
    setAutoSubPlan(finalPlan);

    toast({
      title: shouldRecalculate ? "Substitution skipped & plan recalculated" : "Substitution skipped",
      description:
        remainingCount > 0
          ? `${remainingCount} substitution${remainingCount === 1 ? "" : "s"} remaining`
          : "No more planned substitutions",
    });
    skipCooldownRef.current = Date.now();
  }, [autoSubPlan, playersRef, safeRecalculate, shouldRecalculateAfterSkip, toast, gameTimerRef]);

  // ── Execute now ─────────────────────────────────────────

  const handleExecuteNow = useCallback(() => {
    const remainingSubs = autoSubPlan.filter(s => !s.executed);
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;
    const nextSub = findRelevantNextSub(remainingSubs, half, currentElapsed, halfDurationSeconds);
    if (!nextSub) return;

    const batchSubs = remainingSubs.filter(
      s => s.half === nextSub.half && s.time === nextSub.time && s !== nextSub
    );

    setPendingAutoSub(nextSub);
    setPendingBatchSubs(batchSubs);
    setSubConfirmDialogOpen(true);

    const playerOutName = nextSub.playerOut.name || `#${nextSub.playerOut.number}`;
    const playerInName = nextSub.playerIn.name || `#${nextSub.playerIn.number}`;
    const msg =
      batchSubs.length > 0
        ? `Time for ${batchSubs.length + 1} substitutions`
        : `Execute now: ${playerOutName} ➜ ${playerInName}`;
    playSubAlertBeep(msg);
  }, [autoSubPlan, gameTimerRef]);

  // ── Regenerate plan ─────────────────────────────────────

  const handleRegeneratePlan = useCallback(() => {
    const players = playersRef.current;
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;

    const dummySub: SubstitutionEvent = {
      time: currentElapsed,
      half,
      playerOut: players[0],
      playerIn: players[0],
      executed: true,
    };

    const recalculated = recalculateRemainingPlan(
      players,
      parseInt(teamSize),
      halfDurationSeconds,
      currentElapsed,
      half,
      dummySub,
      rotateGkAtHalftime
    );

    const currentRemainingSignature = autoSubPlan
      .filter(s => !s.executed)
      .map(s => `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`)
      .join("|");
    const recalculatedSignature = recalculated
      .map(s => `${s.half}-${s.time}-${s.playerOut.id}-${s.playerIn.id}`)
      .join("|");
    const isUnchanged = currentRemainingSignature === recalculatedSignature;

    const executedSubs = autoSubPlan.filter(s => s.executed);
    const remainingSubs = autoSubPlan.filter(s => !s.executed);
    // Safety guard: don't let regeneration wipe remaining plan
    if (recalculated.length > 0 || remainingSubs.length === 0) {
      setAutoSubPlan([...executedSubs, ...recalculated]);
    } else {
      const benchPlayers = players.filter(p => p.position === null && !p.isInjured);
      if (benchPlayers.length > 0) {
        console.warn("[AutoSub] Regeneration returned empty but bench players remain — preserving existing plan");
        // Keep existing plan unchanged
      } else {
        setAutoSubPlan([...executedSubs, ...recalculated]);
      }
    }
    toast({
      title: isUnchanged ? "Plan unchanged" : "Plan regenerated",
      description: isUnchanged
        ? "No better alternatives available right now"
        : `${recalculated.length} substitutions scheduled`,
    });
  }, [autoSubPlan, playersRef, teamSize, toast, gameTimerRef, rotateGkAtHalftime]);

  // Keep ref in sync
  regeneratePlanRef.current = handleRegeneratePlan;

  // ── Confirm pending sub ─────────────────────────────────

  const handleConfirmAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    const players = playersRef.current;

    // Guard: already executed/skipped
    const matchingSub = autoSubPlan.find(
      s =>
        s.playerOut.id === pendingAutoSub.playerOut.id &&
        s.time === pendingAutoSub.time &&
        s.half === pendingAutoSub.half
    );
    if (matchingSub?.executed || matchingSub?.skipped) {
      toast({
        title: "Substitution expired",
        description: "This sub was already skipped — a newer one is due",
        variant: "destructive",
      });
      setSubConfirmDialogOpen(false);
      setPendingAutoSub(null);
      setPendingBatchSubs([]);
      setSubDuePlayerIds(new Set());
      return;
    }

    const allPendingSubs = [pendingAutoSub, ...pendingBatchSubs];

    // Guard: validate player positions before executing
    // If playerOut is already off pitch or playerIn is already on pitch,
    // the sub is stale — auto-skip it instead of showing an error
    const staleSubs = allPendingSubs.filter(sub => {
      const currentOut = players.find(p => p.id === sub.playerOut.id);
      const currentIn = players.find(p => p.id === sub.playerIn.id);
      return !currentOut?.position || (currentIn && currentIn.position !== null);
    });

    if (staleSubs.length === allPendingSubs.length) {
      // ALL subs are stale — skip them all gracefully
      const skippedKeys = allPendingSubs.map(s => getSubKey(s));
      const updatedPlan = markSubsExecuted(autoSubPlan, skippedKeys, true);
      setAutoSubPlan(validateAndFixRemainingPlan(updatedPlan, players));
      toast({
        title: "Substitution expired",
        description: "Players have already moved — sub auto-skipped",
      });
      setSubConfirmDialogOpen(false);
      setPendingAutoSub(null);
      setPendingBatchSubs([]);
      setSubDuePlayerIds(new Set());
      if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
      return;
    }

    // Filter out any stale subs from the batch, keep valid ones
    const validSubs = allPendingSubs.filter(sub => {
      const currentOut = players.find(p => p.id === sub.playerOut.id);
      const currentIn = players.find(p => p.id === sub.playerIn.id);
      return currentOut?.position && (!currentIn || currentIn.position === null);
    });

    // Push undo
    const subDescription =
      validSubs.length > 1
        ? `Batch sub: ${validSubs.length} substitutions`
        : `Auto-sub: ${validSubs[0].playerIn.name} for ${validSubs[0].playerOut.name}`;
    pushToUndoHistoryRef.current?.(subDescription, players);

    // Execute subs using shared helper
    const { updatedPlayers, executedSubKeys, successCount } = executeSubsOnPlayers(validSubs, players);

    // Animation — only if the primary sub was among valid ones
    if (validSubs.some(s => s.playerOut.id === pendingAutoSub.playerOut.id)) {
      const primarySwapPlayer = pendingAutoSub.positionSwap?.player?.id;
      runSubAnimationRef.current?.(pendingAutoSub.playerOut.id, pendingAutoSub.playerIn.id, primarySwapPlayer);
    }

    // Mark executed (include any stale subs that were filtered out)
    const staleSubKeys = staleSubs.map(s => getSubKey(s));
    let finalPlan = markSubsExecuted(autoSubPlan, [...executedSubKeys, ...staleSubKeys], false);
    // Mark stale ones as skipped
    if (staleSubKeys.length > 0) {
      finalPlan = markSubsExecuted(finalPlan, staleSubKeys, true);
    }

    // Recalculate if significantly late, early, or halftime sub (positions may have changed)
    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;
    const remainingSubs = finalPlan.filter(sub => !sub.executed);

    if (remainingSubs.length > 0) {
      const delaySeconds = calculateSubDelay(
        pendingAutoSub,
        currentElapsed,
        half as 1 | 2,
        halfDurationSeconds
      );
      // Also detect early execution: sub was scheduled later than current time
      const scheduledTime = pendingAutoSub.time;
      const earlyBySeconds = pendingAutoSub.half === (half as 1 | 2)
        ? Math.max(0, scheduledTime - currentElapsed)
        : 0;
      // Late recalc rule: only recalc if the NEXT scheduled sub's time has
      // already passed. Tapping a sub a bit late within its own window
      // shouldn't redistribute anything — we only redistribute when the delay
      // genuinely eats into the next sub's slot.
      const nextScheduled = remainingSubs
        .slice()
        .sort((a, b) => {
          if (a.half !== b.half) return a.half - b.half;
          return a.time - b.time;
        })[0];
      const currentTotalSeconds = (half as 1 | 2) === 1
        ? currentElapsed
        : halfDurationSeconds + currentElapsed;
      const nextTotalSeconds = nextScheduled
        ? (nextScheduled.half === 1 ? nextScheduled.time : halfDurationSeconds + nextScheduled.time)
        : null;
      const isSignificantlyEarly = earlyBySeconds > 30;
      const isSignificantlyLate =
        delaySeconds > 0 && nextTotalSeconds !== null && currentTotalSeconds >= nextTotalSeconds;

      // Always recalculate after halftime subs — player positions change at the break
      // and the remaining plan references pre-halftime positions, causing cascade skips.
      const isHalftimeSub = pendingAutoSub.half === 2 && pendingAutoSub.time === 0;


      if (isSignificantlyLate || isSignificantlyEarly || isHalftimeSub) {
        const executedPlan = finalPlan.filter(sub => sub.executed);
        const recalculated = recalculateRemainingPlan(
          updatedPlayers,
          parseInt(teamSize),
          halfDurationSeconds,
          currentElapsed,
          half as 1 | 2,
          { ...pendingAutoSub, executed: true },
          rotateGkAtHalftime
        );
        // Use safeRecalculate logic: don't let recalculation wipe the plan
        if (recalculated.length > 0 || remainingSubs.length === 0) {
          finalPlan = [...executedPlan, ...recalculated];
        } else {
          // Preserve existing remaining subs if recalculation returns empty
          const benchPlayers = updatedPlayers.filter(p => p.position === null && !p.isInjured);
          if (benchPlayers.length > 0) {
            console.warn("[AutoSub] Halftime/late recalculation returned empty — preserving remaining plan");
            finalPlan = [...executedPlan, ...remainingSubs];
          } else {
            finalPlan = [...executedPlan, ...recalculated];
          }
        }
      }
    }

    finalPlan = validateAndFixRemainingPlan(finalPlan, updatedPlayers);
    
    // Safety net: if validation cascade-skipped all remaining subs but bench players exist,
    // force a full recalculation to regenerate valid subs for the rest of the match.
    const remainingAfterValidation = finalPlan.filter(sub => !sub.executed);
    const benchAfterSub = updatedPlayers.filter(p => p.position === null && !p.isInjured);
    if (remainingAfterValidation.length === 0 && remainingSubs.length > 0 && benchAfterSub.length > 0) {
      console.warn("[AutoSub] Validation wiped all remaining subs — forcing recalculation");
      const executedPlan = finalPlan.filter(sub => sub.executed);
      const rescued = recalculateRemainingPlan(
        updatedPlayers,
        parseInt(teamSize),
        halfDurationSeconds,
        currentElapsed,
        half as 1 | 2,
        { ...pendingAutoSub, executed: true },
        rotateGkAtHalftime
      );
      if (rescued.length > 0) {
        finalPlan = validateAndFixRemainingPlan([...executedPlan, ...rescued], updatedPlayers);
      }
    }
    setAutoSubPlan(finalPlan);
    setPlayers(updatedPlayers);

    const staleCount = staleSubs.length;
    const toastDescription =
      validSubs.length > 1
        ? `${successCount} substitutions made${staleCount > 0 ? `, ${staleCount} expired` : ''}`
        : successCount > 0
          ? `${validSubs[0].playerIn.name} replaces ${validSubs[0].playerOut.name}`
          : 'Sub expired — players already moved';
    toast({
      title: successCount > 0
        ? (validSubs.length > 1 ? "Substitutions made" : "Substitution made")
        : "Substitution expired",
      description: toastDescription,
    });

    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    setSubDuePlayerIds(new Set());
    if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);

    if (finalPlan.filter(sub => !sub.executed).length === 0) {
      // Keep autoSubActive true so GlobalSubMonitor can still track the game
      // (e.g. for game-finished detection). It will be cleared on game reset.
      toast({ title: "All substitutions complete" });
    }
  }, [
    pendingAutoSub,
    pendingBatchSubs,
    autoSubPlan,
    playersRef,
    teamSize,
    rotateGkAtHalftime,
    toast,
    pushToUndoHistoryRef,
    runSubAnimationRef,
    setPlayers,
    gameTimerRef,
  ]);

  // ── Skip pending sub ────────────────────────────────────

  const handleSkipAutoSub = useCallback(() => {
    if (!pendingAutoSub) return;
    const players = playersRef.current;

    const allPendingSubs = [pendingAutoSub, ...pendingBatchSubs];
    const skippedKeys = allPendingSubs.map(s => getSubKey(s));
    const updatedPlan = markSubsExecuted(autoSubPlan, skippedKeys, true);

    const currentElapsed = gameTimerRef.current?.getElapsedSeconds() || 0;
    const half = gameTimerRef.current?.getCurrentHalf() || 1;
    const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
    const halfDurationSeconds = minsPerHalf * 60;
    const existingUnexecuted = updatedPlan.filter(s => !s.executed);
    const shouldRecalculate = shouldRecalculateAfterSkip(
      allPendingSubs,
      currentElapsed,
      half,
      halfDurationSeconds
    ) || (pendingAutoSub.half === 2 && pendingAutoSub.time === 0); // Always recalculate halftime skips
    const recalculated = shouldRecalculate
      ? safeRecalculate(
          players,
          halfDurationSeconds,
          currentElapsed,
          half,
          pendingAutoSub,
          existingUnexecuted
        )
      : existingUnexecuted;

    const executedSubs = updatedPlan.filter(s => s.executed);
    const finalPlan = validateAndFixRemainingPlan([...executedSubs, ...recalculated], players);
    const remainingCount = finalPlan.filter(sub => !sub.executed).length;
    setAutoSubPlan(finalPlan);

    toast({
      title:
        allPendingSubs.length > 1
          ? shouldRecalculate
            ? `${allPendingSubs.length} subs skipped & plan recalculated`
            : `${allPendingSubs.length} subs skipped`
          : shouldRecalculate
            ? "Sub skipped & plan recalculated"
            : "Sub skipped",
      description:
        remainingCount > 0
          ? `${remainingCount} substitution${remainingCount === 1 ? "" : "s"} remaining`
          : "No more planned substitutions",
    });

    skipCooldownRef.current = Date.now();
    setSubConfirmDialogOpen(false);
    setPendingAutoSub(null);
    setPendingBatchSubs([]);
    setSubDuePlayerIds(new Set());
    if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
  }, [pendingAutoSub, pendingBatchSubs, autoSubPlan, playersRef, safeRecalculate, shouldRecalculateAfterSkip, toast, gameTimerRef]);

  // ── Clock-driven scheduler ──────────────────────────────
  // `checkForDueSubs`, `updateNextSubInfo`, and `checkHalftimeSubs` are
  // produced by `useAutoSubScheduler` (instantiated near the top of the
  // hook). They are re-exported below for backward-compatible call sites
  // in `PitchBoard.tsx` and `GlobalSubMonitor.tsx`.


  return {
    // State
    autoSubPlan,
    setAutoSubPlan,
    autoSubActive,
    setAutoSubActive,
    autoSubPaused,
    setAutoSubPaused,
    lockedPlayerIds,
    pendingAutoSub,
    setPendingAutoSub,
    pendingBatchSubs,
    setPendingBatchSubs,
    subConfirmDialogOpen,
    setSubConfirmDialogOpen,
    subDuePlayerIds,
    setSubDuePlayerIds,
    nextSubInfo,
    subDueTimerRef,

    // Plan lifecycle
    handleStartAutoSubPlan,
    handleCancelAutoSubPlan,
    handleTogglePauseAutoSub,
    handleToggleLockPlayer,
    handleSkipNextSub,
    handleExecuteNow,
    handleRegeneratePlan,
    regeneratePlanRef,

    // Confirm / skip
    handleConfirmAutoSub,
    handleSkipAutoSub,

    // Timer-driven helpers
    checkForDueSubs,
    updateNextSubInfo,
    checkHalftimeSubs,

    // Derived selectors (Step E) — prefer these over inline filters
    // when consuming `autoSubPlan` from UI. See `autoSub/selectors.ts`.
    remainingSubs: selectRemaining(autoSubPlan),
    executedSubs: selectExecuted(autoSubPlan),
    remainingSubCount: selectRemainingCount(autoSubPlan),
    isPlanComplete: selectIsPlanComplete(autoSubPlan),

    // Internal refs (exposed for edge cases)
    skipCooldownRef,
    planActivationTimeRef,
  };

}
