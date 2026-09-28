// Auto-sub "BALANCED / FREQUENT" fairness-driven planner, extracted from
// `createSubPlanInternal` in scheduler.ts. Handles rotationSpeed >= 2:
// equal-playing-time optimisation across the remaining game, priority-bias
// aware pull-off/bring-on ordering, spread-based equal-time overrides, and
// starved-player smoothing. No React dependency.
import { PitchPosition } from "../PositionBadge";
import { buildSubWindows } from "./windows";
import { ensureNoStarvedPlayers } from "./standardMode";
import { buildEqualTimeOverride } from "./equalTimeOverride";
import type { Player, SubstitutionEvent } from "./scheduler";

export interface FairnessModeContext {
  playerData: Player[];
  teamSize: number;
  halfDurationSeconds: number;
  rotationSpeed: number;
  disableBatchSubs: boolean;
  disablePositionSwaps: boolean;
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
  gkOnPitch: Player | undefined;
  halftimeGkIn: Player | null;
  startingGkWillRotate: boolean;
  includeStartingGkInRotation: boolean;
  playersOnPitch: Player[];
  outfieldPlayers: Player[];
  outfieldOnPitch: Player[];
  outfieldOnBench: Player[];
  totalOutfieldPlayers: number;
  totalRemainingSeconds: number;
  fieldPositions: number;
}

export function buildFairnessModePlan(ctx: FairnessModeContext): SubstitutionEvent[] {
  const {
    playerData, teamSize, halfDurationSeconds, rotationSpeed,
    disableBatchSubs, disablePositionSwaps, rotateGkAtHalftime, startHalf,
    clampedStartElapsed, startElapsedSeconds, maxSpreadMinutes, eff,
    priorityOrder, priorityTargetBiasSeconds,
    gkOnPitch, halftimeGkIn, startingGkWillRotate, includeStartingGkInRotation,
    playersOnPitch, outfieldPlayers, outfieldOnPitch, outfieldOnBench,
    totalOutfieldPlayers, totalRemainingSeconds, fieldPositions,
  } = ctx;
  const plan: SubstitutionEvent[] = [];


  // CORE PRINCIPLE: Equal playing time for ALL outfield players over remaining game
  // Use remaining time for calculations
  const totalFieldSeconds = totalRemainingSeconds * fieldPositions;

  // Determine how many players to sub at once based on rotation speed and bench size
  // Key principle: batch as many subs together as possible to reduce interruptions
  // With a large bench, we want to swap multiple players simultaneously
  let subsAtOnce = 1;
  if (!disableBatchSubs && outfieldOnBench.length >= 2) {
    const hasLargeBench = outfieldOnBench.length >= 4;
    switch (rotationSpeed) {
      case 1: subsAtOnce = 1; break;
      case 2: subsAtOnce = Math.min(2, outfieldOnBench.length); break;
      case 3: subsAtOnce = Math.min(hasLargeBench ? 3 : 2, outfieldOnBench.length); break;
      default: subsAtOnce = 1;
    }
  }

  const gkDutySeconds = (id: string) => {
    let duty = 0;
    if (startingGkWillRotate && id === gkOnPitch?.id) {
      duty += Math.max(0, halfDurationSeconds - startElapsedSeconds);
    }
    if (halftimeGkIn && id === halftimeGkIn.id) {
      duty += halfDurationSeconds;
    }
    return duty;
  };
  const canUseInOutfield = (player: Player, position?: PitchPosition) => {
    if (!position || position === "GK" || player.isInjured) return false;
    // A nominated half-game GK still needs fair total minutes, so allow them
    // to cover an outfield slot outside their goalkeeping half.
    if (player.id === gkOnPitch?.id || player.id === halftimeGkIn?.id) return true;
    if (player.assignedPositions?.length === 1 && player.assignedPositions.includes("GK")) return true;
    return !player.assignedPositions?.length || player.assignedPositions.includes(position);
  };

  const playerById = new Map(playerData.map(p => [p.id, p]));
  const fieldSlots = outfieldOnPitch.map(p => ({
    position: p.currentPitchPosition as PitchPosition,
    playerId: p.id,
  }));

  const currentFieldSeconds = new Map<string, number>();
  outfieldPlayers.forEach(p => currentFieldSeconds.set(p.id, p.minutesPlayed || 0));

  const totalExistingSeconds = playerData.reduce((sum, p) => sum + (p.minutesPlayed || 0), 0);
  const sharedTotalTarget = playerData.length > 0
    ? (totalExistingSeconds + totalRemainingSeconds * teamSize) / playerData.length
    : 0;
    const rawFieldTargets = new Map<string, number>();
  outfieldPlayers.forEach(p => {
    // FAIRNESS: every player aims for the SAME total minutes (field + GK duty).
    // GKs already have GK time banked, so their outfield target is the shared
    // total minus their GK duty. They naturally play LESS outfield, not more —
    // landing them at equal total minutes alongside everyone else.
      const base = Math.max(0, sharedTotalTarget + priorityTargetBiasSeconds(p.id) - (p.minutesPlayed || 0) - gkDutySeconds(p.id));
    rawFieldTargets.set(p.id, base);
  });
  const rawTargetTotal = Array.from(rawFieldTargets.values()).reduce((sum, value) => sum + value, 0);
  const fieldTargetScale = rawTargetTotal > 0 ? totalFieldSeconds / rawTargetTotal : 1;
  const targetFieldSeconds = (id: string) => (rawFieldTargets.get(id) || 0) * fieldTargetScale;

  const toPlanTime = (absoluteSeconds: number): { half: 1 | 2; time: number } => ({
    half: absoluteSeconds < halfDurationSeconds ? 1 : 2,
    time: absoluteSeconds < halfDurationSeconds ? absoluteSeconds : absoluteSeconds - halfDurationSeconds,
  });

  const startAbsoluteSeconds = startHalf === 1 ? clampedStartElapsed : halfDurationSeconds + clampedStartElapsed;
  const endAbsoluteSeconds = halfDurationSeconds * 2;
  // Cap subs per window, but do NOT under-schedule windows in minimal mode.
  // Minimal means fewer players swapped at once; it must still create enough
  // rotation points for every rotatable player to share bench time fairly.
  const benchSize = Math.max(1, outfieldOnBench.length);
  const maxSubEventsPerWindow = Math.max(
    1,
    Math.min(disableBatchSubs ? 1 : subsAtOnce, benchSize, fieldSlots.length)
  );
  // Rotation continuity: with multiple bench players, someone who has just been
  // brought on should not be the player removed at the very next rotation.
  // They re-enter the normal off-order after one further window has passed.
  let previousRotationPlayerInIds = new Set<string>();

  // QUEUE TRACKING (queue-first rotation with fairness override)
  // ------------------------------------------------------------
  // Players go on/off in FIFO order: oldest-waiting bench player goes on,
  // longest-on-pitch player goes off. Fairness only overrides queue order
  // when the projected end-of-game gap exceeds FAIRNESS_TOLERANCE_SECONDS.
  // A MIN_SHIFT_SECONDS guarantees no player is pulled too soon after coming on.
  const FAIRNESS_TOLERANCE_SECONDS = 60;
  const MIN_SHIFT_SECONDS = eff.minShiftSeconds;
  // Position weight for ordering starters into the off-queue:
  // GK never rotates off via queue; defenders go first, then mids, then forwards.
  const positionRotationOrder = (pos: PitchPosition | undefined): number => {
    switch (pos) {
      case "GK": return 99;
      case "DEF": return 0;
      case "MID": return 1;
      case "FWD": return 2;
      default: return 3;
    }
  };
  // lastOnAt = absolute seconds when the player most recently entered the pitch.
  // Starters are seeded with offsets based on position so DEF rotate first.
  // Lower lastOnAt = been on longer = next off.
  const lastOnAt = new Map<string, number>();
  outfieldOnPitch.forEach(p => {
    const offset = positionRotationOrder(p.currentPitchPosition as PitchPosition);
    // Sub-second offsets keep starters ordered by position without affecting
    // shift-length math (which works in whole seconds).
    lastOnAt.set(p.id, startAbsoluteSeconds - 1000 + offset);
  });
  // lastOffAt = absolute seconds when the player most recently came off the pitch.
  // Bench players at start are all "waiting" since startAbsoluteSeconds.
  // Lower lastOffAt = been waiting longer = next on.
  const lastOffAt = new Map<string, number>();
  outfieldOnBench.forEach((p, idx) => {
    // Slight stagger by bench order so the first bench player goes on first.
    lastOffAt.set(p.id, startAbsoluteSeconds - 1000 + idx);
  });

  // FAIRNESS-DRIVEN WINDOW COUNT
  // ----------------------------
  // For perfectly equal minutes, each player spends T·B/N seconds on the bench
  // (T = remaining time, B = bench size, N = total rotatable players). One full
  // "cycle" rotates every player off exactly once and requires N sub-events.
  // With `subsAtOnce` swaps per window, a full cycle = N / subsAtOnce windows.
  //
  // Speed controls how many cycles we run (more cycles = shorter shifts, more
  // disruption, but identical fairness ceiling). All speeds aim for at least
  // ONE full cycle so every bench player gets equal time off.
  const baseCycleEvents = totalOutfieldPlayers; // one off-event per player
  // Cycles per speed: minimal=1 (longest shifts), balanced=1, fast=2 (shorter shifts)
  // Both minimal and balanced run a single full fairness cycle — they differ in
  // batch size (subsAtOnce), not in window count. Fast doubles rotations.
  let cycleMultiplier = rotationSpeed === 3 ? 2 : 1;
  // SPREAD CAP ESCALATION: when the user has set a tight max-spread, a single
  // cycle may not give bench players enough on-pitch time to converge. The
  // dominant residual spread comes from players "locked out" of part of the
  // game (e.g. half-game GKs) who need a precise number of outfield turns to
  // hit their share. Estimate that residual and add cycles until it fits.
  const maxGkLockoutSeconds = Math.max(
    0,
    ...outfieldPlayers.map(p => gkDutySeconds(p.id))
  );
  // Residual spread ≈ outfield need a locked-out player misses if we run too
  // few cycles. A locked-out player needs ~`shareOutfield` minutes; a single
  // cycle gives them at most one turn (~window length).
  const targetSpreadSeconds = Math.max(60, maxSpreadMinutes * 60);
  const estimatedResidualSpread = maxGkLockoutSeconds > 0
    ? Math.min(maxGkLockoutSeconds, halfDurationSeconds * 0.4)
    : 0;
  if (estimatedResidualSpread > targetSpreadSeconds) {
    // LIGHT FREQUENT: cap escalation tighter so we don't pile on extra cycles.
    // Frequent (speed=2) tops out at +1 cycle; Fast (speed=3) keeps the higher
    // ceiling for tight-spread scenarios.
    const escalationCeiling = rotationSpeed === 3 ? 6 : 2;
    const escalationBoost = rotationSpeed === 3 ? 2 : 0;
    cycleMultiplier = Math.min(
      escalationCeiling,
      Math.max(cycleMultiplier, Math.ceil(estimatedResidualSpread / targetSpreadSeconds) + escalationBoost)
    );
  }
  // Pick the smallest window count whose total off-events (W * subsAtOnce) is
  // a multiple of N players — this is the ONLY way to get exactly equal time.
  const desiredOffEvents = baseCycleEvents * cycleMultiplier;
  let targetWindowsTotal = Math.max(1, Math.ceil(desiredOffEvents / maxSubEventsPerWindow));
  // Snap upward until W * subsAtOnce is divisible by N (fairness divisibility).
  while ((targetWindowsTotal * maxSubEventsPerWindow) % totalOutfieldPlayers !== 0) {
    targetWindowsTotal++;
    // Safety: never exceed 2x the desired count
    if (targetWindowsTotal > Math.ceil(desiredOffEvents / maxSubEventsPerWindow) * 2 + totalOutfieldPlayers) break;
  }
  // Floor interval prevents churn but never overrides fairness windows. We
  // recompute as evenly-spaced windows across remaining time.
  // LIGHT FREQUENT: raise the floor for speed=2 from 120s to 180s so shifts
  // are noticeably longer than current Frequent (~3 min vs ~2 min) while
  // still rotating much more often than Standard (~5 min).
  const intervalFromWindows = totalRemainingSeconds / (targetWindowsTotal + 1);
  const minIntervalFloor = rotationSpeed === 3
    ? 90
    : Math.min(eff.frequentIntervalFloor, Math.max(60, Math.floor(intervalFromWindows)));
  const halftimeGuardWindow = eff.halftimeGuardSeconds ?? minIntervalFloor;
  const maxIntervalSeconds = Math.max(minIntervalFloor, Math.floor(intervalFromWindows));
  const directEventTimes = new Set<number>();

  // SHIFT-FLOOR GUARD: if a halftime GK swap is going to happen, don't place
  // any interval-driven sub window within `minIntervalFloor` seconds of HT —
  // otherwise a player can come on at window N and be forced off at HT, producing
  // a sub-1-min "shift" that's impossible for the optimizer to remove because
  // the HT event is fixed.
  const halftimeGuardActive = !!(
    startAbsoluteSeconds < halfDurationSeconds && rotateGkAtHalftime && gkOnPitch && halftimeGkIn
  );

  // Unified window builder — same helper Standard uses, just with Frequent's
  // numbers. Frequent has no settling-in window and a 45 s edge buffer.
  const sortedDirectEventTimes = buildSubWindows({
    startAbs: startAbsoluteSeconds,
    endAbs: endAbsoluteSeconds,
    halfDurationSeconds,
    targetIntervalSec: maxIntervalSeconds,
    intervalFloorSec: maxIntervalSeconds,
    noSubBeforeSec: 0,
    noSubAfterSec: 45,
    halftimeGuardSec: halftimeGuardWindow,
    halftimeGuardActive,
    edgeBufferSec: 45,
    includeHalftimeWhenGuardActive: true,
  });


  const isAvailableForInterval = (player: Player, intervalStart: number, intervalEnd: number) => {
    if (player.isInjured) return false;
    if (includeStartingGkInRotation && player.id === gkOnPitch?.id && intervalStart < halfDurationSeconds) return false;
    if (halftimeGkIn && player.id === halftimeGkIn.id && intervalEnd > halfDurationSeconds) return false;
    return true;
  };

  const remainingAvailabilitySeconds = (player: Player, intervalStart: number) => {
    const start = Math.max(intervalStart, startAbsoluteSeconds);
    if (includeStartingGkInRotation && player.id === gkOnPitch?.id) {
      return Math.max(1, endAbsoluteSeconds - Math.max(start, halfDurationSeconds));
    }
    if (halftimeGkIn && player.id === halftimeGkIn.id) {
      return Math.max(1, halfDurationSeconds - Math.min(start, halfDurationSeconds));
    }
    return Math.max(1, endAbsoluteSeconds - start);
  };

  const addFieldTime = (elapsed: number) => {
    if (elapsed <= 0) return;
    fieldSlots.forEach(slot => {
      if (slot.playerId) {
        currentFieldSeconds.set(slot.playerId, (currentFieldSeconds.get(slot.playerId) || 0) + elapsed);
      }
    });
  };

  const choosePlayerForSlot = (
    position: PitchPosition,
    currentSlotPlayerId: string | null,
    usedIds: Set<string>,
    currentIds: Set<string>,
    intervalStart: number,
    intervalEnd: number
  ) => {
    const intervalLength = Math.max(0, intervalEnd - intervalStart);
    const candidates = outfieldPlayers.filter(player => {
      if (usedIds.has(player.id)) return false;
      if (!isAvailableForInterval(player, intervalStart, intervalEnd)) return false;
      if (!canUseInOutfield(player, position)) return false;
      // Avoid moving players between slots in the generated plan; only keep a
      // player in their current slot or bring someone on from the bench.
      if (currentIds.has(player.id) && player.id !== currentSlotPlayerId) return false;
      return true;
    });

    candidates.sort((a, b) => {
      const aNeed = targetFieldSeconds(a.id) - (currentFieldSeconds.get(a.id) || 0);
      const bNeed = targetFieldSeconds(b.id) - (currentFieldSeconds.get(b.id) || 0);
      const aUrgency = aNeed / remainingAvailabilitySeconds(a, intervalStart);
      const bUrgency = bNeed / remainingAvailabilitySeconds(b, intervalStart);
      // Pure fairness ordering — no GK bonus. With correct targets, GKs
      // already need less outfield time and will naturally end at equal totals.
      const aScore = aUrgency * 1000 + aNeed * 0.01 - intervalLength + (a.id === currentSlotPlayerId ? 20 : 0);
      const bScore = bUrgency * 1000 + bNeed * 0.01 - intervalLength + (b.id === currentSlotPlayerId ? 20 : 0);
      return bScore - aScore;
    });

    return candidates[0] || null;
  };

  const applyFairRotationAt = (absoluteSeconds: number, nextAbsoluteSeconds: number, reservedSubEvents = 0) => {
    const maxChanges = Math.max(0, maxSubEventsPerWindow - reservedSubEvents);
    if (maxChanges === 0) {
      previousRotationPlayerInIds = new Set<string>();
      return;
    }

    const currentIds = new Set(fieldSlots.map(slot => slot.playerId).filter(Boolean) as string[]);

    // FAIRNESS-DRIVEN SELECTION (with queue tiebreakers + bounce-back guard)
    // -----------------------------------------------------------------------
    // 1. Bench order: by current playing time ASC (least-played first).
    //    Tiebreaker: lastOffAt ASC (longest waiting first).
    // 2. Pitch order: by current playing time DESC (most-played first).
    //    Tiebreaker: lastOnAt ASC (longest on first).
    // 3. MIN_SHIFT_SECONDS prevents pulling someone who just came on.
    // 4. Strict anti-bounce-back: never pull a player who entered in the
    //    immediately previous window.
    // 5. Only commit a swap if it actually reduces the gap between the two
    //    players' projected end-of-game minutes (avoids churn).
    const projectedFinalSeconds = (id: string) => {
      // If they stay in their current state for the rest of the game.
      const onPitchNow = currentIds.has(id);
      const remaining = endAbsoluteSeconds - absoluteSeconds;
      const accumulated = currentFieldSeconds.get(id) || 0;
      return accumulated + (onPitchNow ? remaining : 0);
    };

    // Each player's TOTAL minutes target = field + GK duty already received.
    // Sorting by deficit-against-target (rather than raw field minutes) means
    // GKs — who have minutes banked from goalkeeping — naturally rank lower in
    // the bench queue, ensuring everyone finishes at equal TOTAL minutes.
    const totalTarget = (id: string) => {
      const p = playerById.get(id);
      const baseMinutes = p?.minutesPlayed || 0;
      return Math.max(0, sharedTotalTarget - baseMinutes - gkDutySeconds(id));
    };
    const deficit = (id: string) => totalTarget(id) - (currentFieldSeconds.get(id) || 0);
    // Urgency = deficit / time remaining where the player is still available.
    // This makes a player with limited availability (e.g. 2H-GK only available
    // in H1 for outfield duty) escalate their priority as their window closes.
    const urgency = (p: Player) => {
      const remain = remainingAvailabilitySeconds(p, absoluteSeconds);
      return deficit(p.id) / Math.max(1, remain);
    };

    // QUEUE-FIRST with hard max-spread cap.
    // -----------------------------------------------------------------------
    // The cap is enforced on PROJECTED final minutes (= field minutes already
    // banked + minutes still to be played if we leave the player in their
    // current state). When the projected spread between the most-played and
    // least-played available players would exceed the user cap, we override
    // queue order and force the worst offenders to swap. Otherwise we keep
    // pure FIFO queue ordering for predictability.
    const maxSpreadSeconds = Math.max(60, maxSpreadMinutes * 60);
    // Escalation kicks in earlier than the hard cap so we have time to correct
    // before we'd actually breach it.
    // Use 40% of the cap so corrections start well before the breach.
    const escalationThreshold = Math.max(30, maxSpreadSeconds * 0.4);

    // Each player has a TARGET total (field + GK duty already received) equal
    // to the average across the squad. The "shortfall" we want to close is
    // (target − projected total). When the spread between shortfalls breaches
    // the cap, override queue order to prioritise the most-shortfall players.
    const totalProjected = (id: string) => {
      const p = playerById.get(id);
      const baseMinutes = (p?.minutesPlayed || 0);
      return baseMinutes + gkDutySeconds(id) + projectedFinalSeconds(id);
    };
    // GK PROTECTION (Frequent mode): players assigned as GK in either half
    // should finish at the TOP of the allowed spread band — not the floor.
    // We lift their total target by the spread cap so the fairness scheduler
    // treats them as still "owed" minutes until they reach gkCeilingSec.
    const spreadHalfSec = Math.max(0, maxSpreadMinutes * 60) / 2;
    const gkCeilingTotal = sharedTotalTarget + spreadHalfSec;
    const playerTotalTarget = (id: string) => {
      const p = playerById.get(id);
      const baseMinutes = (p?.minutesPlayed || 0);
      const isProtected =
        (includeStartingGkInRotation && id === gkOnPitch?.id) ||
        (halftimeGkIn ? id === halftimeGkIn.id : false);
      const target = (isProtected ? gkCeilingTotal : sharedTotalTarget) + priorityTargetBiasSeconds(id);
      return Math.max(baseMinutes + gkDutySeconds(id), target);
    };
    const shortfall = (id: string) => playerTotalTarget(id) - totalProjected(id);

    // Snapshot now so we can detect cap breaches.
    const projectionsNow = new Map<string, number>();
    const shortfallsNow = new Map<string, number>();
    outfieldPlayers.forEach(p => {
      projectionsNow.set(p.id, totalProjected(p.id));
      shortfallsNow.set(p.id, shortfall(p.id));
    });
    const shortfallVals = Array.from(shortfallsNow.values());
    const shortfallSpread = Math.max(...shortfallVals) - Math.min(...shortfallVals);
    const capBreached = shortfallSpread > escalationThreshold;

    const isGkProtectedFreq = (id: string) =>
      (includeStartingGkInRotation && id === gkOnPitch?.id) ||
      (halftimeGkIn ? id === halftimeGkIn.id : false);

    const benchQueue = outfieldPlayers
      .filter(p => !currentIds.has(p.id))
      .filter(p => isAvailableForInterval(p, absoluteSeconds, nextAbsoluteSeconds))
      .sort((a, b) => {
        // PHASE 5: shortfall is always the primary criterion. The bench
        // player furthest below their fair-share total comes on first. FIFO
        // (longest-waiting) only acts as a tiebreaker inside a small
        // deadband to keep the queue stable when shortfalls are essentially
        // equal. The previous capBreached gate is retained as a stronger
        // override for clearly-breaching situations.
        const aS = shortfallsNow.get(a.id) ?? 0;
        const bS = shortfallsNow.get(b.id) ?? 0;
        const deadband = capBreached ? 15 : 30;
        if (Math.abs(aS - bS) > deadband) return bS - aS;
        // GK protection: bring protected players on first when both still owe minutes.
        const aGk = isGkProtectedFreq(a.id) ? 1 : 0;
        const bGk = isGkProtectedFreq(b.id) ? 1 : 0;
        if (aGk !== bGk) {
          const aProj = projectionsNow.get(a.id) ?? 0;
          const bProj = projectionsNow.get(b.id) ?? 0;
          if (aGk && aProj < gkCeilingTotal - 30) return -1;
          if (bGk && bProj < gkCeilingTotal - 30) return 1;
        }
        // Tiebreaker: pure FIFO — longest-waiting bench player first.
        return (lastOffAt.get(a.id) ?? 0) - (lastOffAt.get(b.id) ?? 0);
      });

    const pitchSlotsWithMeta = fieldSlots
      .map((slot, index) => ({ slot, index, playerOut: slot.playerId ? playerById.get(slot.playerId) : undefined }))
      .filter(({ playerOut }) => !!playerOut);

    const usedSlotIndexes = new Set<number>();
    const usedInIds = new Set<string>();
    const selectedSubs: { slotIndex: number; playerOut: Player; playerIn: Player }[] = [];

    for (let bi = 0; bi < benchQueue.length && selectedSubs.length < maxChanges; bi++) {
      const playerIn = benchQueue[bi];
      if (usedInIds.has(playerIn.id)) continue;

      // Pitch candidates compatible with this incoming player.
      // When cap is breached: pull the highest projected total first.
      // Otherwise: queue order (longest currently-on-pitch first).
      const eligibleSlots = pitchSlotsWithMeta
        .filter(({ slot, index, playerOut }) =>
          !usedSlotIndexes.has(index) &&
          !!playerOut &&
          canUseInOutfield(playerIn, slot.position) &&
          absoluteSeconds - (lastOnAt.get(playerOut!.id) ?? 0) >= MIN_SHIFT_SECONDS &&
          !previousRotationPlayerInIds.has(playerOut!.id)
        )
        .sort((a, b) => {
          // PHASE 5: shortfall-gradient pull-off. Player with the SMALLEST
          // shortfall (most over their fair share) comes off first. FIFO
          // (longest currently-on-pitch) only tiebreaks inside the deadband.
          const aS = shortfallsNow.get(a.playerOut!.id) ?? 0;
          const bS = shortfallsNow.get(b.playerOut!.id) ?? 0;
          const deadband = capBreached ? 15 : 30;
          if (Math.abs(aS - bS) > deadband) return aS - bS;
          // GK protection: never pull a protected player off until they reach
          // gkCeilingTotal — pull non-protected players first.
          const aGk = isGkProtectedFreq(a.playerOut!.id) ? 1 : 0;
          const bGk = isGkProtectedFreq(b.playerOut!.id) ? 1 : 0;
          if (aGk !== bGk) {
            const aProj = projectionsNow.get(a.playerOut!.id) ?? 0;
            const bProj = projectionsNow.get(b.playerOut!.id) ?? 0;
            if (aGk && aProj < gkCeilingTotal - 30) return 1;
            if (bGk && bProj < gkCeilingTotal - 30) return -1;
          }
          // Tiebreaker: queue order — longest currently-on-pitch first.
          return (lastOnAt.get(a.playerOut!.id) ?? 0) - (lastOnAt.get(b.playerOut!.id) ?? 0);
        });

      if (eligibleSlots.length === 0) continue;

      let chosenSlot = eligibleSlots[0];
      let playerOut = chosenSlot.playerOut!;

      // GK PROTECTION (Frequent): if the chosen slot is a GK-protected player
      // who hasn't reached the spread ceiling yet, prefer a non-GK slot if any
      // is available. Falls through to the GK swap only if no alternative.
      const bankedTotal = (id: string) => {
        const p = playerById.get(id);
        return (p?.minutesPlayed || 0) + gkDutySeconds(id) + (currentFieldSeconds.get(id) || 0);
      };
      const inIsProtected = isGkProtectedFreq(playerIn.id);
      if (
        isGkProtectedFreq(playerOut.id) &&
        bankedTotal(playerOut.id) < gkCeilingTotal - 30 &&
        !inIsProtected
      ) {
        const altSlot = eligibleSlots.find(s =>
          s !== chosenSlot && !isGkProtectedFreq(s.playerOut!.id),
        );
        if (altSlot) {
          chosenSlot = altSlot;
          playerOut = altSlot.playerOut!;
        }
      }

      // Only commit if the swap actually narrows the shortfall gap between
      // these two players. (Avoids churn when shortfalls are already balanced.)
      const inShortfall = shortfallsNow.get(playerIn.id) ?? 0;
      const outShortfall = shortfallsNow.get(playerOut.id) ?? 0;
      const gapBefore = inShortfall - outShortfall;
      if (gapBefore < 30 && !capBreached) {
        continue;
      }
      // Hard refusal: never make the spread worse (incoming player already above target).
      if (gapBefore < 0) continue;

      usedSlotIndexes.add(chosenSlot.index);
      usedInIds.add(playerIn.id);
      selectedSubs.push({ slotIndex: chosenSlot.index, playerOut, playerIn });
    }

    selectedSubs.forEach(({ slotIndex, playerOut, playerIn }) => {
      const { half, time } = toPlanTime(absoluteSeconds);
      plan.push({
        time,
        half,
        playerOut,
        playerIn,
        executed: false,
      });

      fieldSlots[slotIndex].playerId = playerIn.id;
      // Update queue trackers: outgoing player joins bench wait queue,
      // incoming player starts a fresh on-pitch shift.
      lastOffAt.set(playerOut.id, absoluteSeconds);
      lastOnAt.set(playerIn.id, absoluteSeconds);
    });

    previousRotationPlayerInIds = new Set(selectedSubs.map(sub => sub.playerIn.id));
  };

  let directLastTime = startAbsoluteSeconds;
  for (let i = 0; i < sortedDirectEventTimes.length; i++) {
    const eventTime = sortedDirectEventTimes[i];
    addFieldTime(eventTime - directLastTime);
    directLastTime = eventTime;

    let reservedSubEvents = 0;
    if (eventTime === halfDurationSeconds && rotateGkAtHalftime && gkOnPitch && halftimeGkIn) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch,
        playerIn: halftimeGkIn,
        executed: false,
      });
      reservedSubEvents = 1;
      fieldSlots.forEach(slot => {
        if (slot.playerId === halftimeGkIn.id) slot.playerId = null;
      });
      // Queue updates for the GK swap: starting GK becomes available for the
      // outfield bench queue (H2 onward), halftime GK is now on pitch as GK.
      lastOffAt.set(gkOnPitch.id, eventTime);
      lastOnAt.set(halftimeGkIn.id, eventTime);
    }

    const nextTime = sortedDirectEventTimes[i + 1] ?? endAbsoluteSeconds;
    applyFairRotationAt(eventTime, nextTime, reservedSubEvents);
  }
  addFieldTime(endAbsoluteSeconds - directLastTime);

  const getPlanAbsoluteSeconds = (sub: SubstitutionEvent) =>
    sub.half === 1 ? sub.time : halfDurationSeconds + sub.time;
  const isDirectHalftimeGkSwapSub = (sub: SubstitutionEvent) =>
    !!gkOnPitch && sub.half === 2 && sub.time === 0 && sub.playerOut.id === gkOnPitch.id;
  const fairPlayerIds = playerData.filter(p => !p.isInjured).map(p => p.id);

  const simulateFullPlan = (candidatePlan: SubstitutionEvent[]) => {
    const totals = new Map<string, number>();
    playerData.forEach(p => totals.set(p.id, p.minutesPlayed || 0));

    const onPitch = new Map<string, PitchPosition>();
    playersOnPitch.forEach(p => {
      if (p.currentPitchPosition) onPitch.set(p.id, p.currentPitchPosition);
    });

    // Track when each player most recently came onto the pitch (in absolute seconds).
    // Starters are seeded at startAbsoluteSeconds. Used to penalise short shifts
    // (a player taken off less than MIN_SHIFT_SECONDS_PENALTY after coming on).
    const cameOnAt = new Map<string, number>();
    playersOnPitch.forEach(p => cameOnAt.set(p.id, startAbsoluteSeconds));
    const MIN_SHIFT_SECONDS_PENALTY = eff.minShiftSeconds;

    const ordered = candidatePlan
      .map((sub, index) => ({ sub, index, absoluteSeconds: getPlanAbsoluteSeconds(sub) }))
      .sort((a, b) => a.absoluteSeconds - b.absoluteSeconds);
    const snapshots: { index: number; before: Map<string, PitchPosition>; absoluteSeconds: number; nextAbsoluteSeconds: number }[] = [];
    let last = startAbsoluteSeconds;
    let valid = true;
    let bounceBackCount = 0;
    let shortShiftCount = 0;
    let currentWindowTime: number | null = null;
    let previousWindowPlayerIns = new Set<string>();
    let currentWindowPlayerIns = new Set<string>();

    ordered.forEach((entry, orderIndex) => {
      const elapsed = entry.absoluteSeconds - last;
      if (elapsed < 0) valid = false;
      if (elapsed > 0) {
        onPitch.forEach((_, id) => totals.set(id, (totals.get(id) || 0) + elapsed));
      }

      if (currentWindowTime !== entry.absoluteSeconds) {
        previousWindowPlayerIns = currentWindowPlayerIns;
        currentWindowPlayerIns = new Set<string>();
        currentWindowTime = entry.absoluteSeconds;
      }

      if (benchSize > 1 && previousWindowPlayerIns.has(entry.sub.playerOut.id) && !isDirectHalftimeGkSwapSub(entry.sub)) {
        bounceBackCount++;
      }

      // Short-shift penalty: catches bounce-backs across more than one window.
      if (benchSize > 1 && !isDirectHalftimeGkSwapSub(entry.sub)) {
        const onSince = cameOnAt.get(entry.sub.playerOut.id);
        if (onSince !== undefined && entry.absoluteSeconds - onSince < MIN_SHIFT_SECONDS_PENALTY) {
          shortShiftCount++;
        }
      }

      snapshots.push({
        index: entry.index,
        before: new Map(onPitch),
        absoluteSeconds: entry.absoluteSeconds,
        nextAbsoluteSeconds: ordered[orderIndex + 1]?.absoluteSeconds ?? endAbsoluteSeconds,
      });

      const outPosition = onPitch.get(entry.sub.playerOut.id);
      if (!outPosition || onPitch.has(entry.sub.playerIn.id)) valid = false;

      onPitch.delete(entry.sub.playerOut.id);
      cameOnAt.delete(entry.sub.playerOut.id);
      if (entry.sub.positionSwap) {
        const swapFromPosition = onPitch.get(entry.sub.positionSwap.player.id);
        if (!swapFromPosition) valid = false;
        if (swapFromPosition) onPitch.set(entry.sub.playerIn.id, swapFromPosition);
        onPitch.set(entry.sub.positionSwap.player.id, outPosition || entry.sub.positionSwap.toPosition);
      } else if (outPosition) {
        onPitch.set(entry.sub.playerIn.id, outPosition);
      }
      cameOnAt.set(entry.sub.playerIn.id, entry.absoluteSeconds);

      currentWindowPlayerIns.add(entry.sub.playerIn.id);

      last = entry.absoluteSeconds;
    });

    const remaining = endAbsoluteSeconds - last;
    if (remaining > 0) {
      onPitch.forEach((_, id) => totals.set(id, (totals.get(id) || 0) + remaining));
    }

    return { totals, snapshots, valid, bounceBackCount, shortShiftCount };
  };

  const fairnessObjective = (totals: Map<string, number>, bounceBackCount = 0, shortShiftCount = 0) => {
    const values = fairPlayerIds.map(id => totals.get(id) || 0);
    if (values.length < 2) return 0;
    const spread = Math.max(...values) - Math.min(...values);
    return spread * 1000 + bounceBackCount * 10_000_000 + shortShiftCount * 5_000_000;
  };

  // Iterative fairness optimizer. Each pass tries every legal single-sub
  // identity replacement at every snapshot and keeps the edit that most
  // reduces (spread × 1000 + GK shortfall). Runs until no improvement.
  const MAX_OPTIMIZER_ITERATIONS = 120;
  for (let iter = 0; iter < MAX_OPTIMIZER_ITERATIONS; iter++) {
    const currentSim = simulateFullPlan(plan);
    if (!currentSim.valid) break;
    const currentScore = fairnessObjective(currentSim.totals, currentSim.bounceBackCount, currentSim.shortShiftCount);
    if (currentScore === 0) break;
    let bestEdit: { index: number; replacement: SubstitutionEvent; score: number } | null = null;

    for (const snapshot of currentSim.snapshots) {
      const original = plan[snapshot.index];
      if (!original || isDirectHalftimeGkSwapSub(original)) continue;

      const incomingCandidates = playerData.filter(player =>
        !snapshot.before.has(player.id) &&
        isAvailableForInterval(player, snapshot.absoluteSeconds, snapshot.nextAbsoluteSeconds)
      );

      for (const [outId, outPosition] of snapshot.before.entries()) {
        if (outPosition === "GK") continue;
        const playerOut = playerById.get(outId);
        if (!playerOut) continue;

        for (const playerIn of incomingCandidates) {
          if (!canUseInOutfield(playerIn, outPosition)) continue;
          if (playerOut.id === original.playerOut.id && playerIn.id === original.playerIn.id && !original.positionSwap) continue;

          const replacement: SubstitutionEvent = {
            ...original,
            playerOut,
            playerIn,
            positionSwap: undefined,
          };

          plan[snapshot.index] = replacement;
          const trial = simulateFullPlan(plan);
          const score = trial.valid ? fairnessObjective(trial.totals, trial.bounceBackCount, trial.shortShiftCount) : Number.POSITIVE_INFINITY;
          plan[snapshot.index] = original;

          // Accept any strict improvement (no slack) so the optimizer can keep
          // tightening the spread until truly optimal.
          if (trial.valid && score < (bestEdit?.score ?? currentScore)) {
            bestEdit = { index: snapshot.index, replacement, score };
          }
        }
      }
    }

    if (!bestEdit || bestEdit.score >= currentScore) break;
    plan[bestEdit.index] = bestEdit.replacement;
  }

  plan.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    if (a.time !== b.time) return a.time - b.time;
    const aIsGkSwap = !!gkOnPitch && a.half === 2 && a.time === 0 && a.playerOut.id === gkOnPitch.id;
    const bIsGkSwap = !!gkOnPitch && b.half === 2 && b.time === 0 && b.playerOut.id === gkOnPitch.id;
    if (aIsGkSwap !== bIsGkSwap) return aIsGkSwap ? -1 : 1;
    return 0;
  });

  {
      const eqPlan = buildEqualTimeOverride({
        playerData, teamSize, halfDurationSeconds,
        gkOnPitch, halftimeGkIn, rotateGkAtHalftime, maxSpreadMinutes,
        rotationSpeed, eff,
        priorityOrderLength: priorityOrder.length,
        startHalf, startElapsedSeconds: clampedStartElapsed,
        benchCount: outfieldOnBench.length,
        currentPlan: plan,
      });
      if (eqPlan) {
        plan.length = 0;
        plan.push(...eqPlan);
      }
    }

  return ensureNoStarvedPlayers(plan, playerData, halfDurationSeconds);

}