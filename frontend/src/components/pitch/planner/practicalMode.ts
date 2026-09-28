// Practical-mode (rotationSpeed === 1) auto-sub planner: FIFO queue rotation
// with a target ~7-min cadence and max 2 swaps per window, designed to
// mirror how a real junior coach manages a game — predictable order, few
// interruptions, "fair enough" distribution. Extracted from
// planner/scheduler.ts so the shared scheduler setup (GK resolution,
// remaining-time calc, priority-bias helpers) and each rotation-speed
// strategy live in their own bounded module.
import type { PitchPosition } from "../PositionBadge";
import type { Player, SubstitutionEvent } from "./scheduler";
import { buildSubWindows } from "./windows";
import { ensureNoStarvedPlayers } from "./standardMode";
import { calculatePlanSpread, buildEqualTimeOverride } from "./equalTimeOverride";

/** Target gap between Standard-mode sub windows (seconds). 7 min sits in the
 *  spec'd 6–8 min window: low disruption, predictable cadence. */
const PRACTICAL_SUB_INTERVAL_SECONDS = 7 * 60;
/** Standard mode allows at most this many simultaneous swaps per window. */
const PRACTICAL_MAX_SUBS_PER_WINDOW = 2;
/** Below this fraction of the fair target, a player's next window is forced
 *  regardless of FIFO order. */
const PRACTICAL_MIN_THRESHOLD_RATIO = 0.75;
/** Above this fraction of the fair target, a player is protected from being
 *  brought back on until others catch up. */
const PRACTICAL_MAX_THRESHOLD_RATIO = 1.2;
/** No substitutions in the opening minutes of either half. */
const PRACTICAL_NO_SUB_BEFORE_SECONDS = 5 * 60;
const PRACTICAL_NO_SUB_AFTER_SECONDS = 150; // 2.5 min
/** Players just subbed on are protected from being pulled off for this long. */
const PRACTICAL_RECENT_SUB_PROTECTION_SECONDS = 4 * 60;
/** How early (seconds) we may pull a sub forward to rescue a player who would
 *  otherwise breach the minimum threshold. */
const PRACTICAL_EARLY_SUB_TOLERANCE_SECONDS = 60;
/** Keep normal Standard windows from landing immediately beside forced GK
 *  participation windows. */
const PRACTICAL_GK_WINDOW_BUFFER_SECONDS = 3 * 60;

export interface PracticalModeContext {
  playerData: Player[];
  teamSize: number;
  halfDurationSeconds: number;
  rotationSpeed: number;
  disableBatchSubs: boolean;
  rotateGkAtHalftime: boolean;
  startHalf: 1 | 2;
  clampedStartElapsed: number;
  startElapsedSeconds: number;
  maxSpreadMinutes: number;
  eff: {
    standardTargetInterval: number;
    standardIntervalFloor: number;
    frequentIntervalFloor: number;
    minShiftSeconds: number;
    halftimeGuardSeconds?: number;
  };
  priorityOrder: string[];
  priorityTargetBiasSeconds: (id: string) => number;
  priorityPullOffCompare: (a: string, b: string) => number;
  priorityBringOnCompare: (a: string, b: string) => number;
  gkOnPitch: Player | undefined;
  halftimeGkIn: Player | null;
  startingGkWillRotate: boolean;
  includeStartingGkInRotation: boolean;
  outfieldPlayers: Player[];
  outfieldOnPitch: Player[];
  outfieldOnBench: Player[];
  totalOutfieldPlayers: number;
  totalRemainingSeconds: number;
}

export function buildPracticalModePlan(ctx: PracticalModeContext): SubstitutionEvent[] {
  const {
    playerData, teamSize, halfDurationSeconds, rotationSpeed,
    disableBatchSubs, rotateGkAtHalftime, startHalf, clampedStartElapsed,
    startElapsedSeconds, maxSpreadMinutes, eff, priorityOrder,
    priorityTargetBiasSeconds, priorityPullOffCompare, priorityBringOnCompare,
    gkOnPitch, halftimeGkIn, startingGkWillRotate, includeStartingGkInRotation,
    outfieldPlayers, outfieldOnPitch, outfieldOnBench,
    totalOutfieldPlayers, totalRemainingSeconds,
  } = ctx;
  const plan: SubstitutionEvent[] = [];
    const startAbs = startHalf === 1 ? clampedStartElapsed : halfDurationSeconds + clampedStartElapsed;
    const endAbs = halfDurationSeconds * 2;
    const subsPerWindow = Math.max(
      1,
      Math.min(
        disableBatchSubs ? 1 : PRACTICAL_MAX_SUBS_PER_WINDOW,
        outfieldOnBench.length,
        outfieldOnPitch.length
      )
    );
    // BENCH-AWARE CADENCE: the default 7-min window keeps Standard low-disruption,
    // but with a large bench (e.g. 9v9 +5, 11v11 +6) a fixed 7-min cadence can't
    // rotate everyone through within the spread cap and minutes blow out to 16-20'.
    // Shrink the interval just enough to deliver one full rotation cycle in the
    // remaining game time, with a hard floor of 4 min so windows never get tricky.
    // Cycle = N off-events needed (one per outfielder), batched `subsPerWindow` at a time.
    const cycleWindowsNeeded = Math.ceil(totalOutfieldPlayers / subsPerWindow);
    const cadenceForCycle = totalRemainingSeconds > 0 && cycleWindowsNeeded > 0
      ? Math.floor(totalRemainingSeconds / (cycleWindowsNeeded + 1))
      : eff.standardTargetInterval;
    const PRACTICAL_MIN_INTERVAL = Math.min(
      eff.standardIntervalFloor,
      Math.max(90, Math.floor(cadenceForCycle || eff.standardIntervalFloor)),
    ); // Short games / large benches must not be starved by a fixed 4-min floor.
    const intervalSec = Math.max(
      PRACTICAL_MIN_INTERVAL,
      Math.min(eff.standardTargetInterval, cadenceForCycle)
    );
    const noSubBeforeSeconds = Math.min(
      PRACTICAL_NO_SUB_BEFORE_SECONDS,
      Math.max(60, Math.floor(halfDurationSeconds * 0.2)),
    );
    const noSubAfterSeconds = Math.min(
      PRACTICAL_NO_SUB_AFTER_SECONDS,
      Math.max(45, Math.floor(halfDurationSeconds * 0.12)),
    );
    const halftimeBlackoutSeconds = Math.min(90, Math.max(30, Math.floor(intervalSec * 0.5)));

    // ---- Fairness model ------------------------------------------------------
    // targetSec = (gameDuration × playersOnField) / totalPlayers
    // minThreshold = 0.75 × target — fairness floor (override FIFO)
    // maxThreshold = 1.20 × target — soft cap (prioritise OFF, block ON)
    // GK priority is handled with protected outfield runs either side of the
    // halftime keeper swap, without adding double-credit on top of GK minutes.
    const fullGameSec = halfDurationSeconds * 2;
    const fairPlayerCount = Math.max(playerData.filter(p => !p.isInjured).length, 1);
    const targetSecPerPlayer = (fullGameSec * teamSize) / fairPlayerCount;
    const playerTargetSec = (id: string) => Math.max(0, targetSecPerPlayer + priorityTargetBiasSeconds(id));
    const playerMinThresholdSec = (id: string) => playerTargetSec(id) * PRACTICAL_MIN_THRESHOLD_RATIO;
    const playerMaxThresholdSec = (id: string) => playerTargetSec(id) * PRACTICAL_MAX_THRESHOLD_RATIO;

    // GK-PROTECTED players: anyone assigned as GK in any half. They must finish
    // at or near the top of the allowed spread (target + spread/2) without
    // exceeding the spread cap. We don't widen the spread to favour them — we
    // bias OUT/IN selection so they sit at the top of the existing range.
    const gkProtectedIds = new Set<string>();
    if (gkOnPitch) gkProtectedIds.add(gkOnPitch.id);
    if (halftimeGkIn) gkProtectedIds.add(halftimeGkIn.id);
    const isGkProtected = (id: string) => gkProtectedIds.has(id);
    // Top of the allowed spread — GK-protected players aim for this.
    const gkCeilingSec = targetSecPerPlayer + (maxSpreadMinutes / 2) * 60;

    // Track projected playing seconds per outfield player. Seed from minutes
    // already accumulated (for mid-game starts), converted to seconds.
    const projected = new Map<string, number>();
    outfieldPlayers.forEach(p => projected.set(p.id, p.minutesPlayed || 0));
    if (gkOnPitch && startHalf === 1) {
      projected.set(gkOnPitch.id, (projected.get(gkOnPitch.id) || 0) + halfDurationSeconds);
    }
    if (halftimeGkIn) {
      projected.set(halftimeGkIn.id, (projected.get(halftimeGkIn.id) || 0) + halfDurationSeconds);
    }

    const halfTimeAbs = halfDurationSeconds;

    const remainingOutfieldAvailability = (id: string, absT: number) => {
      if (includeStartingGkInRotation && id === gkOnPitch?.id) {
        return Math.max(1, endAbs - Math.max(absT, halfTimeAbs));
      }
      if (halftimeGkIn && id === halftimeGkIn.id) {
        return absT < halfTimeAbs ? Math.max(1, halfTimeAbs - absT) : 1;
      }
      return Math.max(1, endAbs - absT);
    };

    const isKeeperRotationPlayer = (id: string) => id === gkOnPitch?.id || id === halftimeGkIn?.id;
    const needsProtectedOutfieldRun = (id: string) => {
      const guaranteedGkSeconds = id === gkOnPitch?.id || id === halftimeGkIn?.id ? halfDurationSeconds : 0;
      return guaranteedGkSeconds < targetSecPerPlayer - (maxSpreadMinutes * 60) / 2;
    };
    // GKs already get a guaranteed 20 min in goal — that's the priority. Do
    // NOT add an additional outfield bonus on top, or their total minutes
    // balloon past the cap and starve bench players (creating large spreads).
    // The "priority" for GKs is realised purely by being shielded from being
    // pulled off too early (see overCap/FIFO filters below) and by the forced
    // outfield window for the 2H GK before halftime.
    const effectiveMinSec = (id: string) => playerMinThresholdSec(id);
    const effectiveTargetSec = (id: string) => playerTargetSec(id);
    const shortfall = (id: string) => effectiveTargetSec(id) - (projected.get(id) || 0);
    const needScore = (id: string, absT: number, queueIndex = 0) => {
      const need = shortfall(id);
      return (need / remainingOutfieldAvailability(id, absT)) * 10000 + need * 0.05 - queueIndex * 0.01;
    };

    // Build candidate sub-window times.
    // Rules: no subs before minute 5 from kickoff, none in last ~2.5 min of
    // each half, none right around halftime. ~7 min cadence keeps things
    // predictable and lands us in the 8–14 total subs sweet spot.
    const earliestAbs = Math.max(startAbs + 60, noSubBeforeSeconds);
    const isInBlackout = (t: number) => {
      // Last N seconds of half 1
      if (t > halfDurationSeconds - noSubAfterSeconds && t <= halfDurationSeconds) return true;
      // Last N seconds of half 2
      if (t > endAbs - noSubAfterSeconds) return true;
      // Right around halftime
      if (Math.abs(t - halfDurationSeconds) < halftimeBlackoutSeconds) return true;
      // Before settling-in window in either half
      if (t < noSubBeforeSeconds) return true;
      if (t > halfDurationSeconds && t < halfDurationSeconds + noSubBeforeSeconds) return true;
      return false;
    };

    // Forced and extra window collectors (consumed by buildSubWindows below).
    const forcedWindowTimes: number[] = [];
    const extraWindowTimes: number[] = [];
    // GOALKEEPER RULE: GKs may ONLY be swapped at halftime (the GK position
    // itself can only change at start-of-game or halftime). However, the
    // nominated 2H GK can play OUTFIELD in 1H — they're just a normal field
    // player until they take the gloves at HT. Same for the 1H GK in 2H.
    // We give the 2H GK a forced outfield run in 1H so they don't end the
    // match well below the fairness floor.
    const forcedInByWindow = new Map<number, string>();
    const forcedOutByWindow = new Map<number, string>();
    let halftimeGkBenchByAbs: number | null = null;
    if (halftimeGkIn && needsProtectedOutfieldRun(halftimeGkIn.id) && startHalf === 1 && halfDurationSeconds > 12 * 60) {
      const tinySquad = outfieldOnBench.length <= 2;
      const h1GkOn = noSubBeforeSeconds;
      const h1GkOffOffset = tinySquad ? noSubAfterSeconds : Math.max(noSubAfterSeconds, Math.min(3 * 60, intervalSec));
      const h1GkOff = Math.max(h1GkOn + 9 * 60, halfDurationSeconds - h1GkOffOffset);
      halftimeGkBenchByAbs = Math.floor(h1GkOff);
      [h1GkOn, h1GkOff].forEach(gkTime => {
        if (gkTime > startAbs) forcedWindowTimes.push(Math.floor(gkTime));
      });
      if (h1GkOn > startAbs) forcedInByWindow.set(Math.floor(h1GkOn), halftimeGkIn.id);
      if (h1GkOff > startAbs) forcedOutByWindow.set(Math.floor(h1GkOff), halftimeGkIn.id);
    }
    // Mirror window in H2 for the 1H GK so they get outfield time toward the
    // top of the allowed spread.
    if (includeStartingGkInRotation && gkOnPitch && needsProtectedOutfieldRun(gkOnPitch.id) && halfDurationSeconds > 12 * 60) {
      const tinySquad = outfieldOnBench.length <= 2;
      const h2GkOnOffset = tinySquad ? Math.min(2 * 60, noSubBeforeSeconds) : noSubBeforeSeconds;
      const h2GkOn = halfDurationSeconds + h2GkOnOffset;
      if (h2GkOn > startAbs) {
        forcedWindowTimes.push(Math.floor(h2GkOn));
        forcedInByWindow.set(Math.floor(h2GkOn), gkOnPitch.id);
      }
    }
    if (startAbs < halfTimeAbs && halfDurationSeconds > 18 * 60 && outfieldOnBench.length >= 3) {
      const h2FairnessRescue = halfDurationSeconds + Math.floor(halfDurationSeconds * 0.5);
      if (h2FairnessRescue < endAbs - noSubAfterSeconds && !isInBlackout(h2FairnessRescue)) {
        extraWindowTimes.push(Math.floor(h2FairnessRescue));
      }
      const h2LateFairnessRescue = halfDurationSeconds + Math.floor(halfDurationSeconds * 0.72);
      if (h2LateFairnessRescue < endAbs - noSubAfterSeconds && !isInBlackout(h2LateFairnessRescue)) {
        extraWindowTimes.push(Math.floor(h2LateFairnessRescue));
      }
    }
    // Tiny squads (≤2 bench): extra mid-2H rescue window so 1H FWDs get pulled.
    if (outfieldOnBench.length <= 2 && halfDurationSeconds > 14 * 60) {
      const h2R = halfDurationSeconds + Math.floor(halfDurationSeconds * 0.5);
      if (h2R < endAbs - noSubAfterSeconds && !isInBlackout(h2R)) {
        extraWindowTimes.push(h2R);
      }
    }

    // Unified window builder — single source of truth for cadence, blackouts,
    // and forced-time merging across Standard / Frequent / Advanced.
    const baseWindowTimes = buildSubWindows({
      startAbs,
      endAbs,
      halfDurationSeconds,
      targetIntervalSec: intervalSec,
      intervalFloorSec: PRACTICAL_MIN_INTERVAL,
      noSubBeforeSec: noSubBeforeSeconds,
      noSubAfterSec: noSubAfterSeconds,
      halftimeGuardSec: halftimeBlackoutSeconds,
      halftimeGuardActive: true,
      forcedTimes: forcedWindowTimes,
      extraTimes: extraWindowTimes,
      forcedBufferSec: PRACTICAL_GK_WINDOW_BUFFER_SECONDS,
    });

    const onPitchOrder: string[] = outfieldOnPitch.map(p => p.id);
    const benchOrder: string[] = outfieldOnBench.map(p => p.id);

    // Track when each player was last subbed ON (absolute seconds) — used to
    // protect recent subs from being immediately pulled off.
    const lastSubbedOnAbs = new Map<string, number>();

    // RULE: every outfield starter must be benched at least once. Track who
    // has yet to be subbed off; bias selection toward never-benched players.
    // GK-PROTECTED EXEMPTION: players assigned as GK in either half are
    // exempt from the bench-once rule. They should be allowed to play their
    // full outfield run before/after their GK shift to reach the top of the
    // allowed spread (equal-highest minutes).
    const neverBenched = new Set<string>(
      outfieldOnPitch.filter(p => !isGkProtected(p.id)).map(p => p.id),
    );

    const willGkSwapAtHt =
      rotateGkAtHalftime && startHalf === 1 && !!gkOnPitch && !!halftimeGkIn;

    // Accrue projected outfield time as we walk through the schedule.
    let lastTickAbs = startAbs;
    const accrueUntil = (absT: number) => {
      const dt = Math.max(0, absT - lastTickAbs);
      if (dt === 0) return;
      onPitchOrder.forEach(id => projected.set(id, (projected.get(id) || 0) + dt));
      lastTickAbs = absT;
    };

    const pendingWindows = [...baseWindowTimes];
    let gkSwapApplied = false;

    while (pendingWindows.length > 0) {
      let t = pendingWindows.shift()!;

      // Rescue check: if any bench player is currently below the floor and
      // would stay below by this window, allow pulling sub up to ~2 min earlier.
      const isForcedGkWindow = forcedInByWindow.has(t) || forcedOutByWindow.has(t);
      const benchUnder = benchOrder.filter(
        id => (projected.get(id) || 0) < effectiveMinSec(id)
      );
      if (!isForcedGkWindow && benchUnder.length > 0) {
        const earliest = Math.max(lastTickAbs + 60, t - PRACTICAL_EARLY_SUB_TOLERANCE_SECONDS);
        if (earliest < t) t = Math.floor(earliest);
      }

      // Apply HT GK swap to queues at first window after halftime.
      if (willGkSwapAtHt && !gkSwapApplied && t > halfTimeAbs) {
        accrueUntil(halfTimeAbs);
        const startingGkId = gkOnPitch!.id;
        const h2GkId = halftimeGkIn!.id;
        const ip = onPitchOrder.indexOf(h2GkId);
        if (ip >= 0) onPitchOrder.splice(ip, 1);
        const ib = benchOrder.indexOf(h2GkId);
        if (ib >= 0) benchOrder.splice(ib, 1);
        if (!benchOrder.includes(startingGkId)) benchOrder.unshift(startingGkId);
        gkSwapApplied = true;
      }

      accrueUntil(t);

      const swaps = Math.min(subsPerWindow, onPitchOrder.length, benchOrder.length);
      if (swaps === 0) continue;
      const windowIns = new Set<string>();
      const windowOuts = new Set<string>();

      const { half, time } = (() => ({
        half: (t < halfDurationSeconds ? 1 : 2) as 1 | 2,
        time: t < halfDurationSeconds ? t : t - halfDurationSeconds,
      }))();

      for (let i = 0; i < swaps; i++) {
        const isActiveGk = (id: string) =>
          (gkOnPitch && id === gkOnPitch.id && t < halfTimeAbs) ||
          (halftimeGkIn && id === halftimeGkIn.id && t >= halfTimeAbs);

        // -------- Pick playerOut --------
        // Priority: (1) the nominated 2H GK must be back on the bench before
        // halftime, (2) the highest-minute player, especially if over cap.
        // Over-cap pull: prefer subbing off players who are above the cap, OR
        // when a bench player is below their effective floor. Keepers should
        // generally NOT be pulled off via over-cap logic — they need their
        // outfield run to land in the top half of total minutes.
        // GK-PROTECTED PROMOTION (OUT): if any GK-protected player on the
        // pitch is below their target ceiling AND a non-GK-protected player
        // on the pitch is at/above the non-GK floor, prefer pulling the
        // non-GK-protected player off so the GK-protected one keeps banking
        // outfield minutes toward the top of the spread.
        const gkProtectedOnPitchBelowCeiling = onPitchOrder.some(
          id => isGkProtected(id) && needsProtectedOutfieldRun(id) && !isActiveGk(id) && (projected.get(id) || 0) < gkCeilingSec - 30
        );

        const overCap = onPitchOrder
          .filter(id => !isActiveGk(id))
          .filter(id => !windowIns.has(id))
          // Protect recently-subbed-on players (<4 min on field).
          .filter(id => {
            const onAt = lastSubbedOnAbs.get(id);
            return onAt === undefined || (t - onAt) >= PRACTICAL_RECENT_SUB_PROTECTION_SECONDS;
          })
          // Keep the nominated 2H GK on until their planned pre-halftime bench window.
          .filter(id => id !== halftimeGkIn?.id || halftimeGkBenchByAbs === null || t >= halftimeGkBenchByAbs)
          // Don't pull a GK-protected player off via over-cap until they've
          // reached the top of the allowed spread (gkCeilingSec). Their
          // outfield run should land them at equal-highest minutes.
          .filter(id => !isGkProtected(id) || !needsProtectedOutfieldRun(id) || (projected.get(id) || 0) >= gkCeilingSec - 30)
          .filter(id => (projected.get(id) || 0) > playerMaxThresholdSec(id) || benchOrder.some(benchId => (projected.get(benchId) || 0) < effectiveMinSec(benchId)))
          .sort((a, b) => {
            // GK-protected promotion: prefer pulling non-GK-protected first
            // when a GK-protected on-pitch is still below ceiling.
            if (gkProtectedOnPitchBelowCeiling) {
              const aGk = isGkProtected(a) ? 1 : 0;
              const bGk = isGkProtected(b) ? 1 : 0;
              if (aGk !== bGk) return aGk - bGk;
            }
            // Bench-everyone rule: prefer pulling never-benched players first.
            const aNB = neverBenched.has(a) ? 1 : 0;
            const bNB = neverBenched.has(b) ? 1 : 0;
            if (aNB !== bNB) return bNB - aNB;
            const priorityCmp = priorityPullOffCompare(a, b);
            if (priorityCmp !== 0) return priorityCmp;
            return (projected.get(b) || 0) - (projected.get(a) || 0);
          });

        let outId: string | null = null;
        const forcedOutId = forcedOutByWindow.get(t);
        const h2GkNeedsBenchForHalftime = halftimeGkIn?.id &&
          (halftimeGkBenchByAbs === null || t >= halftimeGkBenchByAbs) &&
          !windowIns.has(halftimeGkIn.id) &&
          onPitchOrder.includes(halftimeGkIn.id);
        if (forcedOutId && onPitchOrder.includes(forcedOutId) && !windowIns.has(forcedOutId)) {
          outId = forcedOutId;
          const idx = onPitchOrder.indexOf(outId);
          if (idx >= 0) onPitchOrder.splice(idx, 1);
        } else if (h2GkNeedsBenchForHalftime) {
          outId = halftimeGkIn!.id;
          const idx = onPitchOrder.indexOf(outId);
          if (idx >= 0) onPitchOrder.splice(idx, 1);
        } else if (overCap.length > 0) {
          outId = overCap[0];
          const idx = onPitchOrder.indexOf(outId);
          if (idx >= 0) onPitchOrder.splice(idx, 1);
        } else {
          // Build the eligible candidate list, then choose.
          const buildEligible = (allowRecentSub: boolean) => {
            const out: string[] = [];
            for (let j = 0; j < onPitchOrder.length; j++) {
              const candidate = onPitchOrder[j];
              if (isActiveGk(candidate)) continue;
              if (windowIns.has(candidate)) continue;
              if (candidate === halftimeGkIn?.id && halftimeGkBenchByAbs !== null && t < halftimeGkBenchByAbs) continue;
              // Don't sub off a GK-protected player while they're still below
              // their ceiling — they need to finish at the top of the spread.
              if (isGkProtected(candidate) && needsProtectedOutfieldRun(candidate) && (projected.get(candidate) || 0) < gkCeilingSec - 30) continue;
              if (isKeeperRotationPlayer(candidate) && (projected.get(candidate) || 0) < effectiveMinSec(candidate)) continue;
              if (!allowRecentSub) {
                const onAt = lastSubbedOnAbs.get(candidate);
                if (onAt !== undefined && (t - onAt) < PRACTICAL_RECENT_SUB_PROTECTION_SECONDS) continue;
              }
              out.push(candidate);
            }
            return out;
          };

          // BENCH-EVERYONE GUARANTEE: if remaining sub windows are scarce
          // relative to never-benched starters still on the pitch, force one
          // of them off NOW — even if it costs a recently-subbed player a
          // shorter shift. Threshold: windows-left ≤ never-benched-on-pitch.
          const neverBenchedOnPitch = onPitchOrder.filter(id => neverBenched.has(id) && !isActiveGk(id) && !windowIns.has(id));
          const windowsLeft = pendingWindows.length + 1;
          const mustForceNeverBenched = neverBenchedOnPitch.length > 0 && windowsLeft <= neverBenchedOnPitch.length + 1;

          let eligible = buildEligible(false);
          // If we must force a never-benched player but none are eligible
          // under the recent-sub-protection rule, drop that protection.
          if (mustForceNeverBenched && !eligible.some(id => neverBenched.has(id))) {
            eligible = buildEligible(true);
          }

          if (eligible.length > 0) {
            // GK-protected first; never-benched next; then existing tiebreaks.
            eligible.sort((a, b) => {
              if (gkProtectedOnPitchBelowCeiling) {
                const aGk = isGkProtected(a) ? 1 : 0;
                const bGk = isGkProtected(b) ? 1 : 0;
                if (aGk !== bGk) return aGk - bGk;
              }
              const aNB = neverBenched.has(a) ? 1 : 0;
              const bNB = neverBenched.has(b) ? 1 : 0;
              if (aNB !== bNB) return bNB - aNB;
              const priorityCmp = priorityPullOffCompare(a, b);
              if (priorityCmp !== 0) return priorityCmp;
              if (aNB === 1 && bNB === 1) {
                return onPitchOrder.indexOf(b) - onPitchOrder.indexOf(a);
              }
              if (outfieldOnBench.length <= 2) {
                return (projected.get(b) || 0) - (projected.get(a) || 0);
              }
              return onPitchOrder.indexOf(a) - onPitchOrder.indexOf(b);
            });
            outId = eligible[0];
            const idx = onPitchOrder.indexOf(outId);
            if (idx >= 0) onPitchOrder.splice(idx, 1);
          }
        }
        if (!outId) break;

        // -------- Pick playerIn --------
        // Priority: lowest adjusted minutes first. This preserves simple
        // windows but makes Standard genuinely fair instead of queue-only.
        const under = benchOrder
          .map((id, index) => ({ id, proj: projected.get(id) || 0, score: needScore(id, t, index) }))
          .filter(b => !windowOuts.has(b.id))
          .filter(b => b.proj < effectiveMinSec(b.id))
          .sort((a, b) => (b.score - a.score) || priorityBringOnCompare(a.id, b.id));

        let inId: string | undefined;
        const forcedInId = forcedInByWindow.get(t);
        if (forcedInId && benchOrder.includes(forcedInId) && !windowOuts.has(forcedInId)) {
          inId = forcedInId;
          const idx = benchOrder.indexOf(inId);
          if (idx >= 0) benchOrder.splice(idx, 1);
        } else if (under.length > 0) {
          inId = under[0].id;
          const idx = benchOrder.indexOf(inId);
          if (idx >= 0) benchOrder.splice(idx, 1);
        } else {
          // Mostly FIFO. Only jump the queue for a genuinely low-minute player
          // (or a forced GK window); otherwise bench order stays predictable.
          const fifoCandidates = benchOrder
            .map((id, index) => ({ id, index, score: needScore(id, t, index), projected: projected.get(id) || 0 }))
            .filter(item => !windowOuts.has(item.id))
            .filter(item => item.projected <= playerMaxThresholdSec(item.id));
          const fifoFirst = fifoCandidates[0];
          const urgent = fifoCandidates
            .filter(item => item.projected < targetSecPerPlayer)
            .sort((a, b) => (b.score - a.score) || priorityBringOnCompare(a.id, b.id))[0];
          const fifoIdx = (urgent && (!fifoFirst || urgent.score > fifoFirst.score + 500))
            ? urgent.index
            : fifoFirst?.index ?? -1;
          if (fifoIdx >= 0) {
            inId = benchOrder.splice(fifoIdx, 1)[0];
          } else {
            const fallbackIdx = benchOrder.findIndex(id => !windowOuts.has(id));
            inId = fallbackIdx >= 0 ? benchOrder.splice(fallbackIdx, 1)[0] : undefined;
          }
        }

        if (!inId) {
          onPitchOrder.unshift(outId);
          break;
        }

        const playerOut = playerData.find(p => p.id === outId)!;
        const playerIn = playerData.find(p => p.id === inId)!;
        const pos = (playerOut.currentPitchPosition || "MID") as PitchPosition;

        plan.push({
          time,
          half,
          playerOut,
          playerIn: { ...playerIn, currentPitchPosition: pos },
          executed: false,
        });

        onPitchOrder.push(inId);
        windowIns.add(inId);
        windowOuts.add(outId);
        benchOrder.push(outId);
        lastSubbedOnAbs.set(inId, t);
        neverBenched.delete(outId);
      }

      // BENCH-EVERYONE GUARANTEE: if there are still never-benched starters
      // on the pitch and we don't have enough remaining windows to bench them
      // all, inject extra synthetic windows ~2 min apart before end of game.
      const tNext = pendingWindows[0] ?? endAbs;
      const isActiveGkAt = (id: string, absT: number) =>
        (gkOnPitch && id === gkOnPitch.id && absT < halfTimeAbs) ||
        (halftimeGkIn && id === halftimeGkIn.id && absT >= halfTimeAbs);
      const stillNB = onPitchOrder.filter(id => neverBenched.has(id) && !isActiveGkAt(id, tNext));
      if (stillNB.length > pendingWindows.length) {
        const deficit = stillNB.length - pendingWindows.length;
        const lastScheduled = pendingWindows.length > 0 ? pendingWindows[pendingWindows.length - 1] : t;
        for (let k = 1; k <= deficit; k++) {
          const extra = Math.min(
            lastScheduled + k * Math.max(90, Math.min(2 * 60, intervalSec)),
            endAbs - noSubAfterSeconds,
          );
          if (extra > t && !pendingWindows.includes(extra)) {
            pendingWindows.push(extra);
          }
        }
        pendingWindows.sort((a, b) => a - b);
      }
    }

    // Final accrual to end of game.
    accrueUntil(endAbs);

    if (willGkSwapAtHt && startHalf === 1) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch!,
        playerIn: halftimeGkIn!,
        executed: false,
      });
    }

    // ===========================================================================
    // STANDARD-MODE REMOVAL PASS — drop late "churn" subs that demote the
    // already-lowest player. The fill loop above can schedule a sub like
    // `Louie -> Hugo` right before full time even when Louie is already the
    // most-underplayed player on the field; benching them at the death just
    // makes the spread worse. We delete a sub iff the resulting plan is still
    // playable AND the lowest projected total strictly improves while spread
    // does not get worse.
    // ===========================================================================
    const subAbs = (s: SubstitutionEvent) =>
      s.half === 1 ? s.time : halfDurationSeconds + s.time;
    const isHtGkSwap = (s: SubstitutionEvent) =>
      !!gkOnPitch && s.half === 2 && s.time === 0 && s.playerOut.id === gkOnPitch.id;
    const standardGkDuty = (id: string) => {
      let duty = 0;
      if (startingGkWillRotate && gkOnPitch && id === gkOnPitch.id) {
        duty += Math.max(0, halfDurationSeconds - startElapsedSeconds);
      }
      if (halftimeGkIn && id === halftimeGkIn.id) duty += halfDurationSeconds;
      return duty;
    };
    const standardSimulate = (candidatePlan: SubstitutionEvent[]) => {
      const onP = new Set<string>(outfieldOnPitch.map(p => p.id));
      const totals = new Map<string, number>();
      outfieldPlayers.forEach(p => totals.set(p.id, p.minutesPlayed || 0));
      const sorted = [...candidatePlan].sort((a, b) => subAbs(a) - subAbs(b));
      let last = startAbs;
      let valid = true;
      for (const ev of sorted) {
        const t = subAbs(ev);
        if (t < last) valid = false;
        const elapsed = Math.max(0, t - last);
        onP.forEach(id => totals.set(id, (totals.get(id) || 0) + elapsed));
        last = t;
        if (isHtGkSwap(ev)) { onP.delete(ev.playerIn.id); continue; }
        if (!onP.has(ev.playerOut.id) || onP.has(ev.playerIn.id)) valid = false;
        onP.delete(ev.playerOut.id);
        onP.add(ev.playerIn.id);
      }
      const tail = Math.max(0, endAbs - last);
      onP.forEach(id => totals.set(id, (totals.get(id) || 0) + tail));
      const projected = new Map<string, number>();
      for (const p of outfieldPlayers) {
        projected.set(p.id, (totals.get(p.id) || 0) + standardGkDuty(p.id));
      }
      return { projected, valid };
    };
    const STANDARD_REMOVAL_TOLERANCE = 5;
    for (let pass = 0; pass < 6; pass++) {
      const sim = standardSimulate(plan);
      if (!sim.valid) break;
      const values = [...sim.projected.values()];
      if (values.length < 2) break;
      const baseMin = Math.min(...values);
      const baseSpread = Math.max(...values) - baseMin;

      let bestRemoval: { index: number; min: number; spread: number } | null = null;
      for (let i = 0; i < plan.length; i++) {
        if (isHtGkSwap(plan[i])) continue;
        const trialPlan = plan.filter((_, j) => j !== i);
        const trial = standardSimulate(trialPlan);
        if (!trial.valid) continue;
        const tv = [...trial.projected.values()];
        const trialMin = Math.min(...tv);
        const trialSpread = Math.max(...tv) - trialMin;
        if (trialMin > baseMin + STANDARD_REMOVAL_TOLERANCE && trialSpread <= baseSpread) {
          if (
            !bestRemoval ||
            trialMin > bestRemoval.min ||
            (trialMin === bestRemoval.min && trialSpread < bestRemoval.spread)
          ) {
            bestRemoval = { index: i, min: trialMin, spread: trialSpread };
          }
        }
      }
      if (!bestRemoval) break;
      plan.splice(bestRemoval.index, 1);
    }

    const sortedStandard = plan.sort((a, b) =>
      (a.half === 1 ? a.time : halfDurationSeconds + a.time) -
      (b.half === 1 ? b.time : halfDurationSeconds + b.time)
    );
    {
      const eqPlan = buildEqualTimeOverride({
        playerData, teamSize, halfDurationSeconds,
        gkOnPitch, halftimeGkIn, rotateGkAtHalftime, maxSpreadMinutes,
        rotationSpeed, eff,
        priorityOrderLength: priorityOrder.length,
        startHalf, startElapsedSeconds: clampedStartElapsed,
        benchCount: outfieldOnBench.length,
        currentPlan: sortedStandard,
      });
      if (eqPlan) {
        sortedStandard.length = 0;
        sortedStandard.push(...eqPlan);
      }
    }

    return ensureNoStarvedPlayers(sortedStandard, playerData, halfDurationSeconds);
  }
