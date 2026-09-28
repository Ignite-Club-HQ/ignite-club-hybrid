import { buildEqualTimePlan } from "./equalTime";
import type {
  EffectivePlannerThresholds,
} from "./standardMode";
import type {
  PlannerPlayer,
  PlannerSubstitutionEvent,
} from "./analysis";

export function calculatePlanTotals<
  P extends PlannerPlayer,
  S extends PlannerSubstitutionEvent<P>,
>(players: P[], plan: S[], halfDurationSeconds: number): Map<string, number> {
  const totalSeconds = halfDurationSeconds * 2;
  const onPitch = new Set(players.filter((player) => player.position !== null).map((player) => player.id));
  const totals = new Map<string, number>(
    players.map((player) => [player.id, Math.max(0, player.minutesPlayed ?? 0)] as const),
  );
  const absoluteTime = (substitution: S) => substitution.half === 1
    ? substitution.time
    : halfDurationSeconds + substitution.time;
  const ordered = [...plan].sort((a, b) => absoluteTime(a) - absoluteTime(b));
  let last = 0;

  for (const event of ordered) {
    const time = Math.max(last, Math.min(totalSeconds, absoluteTime(event)));
    onPitch.forEach((id) => totals.set(id, (totals.get(id) ?? 0) + (time - last)));
    last = time;
    onPitch.delete(event.playerOut.id);
    onPitch.add(event.playerIn.id);
  }
  onPitch.forEach((id) => totals.set(id, (totals.get(id) ?? 0) + (totalSeconds - last)));
  return totals;
}

export function rebalanceablePlayers<P extends PlannerPlayer>(
  players: P[],
  rotateGkAtHalftime: boolean,
): P[] {
  return players.filter((player) => {
    if (player.isInjured) return false;
    const goalkeeperOnly = player.assignedPositions?.length === 1 &&
      player.assignedPositions[0] === "GK";
    if (goalkeeperOnly && !rotateGkAtHalftime) return false;
    return true;
  });
}

export function calculatePlanSpread<
  P extends PlannerPlayer,
  S extends PlannerSubstitutionEvent<P>,
>(
  players: P[],
  plan: S[],
  halfDurationSeconds: number,
  rotateGkAtHalftime: boolean,
): number {
  const totals = calculatePlanTotals(players, plan, halfDurationSeconds);
  const values = rebalanceablePlayers(players, rotateGkAtHalftime)
    .map((player) => totals.get(player.id) ?? 0);
  if (values.length < 2) return 0;
  return Math.max(...values) - Math.min(...values);
}

export interface EqualTimeOverrideOptions<
  P extends PlannerPlayer,
  S extends PlannerSubstitutionEvent<P>,
> {
  playerData: P[];
  teamSize: number;
  halfDurationSeconds: number;
  gkOnPitch: P | null | undefined;
  halftimeGkIn: P | null | undefined;
  rotateGkAtHalftime: boolean;
  maxSpreadMinutes: number;
  rotationSpeed: number;
  eff: Pick<
    EffectivePlannerThresholds,
    "standardTargetInterval" | "standardIntervalFloor" |
    "frequentIntervalFloor" | "minShiftSeconds"
  >;
  priorityOrderLength: number;
  startHalf: 1 | 2;
  startElapsedSeconds: number;
  benchCount: number;
  currentPlan: S[];
}

export function buildEqualTimeOverride<
  P extends PlannerPlayer,
  S extends PlannerSubstitutionEvent<P>,
>(options: EqualTimeOverrideOptions<P, S>): S[] | null {
  const {
    playerData,
    teamSize,
    halfDurationSeconds,
    gkOnPitch,
    halftimeGkIn,
    rotateGkAtHalftime,
    maxSpreadMinutes,
    rotationSpeed,
    eff,
    priorityOrderLength,
    startHalf,
    startElapsedSeconds,
    benchCount,
    currentPlan,
  } = options;

  if (priorityOrderLength > 0 || startHalf !== 1 || startElapsedSeconds !== 0) return null;
  if (benchCount <= 0) return null;

  try {
    const capSeconds = Math.max(0, maxSpreadMinutes) * 60;
    const currentSpread = calculatePlanSpread(
      playerData,
      currentPlan,
      halfDurationSeconds,
      rotateGkAtHalftime,
    );
    const cadenceFloor = rotationSpeed >= 2
      ? eff.frequentIntervalFloor
      : eff.standardIntervalFloor;
    const rawCadences = [
      eff.standardTargetInterval,
      cadenceFloor,
      Math.max(60, eff.minShiftSeconds),
      240,
      180,
      120,
      90,
      60,
    ]
      .map((value) => Math.max(60, Math.round(value)))
      .filter((value) => value <= halfDurationSeconds);
    const modeCadences = rawCadences.filter((value) =>
      rotationSpeed >= 2
        ? value <= eff.frequentIntervalFloor
        : value >= eff.standardIntervalFloor);
    const cadences = Array.from(new Set(
      modeCadences.length > 0
        ? modeCadences
        : [Math.max(60, Math.min(halfDurationSeconds, Math.round(cadenceFloor)))],
    )).sort((a, b) => b - a);

    let best: { plan: S[]; spread: number } | null = null;
    for (const minimumShiftSeconds of cadences) {
      const result = buildEqualTimePlan({
        players: playerData as unknown as Parameters<typeof buildEqualTimePlan>[0]["players"],
        teamSize,
        halfDurationSec: halfDurationSeconds,
        gk1H: (gkOnPitch || undefined) as never,
        gk2H: (rotateGkAtHalftime
          ? halftimeGkIn || gkOnPitch || undefined
          : gkOnPitch || undefined) as never,
        chunkSec: 30,
        minShiftSec: minimumShiftSeconds,
        noSubBeforeSec: 0,
        noSubAfterSec: 30,
        preferCompactCycle: rotationSpeed < 2,
      });
      const candidate = result.plan as unknown as S[];
      if (candidate.length === 0) continue;
      const spread = calculatePlanSpread(
        playerData,
        candidate,
        halfDurationSeconds,
        rotateGkAtHalftime,
      );
      if (!best || spread < best.spread) best = { plan: candidate, spread };
      if (spread <= capSeconds) break;
    }

    if (!best) return null;
    const currentMeetsCap = currentSpread <= capSeconds;
    const equalTimeMeetsCap = best.spread <= capSeconds;
    if (equalTimeMeetsCap && !currentMeetsCap) return best.plan;
    if (best.spread < currentSpread) return best.plan;
    return null;
  } catch (error) {
    console.warn("[createSubPlan] equal-time override failed:", error);
    return null;
  }
}
