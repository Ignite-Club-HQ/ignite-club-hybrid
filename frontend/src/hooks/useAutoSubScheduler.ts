/**
 * useAutoSubScheduler — clock-driven auto-sub logic.
 *
 * Owns everything that reacts to the game timer:
 *   • `checkForDueSubs(elapsed, half)` — open dialog when a sub falls due
 *   • `updateNextSubInfo(elapsed, half)` — refresh the countdown HUD
 *   • `checkHalftimeSubs(newHalf)` — handle stale 1st-half + halftime subs
 *
 * Also owns the dialog UI state (`pendingAutoSub`, `pendingBatchSubs`,
 * `subConfirmDialogOpen`), the due-highlight set, and the countdown.
 *
 * Lifted out of `useAutoSubs.ts` (Step D of the refactor) so the scheduler
 * can be reasoned about — and eventually tested — in isolation from the
 * plan-mutation handlers. The hook is intentionally thin: pure clock
 * decisions in, side-effects (toast/beep/setState) out.
 */
import { useCallback, useRef, useState } from "react";
import type { Dispatch, MutableRefObject, SetStateAction } from "react";
import type { Player, SubstitutionEvent } from "@/components/pitch/types";
import type { GameTimerRef } from "@/components/pitch/GameTimer";
import { playSubAlertBeep } from "@/components/pitch/GameTimer";
import {
  getSubKey,
  markSubsExecuted,
  getDueSubGroups,
  findRelevantNextSub,
} from "@/components/pitch/autoSubHelpers";
import { validateAndFixRemainingPlan } from "@/components/pitch/pitchStateUtils";
import { triggerPitchCheck } from "@/lib/triggerPitchCheck";
import { hasAcknowledgedHalftimePrompt } from "@/components/pitch/halftimePromptAck";

export interface UseAutoSubSchedulerArgs {
  autoSubActive: boolean;
  autoSubPaused: boolean;
  autoSubPlan: SubstitutionEvent[];
  setAutoSubPlan: Dispatch<SetStateAction<SubstitutionEvent[]>>;
  halftimePromptAckKey?: string | null;
  lockedPlayerIds: Set<string>;
  playersRef: MutableRefObject<Player[]>;
  gameTimerRef: MutableRefObject<GameTimerRef | null>;
  skipCooldownRef: MutableRefObject<number>;
  planActivationTimeRef: MutableRefObject<{ seconds: number; half: 1 | 2 } | null>;
  /** Recalc when older subs are auto-skipped because the clock skipped past them. */
  safeRecalculate: (
    players: Player[],
    halfDurationSeconds: number,
    currentElapsed: number,
    half: 1 | 2,
    skippedSub: SubstitutionEvent,
    existingUnexecuted: SubstitutionEvent[]
  ) => SubstitutionEvent[];
  shouldRecalculateAfterSkip: (
    skippedSubs: SubstitutionEvent[],
    currentElapsed: number,
    half: 1 | 2,
    halfDurationSeconds: number
  ) => boolean;
  toast: (opts: { title: string; description?: string }) => void;
}

export function useAutoSubScheduler({
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
}: UseAutoSubSchedulerArgs) {
  // ── Dialog UI state owned by the scheduler ────────────────────
  const [pendingAutoSub, setPendingAutoSub] = useState<SubstitutionEvent | null>(null);
  const [pendingBatchSubs, setPendingBatchSubs] = useState<SubstitutionEvent[]>([]);
  const [subConfirmDialogOpen, setSubConfirmDialogOpen] = useState(false);

  // ── Sub-due highlight (auto-clears after 30s) ────────────────
  const [subDuePlayerIds, setSubDuePlayerIds] = useState<Set<string>>(new Set());
  const subDueTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Countdown HUD for next sub ────────────────────────────────
  const [nextSubInfo, setNextSubInfo] = useState<{
    playerInId: string;
    playerOutId: string;
    countdown: string;
  } | null>(null);

  // ── Due-sub detection (called from handleTimerUpdate) ─────────
  const checkForDueSubs = useCallback(
    (elapsedSeconds: number, currentHalf: 1 | 2) => {
      if (!autoSubActive || autoSubPlan.length === 0 || autoSubPaused) return false;
      if (gameTimerRef.current?.isGameFinished()) return false;
      if (!gameTimerRef.current?.isRunning?.()) return false;
      if (Date.now() - skipCooldownRef.current < 3000) return false;

      const activationTime = planActivationTimeRef.current;
      const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 45;
      const halfDurationSeconds = minsPerHalf * 60;
      const eligibleSubs = autoSubPlan.filter((sub) => {
        if (sub.executed) return false;
        if (activationTime && sub.half === activationTime.half && sub.time < activationTime.seconds) return false;
        if (activationTime && sub.half < activationTime.half) return false;
        return true;
      });

      const { latestDueSubs, olderDueSubs: olderSubs } = getDueSubGroups(
        eligibleSubs,
        currentHalf,
        elapsedSeconds,
        halfDurationSeconds
      );

      if (latestDueSubs.length === 0) return false;
      const latestDueSub = latestDueSubs[0];

      // ── Cascade-skip subs the clock has run past ──
      if (olderSubs.length > 0) {
        const olderKeys = olderSubs.map((s) => getSubKey(s));
        const shouldRecalculate = shouldRecalculateAfterSkip(
          olderSubs,
          elapsedSeconds,
          currentHalf,
          halfDurationSeconds
        );

        setAutoSubPlan((prev) => {
          const markedPlan = markSubsExecuted(prev, olderKeys, true);
          const executedSubs = markedPlan.filter((s) => s.executed);
          const existingUnexecuted = markedPlan.filter((s) => !s.executed);
          const recalculated = shouldRecalculate
            ? safeRecalculate(
                playersRef.current,
                halfDurationSeconds,
                elapsedSeconds,
                currentHalf,
                olderSubs[olderSubs.length - 1],
                existingUnexecuted
              )
            : existingUnexecuted;

          return validateAndFixRemainingPlan(
            [...executedSubs, ...recalculated],
            playersRef.current
          );
        });

        toast({
          title: `${olderSubs.length} missed sub${olderSubs.length > 1 ? "s" : ""} skipped`,
          description: shouldRecalculate
            ? "Plan recalculated for remaining time"
            : "Remaining substitutions preserved",
        });
      }

      const dueSubs = latestDueSubs.filter((sub) => !lockedPlayerIds.has(sub.playerOut.id));
      if (dueSubs.length === 0) {
        if (olderSubs.length > 0 && pendingAutoSub) {
          setPendingAutoSub(null);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(false);
          setSubDuePlayerIds(new Set());
          if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
        }
        return olderSubs.length > 0;
      }

      // Already pointing at this same time-slot → keep current dialog open
      if (
        pendingAutoSub &&
        pendingAutoSub.half === latestDueSub.half &&
        pendingAutoSub.time === latestDueSub.time
      ) {
        return olderSubs.length > 0;
      }

      if (pendingAutoSub) {
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(false);
        setSubDuePlayerIds(new Set());
        if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
      }

      const [primarySub, ...additionalSubs] = dueSubs;

      const playerOutName = primarySub.playerOut.name || `#${primarySub.playerOut.number}`;
      const playerInName = primarySub.playerIn.name || `#${primarySub.playerIn.number}`;
      const notificationBody =
        dueSubs.length > 1
          ? `Time for ${dueSubs.length} substitutions`
          : `Time to sub: ${playerOutName} ➜ ${playerInName}`;
      playSubAlertBeep(notificationBody);

      const dueIds = new Set<string>();
      dueSubs.forEach((s) => {
        dueIds.add(s.playerOut.id);
        dueIds.add(s.playerIn.id);
      });
      setSubDuePlayerIds(dueIds);
      if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
      subDueTimerRef.current = setTimeout(() => setSubDuePlayerIds(new Set()), 30000);

      setPendingAutoSub(primarySub);
      setPendingBatchSubs(additionalSubs);
      setSubConfirmDialogOpen(true);

      // Poke server so push fan-out to other staff happens immediately.
      const dedupeKey = `${primarySub.half}-${primarySub.time}-${primarySub.playerOut.id}`;
      void triggerPitchCheck("pitch-board-pending-sub", dedupeKey);
      return true;
    },
    [
      autoSubActive,
      autoSubPlan,
      autoSubPaused,
      pendingAutoSub,
      lockedPlayerIds,
      toast,
      gameTimerRef,
      playersRef,
      safeRecalculate,
      shouldRecalculateAfterSkip,
      setAutoSubPlan,
      skipCooldownRef,
      planActivationTimeRef,
    ]
  );

  // ── Next-sub countdown updater ────────────────────────────────
  const updateNextSubInfo = useCallback(
    (elapsedSeconds: number, currentHalf: 1 | 2) => {
      const isFinished = gameTimerRef.current?.isGameFinished();
      if (autoSubActive && autoSubPlan.length > 0 && !autoSubPaused && !isFinished) {
        const remainingSubs = autoSubPlan.filter((s) => !s.executed);
        const minsPerHalf = gameTimerRef.current?.getMinutesPerHalf() || 10;
        const halfDurationSeconds = minsPerHalf * 60;
        const nextSub = findRelevantNextSub(
          remainingSubs,
          currentHalf,
          elapsedSeconds,
          halfDurationSeconds
        );
        if (nextSub) {
          const secsUntil =
            nextSub.half === currentHalf
              ? Math.max(0, nextSub.time - elapsedSeconds)
              : nextSub.time +
                (nextSub.half - currentHalf) *
                  (gameTimerRef.current?.getMinutesPerHalf() || 10) *
                  60 -
                elapsedSeconds;
          const mins = Math.floor(secsUntil / 60);
          const secs = Math.floor(secsUntil % 60);
          setNextSubInfo({
            playerInId: nextSub.playerIn.id,
            playerOutId: nextSub.playerOut.id,
            countdown: `${mins}:${secs.toString().padStart(2, "0")}`,
          });
        } else {
          setNextSubInfo(null);
        }
      } else {
        if (isFinished) {
          setNextSubInfo(null);
          setSubDuePlayerIds(new Set());
          if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
          if (subConfirmDialogOpen) {
            setSubConfirmDialogOpen(false);
            setPendingAutoSub(null);
            setPendingBatchSubs([]);
          }
        }
        setNextSubInfo((prev) => (prev ? null : prev));
      }
    },
    [autoSubActive, autoSubPlan, autoSubPaused, subConfirmDialogOpen, gameTimerRef]
  );

  // ── Half-change handler ───────────────────────────────────────
  const checkHalftimeSubs = useCallback(
    (newHalf: 1 | 2) => {
      if (newHalf !== 2) return false;

      const ackKey = halftimePromptAckKey ?? null;
      if (hasAcknowledgedHalftimePrompt(ackKey)) return false;

      const staleFirstHalfSubs = autoSubPlan.filter(
        (sub) => !sub.executed && sub.half === 1
      );
      const halftimeSubs = autoSubPlan.filter(
        (sub) => !sub.executed && sub.half === 2 && sub.time === 0
      );

      if (staleFirstHalfSubs.length > 0) {
        const staleKeys = staleFirstHalfSubs.map(getSubKey);
        setAutoSubPlan((prev) => markSubsExecuted(prev, staleKeys, true));
        setPendingAutoSub(null);
        setPendingBatchSubs([]);
        setSubConfirmDialogOpen(false);
        setSubDuePlayerIds(new Set());
        if (subDueTimerRef.current) clearTimeout(subDueTimerRef.current);
      }

      // Shared guard reused by both setTimeout branches: only fire the
      // halftime dialog if the user hasn't acknowledged AND the timer is
      // still parked on the genuine halftime boundary (H2, elapsed≤5,
      // paused). Prevents stale prompts if the coach starts H2 within the
      // 500ms delay.
      const stillAtHalftimeBoundary = () => {
        if (hasAcknowledgedHalftimePrompt(ackKey)) return false;
        const tHalf = gameTimerRef.current?.getCurrentHalf?.() ?? 1;
        const tElapsed = gameTimerRef.current?.getElapsedSeconds?.() ?? 0;
        const tRunning = gameTimerRef.current?.isRunning?.() ?? false;
        return tHalf === 2 && tElapsed <= 5 && !tRunning;
      };

      if (halftimeSubs.length === 0) {
        // No halftime subs — still show the halftime popup
        setTimeout(() => {
          if (!stillAtHalftimeBoundary()) return;
          playSubAlertBeep("Half time!");
          setPendingAutoSub(null);
          setPendingBatchSubs([]);
          setSubConfirmDialogOpen(true);
        }, 500);
        return true;
      }

      setTimeout(() => {
        if (!stillAtHalftimeBoundary()) return;
        const [primarySub, ...additionalSubs] = halftimeSubs;
        const notificationBody =
          halftimeSubs.length > 1
            ? `Halftime: ${halftimeSubs.length} substitutions`
            : `Halftime sub: ${primarySub.playerOut.name || `#${primarySub.playerOut.number}`} ➜ ${primarySub.playerIn.name || `#${primarySub.playerIn.number}`}`;
        playSubAlertBeep(notificationBody);
        setPendingAutoSub(primarySub);
        setPendingBatchSubs(additionalSubs);
        setSubConfirmDialogOpen(true);
      }, 500);

      return true;
    },
    [autoSubPlan, setAutoSubPlan, halftimePromptAckKey]
  );

  return {
    // Dialog state
    pendingAutoSub,
    setPendingAutoSub,
    pendingBatchSubs,
    setPendingBatchSubs,
    subConfirmDialogOpen,
    setSubConfirmDialogOpen,

    // Highlight + countdown
    subDuePlayerIds,
    setSubDuePlayerIds,
    subDueTimerRef,
    nextSubInfo,

    // Clock-driven entry points
    checkForDueSubs,
    updateNextSubInfo,
    checkHalftimeSubs,
  };
}
