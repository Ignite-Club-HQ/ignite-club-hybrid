// Auto-sub scheduling core: pure planning logic for `createSubPlan` and
// `createMiniLeagueSubPlan`, extracted from AutoSubPlanDialog.tsx so the
// dialog file only contains presentation/controller code. No React
// dependency — this module is deterministic, side-effect-free planning
// logic covered by the fairness matrix, mode-contract, and orchestration
// simulation test suites.
import { PitchPosition } from "../PositionBadge";
import {
  inferredOutfieldPosition,
  inferredPitchPosition,
  normalizeRotationSpeed,
  calculateTimeForecasts,
} from "./analysis";
import { buildSubWindows } from "./windows";
import { ensureNoStarvedPlayers } from "./standardMode";
import { isPlanPlayableFromPlayers } from "./validation";
import { type AutoSubAdvancedOverrides } from "./advancedOverrides";
import { buildPracticalModePlan } from "./practicalMode";
import { buildFairnessModePlan } from "./fairnessMode";
import {
  calculatePlanSpread,
  buildEqualTimeOverride,
  rebalanceablePlayers,
  type EqualTimeOverrideOptions,
} from "./equalTimeOverride";

export interface Player {
  id: string;
  name: string;
  number?: number;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isInjured?: boolean;
  teamSide?: "a" | "b";
}

export interface SubstitutionEvent {
  time: number;
  half: 1 | 2;
  playerOut: Player;
  playerIn: Player;
  positionSwap?: {
    player: Player;
    fromPosition: PitchPosition;
    toPosition: PitchPosition;
  };
  executed?: boolean;
  skipped?: boolean;
}

export interface MiniLeagueTeams {
  teamAPlayerIds: string[];
  teamBPlayerIds: string[];
  teamAColor?: string;
  teamBColor?: string;
  teamAName?: string;
  teamBName?: string;
}

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
};

/** Target gap between Standard-mode sub windows (seconds). 7 min sits in the
 *  spec'd 6–8 min window: low disruption, predictable cadence. Also used here
 *  as the ultra-thin-bench auto-tighten fallback (see `_autoTarget` below);
 *  the rest of Practical mode's tunables live in `./practicalMode`. */
const PRACTICAL_SUB_INTERVAL_SECONDS = 7 * 60;

// ===========================================================================
// STANDARD-MODE CALMNESS GUARANTEE
// ---------------------------------------------------------------------------
// Product rule: "Standard" must ALWAYS be the quieter plan. Because fairness
// post-passes can push Standard onto a busier cadence than Frequent on some
// squad shapes, the public `createSubPlan` wraps the planner: it builds the
// Frequent reference plan for the same inputs and, if Standard came out with
// the same or more substitutions, re-plans Standard on progressively calmer
// interval floors until it is strictly quieter. Recursion is guarded so the
// inner calls never re-enter this wrapper.
// ===========================================================================
let standardCalmnessReentryGuard = false;

/** Calmer interval floors (sec) tried in order when Standard is too busy. */
const STANDARD_CALMDOWN_FLOORS_SEC = [300, 360, 420, 480, 540, 600];

const substitutionAbsoluteTime = (
  substitution: Pick<SubstitutionEvent, "half" | "time">,
  halfDurationSeconds: number,
) => substitution.half === 1
  ? substitution.time
  : halfDurationSeconds + substitution.time;

/** Product cadence is measured in interruption moments, not player movements. */
function countSubstitutionWindows(
  plan: SubstitutionEvent[],
  halfDurationSeconds: number,
): number {
  return new Set(plan.map((substitution) =>
    substitutionAbsoluteTime(substitution, halfDurationSeconds))).size;
}

/**
 * Find the fairest playable way to combine one adjacent pair of substitution
 * windows. This lets Standard remain genuinely quieter without deleting a
 * player's turn or hiding extra churn inside the plan.
 */
function compactOneSubstitutionWindow(
  source: SubstitutionEvent[],
  players: Player[],
  halfDurationSeconds: number,
  rotateGkAtHalftime: boolean,
  maxSpreadSeconds: number,
): SubstitutionEvent[] | null {
  const sourceWindows = Array.from(new Set(source.map((substitution) =>
    substitutionAbsoluteTime(substitution, halfDurationSeconds)))).sort((a, b) => a - b);
  if (sourceWindows.length < 2) return null;

  let best: { plan: SubstitutionEvent[]; spread: number } | null = null;
  const sameWindowYoyoCount = (plan: SubstitutionEvent[]) => {
    const windows = new Map<number, { ins: Set<string>; outs: Set<string> }>();
    for (const substitution of plan) {
      const absolute = substitutionAbsoluteTime(substitution, halfDurationSeconds);
      const window = windows.get(absolute) ?? { ins: new Set<string>(), outs: new Set<string>() };
      window.ins.add(substitution.playerIn.id);
      window.outs.add(substitution.playerOut.id);
      windows.set(absolute, window);
    }
    let count = 0;
    windows.forEach((window) => window.ins.forEach((id) => {
      if (window.outs.has(id)) count += 1;
    }));
    return count;
  };
  const sourceYoyos = sameWindowYoyoCount(source);
  for (let index = 0; index < sourceWindows.length - 1; index += 1) {
    const left = sourceWindows[index];
    const right = sourceWindows[index + 1];
    // Never merge across the halftime boundary. Keep the halftime goalkeeper
    // handover as its own explicit, predictable operation.
    if ((left < halfDurationSeconds) !== (right < halfDurationSeconds)) continue;
    if (left === halfDurationSeconds || right === halfDurationSeconds) continue;

    const midpoint = Math.round(((left + right) / 2) / 30) * 30;
    for (const target of Array.from(new Set([left, midpoint, right]))) {
      const candidate = source.map((substitution) => {
        const absolute = substitutionAbsoluteTime(substitution, halfDurationSeconds);
        if (absolute !== left && absolute !== right) return substitution;
        return {
          ...substitution,
          half: (target < halfDurationSeconds ? 1 : 2) as 1 | 2,
          time: target < halfDurationSeconds ? target : target - halfDurationSeconds,
        };
      }).sort((a, b) =>
        substitutionAbsoluteTime(a, halfDurationSeconds) -
        substitutionAbsoluteTime(b, halfDurationSeconds));

      if (!isPlanPlayableFromPlayers(players, candidate, halfDurationSeconds)) continue;
      // Combining windows must not create an on/off instruction for the same
      // player at one whistle. Preserve any unavoidable existing halftime GK
      // handover, but never introduce additional yo-yos.
      if (sameWindowYoyoCount(candidate) > Math.max(1, sourceYoyos)) continue;
      const spread = calculatePlanSpread(
        players,
        candidate,
        halfDurationSeconds,
        rotateGkAtHalftime,
      );
      if (spread > maxSpreadSeconds) continue;
      if (!best || spread < best.spread) best = { plan: candidate, spread };
    }
  }
  return best?.plan ?? null;
}

export function createSubPlan(
  playerData: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  rotationSpeedInput: number = 1,
  disablePositionSwaps: boolean = false,
  disableBatchSubs: boolean = false,
  rotateGkAtHalftime: boolean = true,
  startElapsedSeconds: number = 0,
  startHalf: 1 | 2 = 1,
  preferredSecondHalfGkId?: string,
  maxSpreadMinutes: number = 5,
  advancedOverrides: AutoSubAdvancedOverrides = {}
): SubstitutionEvent[] {
  const run = (speed: number, overrides: AutoSubAdvancedOverrides) =>
    createSubPlanInternal(
      playerData,
      teamSize,
      halfDurationSeconds,
      speed,
      disablePositionSwaps,
      disableBatchSubs,
      rotateGkAtHalftime,
      startElapsedSeconds,
      startHalf,
      preferredSecondHalfGkId,
      maxSpreadMinutes,
      overrides,
    );

  const plan = run(rotationSpeedInput, advancedOverrides);
  const speed = normalizeRotationSpeed(rotationSpeedInput);
  // Only Standard (speed 1) carries the "always fewer subs" promise.
  if (speed !== 1 || standardCalmnessReentryGuard || plan.length === 0) return plan;

  standardCalmnessReentryGuard = true;
  try {
    const frequentReference = run(2, advancedOverrides);
    if (frequentReference.length === 0) {
      return plan;
    }

    const frequentWindows = countSubstitutionWindows(frequentReference, halfDurationSeconds);
    const capSeconds = Math.max(0, maxSpreadMinutes) * 60;
    const qualifying: SubstitutionEvent[][] = [];
    const consider = (candidate: SubstitutionEvent[] | null) => {
      if (!candidate) return;
      if (countSubstitutionWindows(candidate, halfDurationSeconds) >= frequentWindows) return;
      if (candidate.length > frequentReference.length) return;
      if (calculatePlanSpread(
        playerData,
        candidate,
        halfDurationSeconds,
        rotateGkAtHalftime,
      ) > capSeconds) return;
      qualifying.push(candidate);
    };

    consider(plan);
    consider(compactOneSubstitutionWindow(
      plan,
      playerData,
      halfDurationSeconds,
      rotateGkAtHalftime,
      capSeconds,
    ));
    // Frequent is the tightest fair allocation. Coalescing one of its windows
    // is a safe Standard candidate: same player movements, one less match
    // interruption, and accepted only if the selected spread remains intact.
    consider(compactOneSubstitutionWindow(
      frequentReference,
      playerData,
      halfDurationSeconds,
      rotateGkAtHalftime,
      capSeconds,
    ));

    let best = plan;
    for (const floorSec of STANDARD_CALMDOWN_FLOORS_SEC) {
      if (floorSec > halfDurationSeconds) break;
      const calmer = run(1, {
        ...advancedOverrides,
        standardIntervalFloorSec: floorSec,
        standardTargetIntervalSec: Math.max(
          floorSec,
          advancedOverrides.standardTargetIntervalSec ?? floorSec + 120,
        ),
      });
      if (calmer.length === 0) continue;
      if (calmer.length < best.length) best = calmer;
      consider(calmer);
      consider(compactOneSubstitutionWindow(
        calmer,
        playerData,
        halfDurationSeconds,
        rotateGkAtHalftime,
        capSeconds,
      ));
      // Preserve the legacy fallback boundary when no cap-preserving compact
      // candidate exists. Continuing to ever-higher floors can reduce raw
      // event count at the cost of a dramatically worse playing-time spread.
      if (best.length < frequentReference.length) break;
    }

    if (qualifying.length > 0) {
      return qualifying.sort((left, right) => {
        const spreadDelta = calculatePlanSpread(
          playerData, left, halfDurationSeconds, rotateGkAtHalftime,
        ) - calculatePlanSpread(
          playerData, right, halfDurationSeconds, rotateGkAtHalftime,
        );
        if (spreadDelta !== 0) return spreadDelta;
        return countSubstitutionWindows(left, halfDurationSeconds) -
          countSubstitutionWindows(right, halfDurationSeconds);
      })[0];
    }
    return best;
  } catch {
    return plan;
  } finally {
    standardCalmnessReentryGuard = false;
  }
}

function createSubPlanInternal(

  playerData: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  rotationSpeedInput: number = 1,
  disablePositionSwaps: boolean = false,
  disableBatchSubs: boolean = false,
  rotateGkAtHalftime: boolean = true,
  startElapsedSeconds: number = 0,
  startHalf: 1 | 2 = 1,
  preferredSecondHalfGkId?: string,
  maxSpreadMinutes: number = 5,
  advancedOverrides: AutoSubAdvancedOverrides = {}
): SubstitutionEvent[] {
  const rotationSpeed = normalizeRotationSpeed(rotationSpeedInput);
  // Resolve overrides → effective tunables (clamped to safe ranges)
  const ov = advancedOverrides || {};
  // Ultra-thin bench auto-tighten: when bench is ≤1 the standard floors
  // (4 min interval / 3 min shift) become the bottleneck and prevent
  // equal-time rotations. Drop them so e.g. a 5-player / 4-a-side / 40-min
  // squad can sub every 4 min and land each player on 32'/8'.
  const _benchCount = (playerData ?? []).filter(p => p.position === null).length;
  const _ultraThinBench = _benchCount > 0 && _benchCount <= 1;
  const _autoIntervalFloor = _ultraThinBench ? 180 : 240;       // 3 min vs 4 min
  const _autoFreqFloor     = _ultraThinBench ? 120 : 180;       // 2 min vs 3 min
  const _autoMinShift      = _ultraThinBench ? 150 : 180;       // 2.5 min vs 3 min
  const _autoTarget        = _ultraThinBench ? 240 : PRACTICAL_SUB_INTERVAL_SECONDS;
  const eff = {
    standardTargetInterval: Math.max(180, Math.min(900, ov.standardTargetIntervalSec ?? _autoTarget)),
    standardIntervalFloor: Math.max(120, Math.min(600, ov.standardIntervalFloorSec ?? _autoIntervalFloor)),
    frequentIntervalFloor: Math.max(60, Math.min(420, ov.frequentIntervalFloorSec ?? _autoFreqFloor)),
    minShiftSeconds: Math.max(60, Math.min(360, ov.minShiftSeconds ?? _autoMinShift)),
    halftimeGuardSeconds: ov.halftimeGuardSeconds !== undefined
      ? Math.max(0, Math.min(420, ov.halftimeGuardSeconds))
      : undefined, // undefined → fall back to interval floor at use site
  };
  const priorityOrder = Array.isArray(ov.playerPriorityOrder) ? ov.playerPriorityOrder : [];
  const priorityRank = new Map(priorityOrder.map((id, index) => [id, index] as const));
  const priorityBiasMaxSeconds = Math.max(0, (maxSpreadMinutes * 60) / 2);
  const priorityTargetBiasSeconds = (id: string) => {
    const rank = priorityRank.get(id);
    if (rank === undefined || priorityOrder.length < 2 || priorityBiasMaxSeconds <= 0) return 0;
    const midpoint = (priorityOrder.length - 1) / 2;
    return ((midpoint - rank) / Math.max(1, midpoint)) * priorityBiasMaxSeconds;
  };
  const priorityPullOffCompare = (a: string, b: string) => {
    if (priorityOrder.length < 2) return 0;
    return (priorityRank.get(b) ?? Number.MAX_SAFE_INTEGER) - (priorityRank.get(a) ?? Number.MAX_SAFE_INTEGER);
  };
  const priorityBringOnCompare = (a: string, b: string) => {
    if (priorityOrder.length < 2) return 0;
    return (priorityRank.get(a) ?? Number.MAX_SAFE_INTEGER) - (priorityRank.get(b) ?? Number.MAX_SAFE_INTEGER);
  };
  const plan: SubstitutionEvent[] = [];

  if (!playerData || playerData.length === 0 || teamSize <= 0 || halfDurationSeconds <= 0) {
    return [];
  }

  playerData = playerData.map(p =>
    p.position !== null && !p.currentPitchPosition
      ? { ...p, currentPitchPosition: inferredPitchPosition(p) }
      : p
  );

  const playersOnPitch = playerData.filter(p => p.position !== null);
  const benchPlayers = playerData.filter(p => p.position === null);

  if (benchPlayers.length === 0) return [];

  // Separate GK from outfield players
  const gkOnPitch = playersOnPitch.find(p => p.currentPitchPosition === "GK");
  // Resolve the 2H GK. If the coach explicitly picked one in the lineup
  // screen, honour it absolutely — whether they're currently on the bench
  // OR already on the pitch in an outfield role. Only fall back to the
  // sole-GK bench player when no explicit preference was provided.
  const explicitGkOnBench = preferredSecondHalfGkId
    ? benchPlayers.find(p => p.id === preferredSecondHalfGkId)
    : undefined;
  const explicitGkOnPitch = preferredSecondHalfGkId
    ? playersOnPitch.find(p => p.id === preferredSecondHalfGkId && p.currentPitchPosition !== "GK")
    : undefined;
  const fallbackGkOnBench = !preferredSecondHalfGkId
    ? benchPlayers.find(p => p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1)
    : undefined;

  // `gkOnBench` represents a 2H GK that needs to come ON from the bench at HT.
  // If the explicit pick is already on the pitch, there's no bench-incoming GK.
  const gkOnBench = explicitGkOnBench || (preferredSecondHalfGkId ? undefined : fallbackGkOnBench);
  const preferredOnPitchGk = explicitGkOnPitch;
  const predictedFallbackGk = !gkOnBench && !preferredOnPitchGk && rotateGkAtHalftime && gkOnPitch
    ? benchPlayers.find(p => p.assignedPositions?.includes("GK") || !p.assignedPositions?.length) || null
    : null;
  const halftimeGkIn = rotateGkAtHalftime && gkOnPitch && startHalf === 1
    ? (gkOnBench || preferredOnPitchGk || predictedFallbackGk || null)
    : null;

  // Determine whether the starting GK will be rotated out at halftime — if so,
  // they need to be eligible for H2 outfield rotation, otherwise they sit the
  // entire 2nd half (e.g. starting GK gets 50% while everyone else gets 67–83%).
  const startingGkWillRotate = !!(rotateGkAtHalftime && gkOnPitch && startHalf === 1);
  const startingGkCanPlayOutfield = !!gkOnPitch;
  const includeStartingGkInRotation = startingGkWillRotate && startingGkCanPlayOutfield;

  const outfieldPlayers = playerData.filter(p => {
    if (p.currentPitchPosition === "GK") {
      // Include the starting GK in the rotation pool so they can come on as
      // an outfielder in the 2nd half after the halftime GK swap.
      return includeStartingGkInRotation;
    }
    if (halftimeGkIn && p.id === halftimeGkIn.id) return true;
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });

  const outfieldOnPitch = playersOnPitch.filter(p => p.currentPitchPosition !== "GK");
  const outfieldOnBench = benchPlayers.filter(p => {
    if (halftimeGkIn && p.id === halftimeGkIn.id) return true;
    if (p.assignedPositions?.includes("GK") && p.assignedPositions?.length === 1) return false;
    return true;
  });

  if (outfieldOnBench.length === 0) {
    if (rotateGkAtHalftime && gkOnBench && gkOnPitch) {
      plan.push({
        time: 0,
        half: 2,
        playerOut: gkOnPitch,
        playerIn: gkOnBench,
        executed: false,
      });
    }
    return plan;
  }

  // Calculate remaining game time based on when we're starting
  // Clamp elapsed time to half duration to avoid negative remaining time
  const clampedStartElapsed = Math.min(startElapsedSeconds, halfDurationSeconds);
  const remainingInCurrentHalf = halfDurationSeconds - clampedStartElapsed;
  const remainingHalves = startHalf === 1 ? remainingInCurrentHalf + halfDurationSeconds : remainingInCurrentHalf;
  const totalRemainingSeconds = Math.max(remainingHalves, 0);
  const fieldPositions = outfieldOnPitch.length || Math.max(teamSize - (gkOnPitch ? 1 : 0), 1);
  const totalOutfieldPlayers = outfieldPlayers.length;

  // EXACT EQUAL-TIME ROTATION FOR ONE-BENCH + HALFTIME GK SWAP
  // ---------------------------------------------------------------------------
  // Canonical case: 7-a-side, 8 available, 40 min. Everyone must get exactly
  // 35' because each player has one equal bench stint. With a halftime GK swap,
  // the 2H GK must be benched before HT, then the 1H GK must immediately return
  // as an outfielder at HT. The generic planner tends to drift here because it
  // protects GK continuity and starts H2 with the 1H GK still benched.
  const oneBenchHalftimeGkExactEligible =
    priorityOrder.length === 0 &&
    rotateGkAtHalftime &&
    !!gkOnPitch &&
    !!halftimeGkIn &&
    gkOnPitch.id !== halftimeGkIn.id &&
    outfieldOnBench.length === 1 &&
    playerData.filter(p => !p.isInjured).length === teamSize + 1 &&
    startHalf === 1 &&
    clampedStartElapsed === 0;

  if (oneBenchHalftimeGkExactEligible) {
    const healthyPlayers = playerData.filter(p => !p.isInjured);
    const totalMatchSec = halfDurationSeconds * 2;
    const benchStintSec = totalMatchSec / healthyPlayers.length;
    const periodsPerHalf = halfDurationSeconds / benchStintSec;
    const exactPossible =
      Number.isInteger(benchStintSec) &&
      Number.isInteger(periodsPerHalf) &&
      periodsPerHalf >= 2;

    if (exactPossible) {
      const playerById = new Map(playerData.map(p => [p.id, p]));
      const nonGkOutfield = outfieldOnPitch.filter(p => p.id !== halftimeGkIn.id);
      const h1RegularBenchCount = Math.max(0, periodsPerHalf - 2);
      const h1Regulars = nonGkOutfield.slice(0, h1RegularBenchCount);
      const h2Regulars = nonGkOutfield.slice(h1RegularBenchCount);
      const h1BenchQueue = [outfieldOnBench[0], ...h1Regulars, halftimeGkIn];
      const h2BenchQueue = [...h2Regulars, gkOnPitch];

      if (h1BenchQueue.length === periodsPerHalf && h2BenchQueue.length === periodsPerHalf) {
        const currentPositions = new Map<string, PitchPosition>();
        outfieldOnPitch.forEach(p => currentPositions.set(p.id, inferredOutfieldPosition(p)));
        const exactPlan: SubstitutionEvent[] = [];

        const emitDirectSub = (half: 1 | 2, time: number, outgoing: Player, incoming: Player) => {
          const outPos = currentPositions.get(outgoing.id) || inferredOutfieldPosition(outgoing);
          exactPlan.push({
            time,
            half,
            playerOut: { ...outgoing, currentPitchPosition: outPos },
            playerIn: { ...incoming, currentPitchPosition: outPos },
            executed: false,
          });
          currentPositions.delete(outgoing.id);
          currentPositions.set(incoming.id, outPos);
        };

        for (let i = 1; i < h1BenchQueue.length; i++) {
          const outgoing = playerById.get(h1BenchQueue[i].id);
          const incoming = playerById.get(h1BenchQueue[i - 1].id);
          if (!outgoing || !incoming) break;
          emitDirectSub(1, Math.round(benchStintSec * i), outgoing, incoming);
        }

        exactPlan.push({
          time: 0,
          half: 2,
          playerOut: gkOnPitch,
          playerIn: halftimeGkIn,
          executed: false,
        });

        currentPositions.delete(halftimeGkIn.id);

        for (let i = 0; i < h2BenchQueue.length; i++) {
          const outgoing = playerById.get(h2BenchQueue[i].id);
          const incoming = i === 0 ? gkOnPitch : playerById.get(h2BenchQueue[i - 1].id);
          if (!outgoing || !incoming) break;
          emitDirectSub(2, Math.round(benchStintSec * i), outgoing, incoming);
        }

        return exactPlan;
      }
    }
  }

  // EXACT EQUAL-TIME ROTATION FOR ULTRA-THIN BENCHES
  // -------------------------------------------------
  // 4-a-side with 5 available players is the canonical case: one player is
  // always off, so equal game time means equal BENCH periods. The generic
  // planner spaces `N` windows across the match, which accidentally creates
  // short first/long later bench stints (e.g. 18/17/17/16/13). For exactly one
  // bench player and no GK constraint, use a simple queue with periods snapped
  // to a full multiple of the player count. Examples:
  // - 20 min match, 5 players → 5 × 4-min periods → everyone plays 16'
  // - 40 min match, 5 players → 10 × 4-min periods → everyone plays 32'
  // Allow the exact thin-bench planner to also cover the case where there's a
  // full-game GK locked into goal (no halftime swap). The remaining outfielders
  // + 1 bench rotate via simple round-robin, achieving exact equal outfield
  // minutes — e.g. 8 players / 7-aside / 40 min with locked GK → 7 outfielders
  // each play 34.3 min, GK 40 min (mathematical floor for that config).
  const canUseExactThinBenchPlanner =
    outfieldOnBench.length === 1 &&
    totalOutfieldPlayers === outfieldOnPitch.length + 1 &&
    totalOutfieldPlayers > 1 &&
    !halftimeGkIn &&
    startHalf === 1 &&
    clampedStartElapsed === 0 &&
    totalRemainingSeconds > 0;

  if (canUseExactThinBenchPlanner) {
    const preferredPeriodSeconds = 4 * 60;
    const minimumPeriodsForCadence = Math.max(
      totalOutfieldPlayers,
      Math.ceil(totalRemainingSeconds / preferredPeriodSeconds),
    );
    const equalPeriodCount = Math.max(
      totalOutfieldPlayers,
      Math.ceil(minimumPeriodsForCadence / totalOutfieldPlayers) * totalOutfieldPlayers,
    );
    const thinPlayerById = new Map(playerData.map(p => [p.id, p]));
    const rotationOnPitch = outfieldOnPitch.map(p => ({
      id: p.id,
      position: (p.currentPitchPosition || "MID") as PitchPosition,
    }));
    let benchId = outfieldOnBench[0].id;
    const exactPlan: SubstitutionEvent[] = [];

    for (let period = 1; period < equalPeriodCount; period++) {
      const absoluteSeconds = Math.round((totalRemainingSeconds * period) / equalPeriodCount);
      const outgoing = rotationOnPitch.shift();
      const incoming = thinPlayerById.get(benchId);
      const playerOut = outgoing ? thinPlayerById.get(outgoing.id) : undefined;
      if (!outgoing || !incoming || !playerOut) break;

      const { half, time } = absoluteSeconds < halfDurationSeconds
        ? { half: 1 as const, time: absoluteSeconds }
        : { half: 2 as const, time: absoluteSeconds - halfDurationSeconds };

      exactPlan.push({
        time,
        half,
        playerOut,
        playerIn: { ...incoming, currentPitchPosition: outgoing.position },
        executed: false,
      });

      rotationOnPitch.push({ id: incoming.id, position: outgoing.position });
      benchId = outgoing.id;
    }

    return exactPlan;
  }

  // ===========================================================================
  // PRACTICAL MODE (rotationSpeed === 1) — early return.
  // FIFO queue rotation, ~7 min between sub windows, max 2 swaps per window.
  // No spread escalation. Designed to mirror how a real junior coach manages
  // a game: predictable order, few interruptions, "fair enough" distribution.
  // ===========================================================================
  if (rotationSpeed === 1) {
    return buildPracticalModePlan({
      playerData, teamSize, halfDurationSeconds, rotationSpeed,
      disableBatchSubs, rotateGkAtHalftime, startHalf, clampedStartElapsed,
      startElapsedSeconds, maxSpreadMinutes, eff, priorityOrder,
      priorityTargetBiasSeconds, priorityPullOffCompare, priorityBringOnCompare,
      gkOnPitch, halftimeGkIn, startingGkWillRotate, includeStartingGkInRotation,
      outfieldPlayers, outfieldOnPitch, outfieldOnBench,
      totalOutfieldPlayers, totalRemainingSeconds,
    });
  }
  // ===========================================================================
  // BALANCED / FREQUENT MODES — fairness-driven planner below.
  // ===========================================================================
  return buildFairnessModePlan({
    playerData, teamSize, halfDurationSeconds, rotationSpeed,
    disableBatchSubs, disablePositionSwaps, rotateGkAtHalftime, startHalf,
    clampedStartElapsed, startElapsedSeconds, maxSpreadMinutes, eff,
    priorityOrder, priorityTargetBiasSeconds,
    gkOnPitch, halftimeGkIn, startingGkWillRotate, includeStartingGkInRotation,
    playersOnPitch, outfieldPlayers, outfieldOnPitch, outfieldOnBench,
    totalOutfieldPlayers, totalRemainingSeconds, fieldPositions,
  });
}

// Generate per-team plans for mini-league mode and merge them
export function createMiniLeagueSubPlan(
  players: Player[],
  teamSize: number,
  halfDurationSeconds: number,
  rotationSpeed: number,
  disablePositionSwaps: boolean,
  disableBatchSubs: boolean,
  rotateGkAtHalftime: boolean,
  startElapsedSeconds: number,
  startHalf: 1 | 2,
  miniLeagueTeams: MiniLeagueTeams,
  preferredSecondHalfGkId?: string,
  maxSpreadMinutes: number = 5,
  advancedOverrides: AutoSubAdvancedOverrides = {}
): SubstitutionEvent[] {
  const teamAPlayers = players.filter(p => p.teamSide === "a");
  const teamBPlayers = players.filter(p => p.teamSide === "b");

  const planA = teamAPlayers.length > 0
    ? createSubPlan(teamAPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, startElapsedSeconds, startHalf, preferredSecondHalfGkId, maxSpreadMinutes, advancedOverrides)
    : [];

  const planB = teamBPlayers.length > 0
    ? createSubPlan(teamBPlayers, teamSize, halfDurationSeconds, rotationSpeed, disablePositionSwaps, disableBatchSubs, rotateGkAtHalftime, startElapsedSeconds, startHalf, undefined, maxSpreadMinutes, advancedOverrides)
    : [];

  // Merge and sort by half then time
  const merged = [...planA, ...planB];
  merged.sort((a, b) => {
    if (a.half !== b.half) return a.half - b.half;
    return a.time - b.time;
  });

  return merged;
}
