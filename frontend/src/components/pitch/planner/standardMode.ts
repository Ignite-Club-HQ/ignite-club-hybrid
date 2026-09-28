import type { PlannerPlayer, PlannerSubstitutionEvent } from "./analysis";

export interface PlannerThresholdOverrides {
  standardIntervalFloorSec?: number;
  standardTargetIntervalSec?: number;
  frequentIntervalFloorSec?: number;
  minShiftSeconds?: number;
  halftimeGuardSeconds?: number;
}

export interface EffectivePlannerThresholds {
  standardTargetInterval: number;
  standardIntervalFloor: number;
  frequentIntervalFloor: number;
  minShiftSeconds: number;
  halftimeGuardSeconds?: number;
}

export const STANDARD_CALMDOWN_FLOORS_SECONDS = [300, 360, 420, 480, 540, 600] as const;

const STANDARD_TARGET_INTERVAL_SECONDS = 7 * 60;

export function resolvePlannerThresholds(
  benchCount: number,
  overrides: PlannerThresholdOverrides = {},
): EffectivePlannerThresholds {
  const ultraThinBench = benchCount > 0 && benchCount <= 1;
  const intervalFloor = ultraThinBench ? 180 : 240;
  const frequentFloor = ultraThinBench ? 120 : 180;
  const minimumShift = ultraThinBench ? 150 : 180;
  const targetInterval = ultraThinBench ? 240 : STANDARD_TARGET_INTERVAL_SECONDS;

  return {
    standardTargetInterval: Math.max(
      180,
      Math.min(900, overrides.standardTargetIntervalSec ?? targetInterval),
    ),
    standardIntervalFloor: Math.max(
      120,
      Math.min(600, overrides.standardIntervalFloorSec ?? intervalFloor),
    ),
    frequentIntervalFloor: Math.max(
      60,
      Math.min(420, overrides.frequentIntervalFloorSec ?? frequentFloor),
    ),
    minShiftSeconds: Math.max(
      60,
      Math.min(360, overrides.minShiftSeconds ?? minimumShift),
    ),
    halftimeGuardSeconds: overrides.halftimeGuardSeconds !== undefined
      ? Math.max(0, Math.min(420, overrides.halftimeGuardSeconds))
      : undefined,
  };
}

/**
 * Preserve the existing final no-starvation post-pass. The function mutates
 * and returns `plan` by design because the legacy planner has always passed its
 * working array through this boundary.
 */
export function ensureNoStarvedPlayers<
  P extends PlannerPlayer,
  S extends PlannerSubstitutionEvent<P>,
>(
  plan: S[],
  players: P[],
  halfDurationSeconds: number,
): S[] {
  if (plan.length === 0 || players.length === 0) return plan;

  const eligible = (player: P) =>
    !player.isInjured &&
    !(player.assignedPositions?.length === 1 && player.assignedPositions[0] === "GK");
  const canPlay = (player: P, position?: string) =>
    !position || !player.assignedPositions?.length ||
    player.assignedPositions.includes(position as never);
  const totalSeconds = halfDurationSeconds * 2;
  const absoluteTime = (substitution: S) =>
    substitutionAbsoluteTime(substitution, halfDurationSeconds);

  const simulate = (): Map<string, number> => {
    const onPitch = new Set(players.filter((player) => player.position).map((player) => player.id));
    const totals = new Map<string, number>(players.map((player) => [player.id, 0]));
    const sorted = [...plan].sort((a, b) => absoluteTime(a) - absoluteTime(b));
    let last = 0;
    for (const event of sorted) {
      const time = absoluteTime(event);
      onPitch.forEach((id) => totals.set(id, (totals.get(id) ?? 0) + (time - last)));
      last = time;
      onPitch.delete(event.playerOut.id);
      onPitch.add(event.playerIn.id);
    }
    onPitch.forEach((id) => totals.set(id, (totals.get(id) ?? 0) + (totalSeconds - last)));
    return totals;
  };

  const buildTimeline = () => {
    const sorted = [...plan].sort((a, b) => absoluteTime(a) - absoluteTime(b));
    const onPitch = new Map<string, string | undefined>();
    players.filter((player) => player.position).forEach((player) =>
      onPitch.set(player.id, player.currentPitchPosition));
    const segments: {
      from: number;
      to: number;
      onPitch: Map<string, string | undefined>;
    }[] = [];
    let last = 0;
    for (const event of sorted) {
      const time = absoluteTime(event);
      if (time > last) segments.push({ from: last, to: time, onPitch: new Map(onPitch) });
      onPitch.delete(event.playerOut.id);
      onPitch.set(event.playerIn.id, event.playerOut.currentPitchPosition);
      last = time;
    }
    if (totalSeconds > last) {
      segments.push({ from: last, to: totalSeconds, onPitch: new Map(onPitch) });
    }
    return segments;
  };

  const maximumRounds = 4;
  for (let round = 0; round < maximumRounds; round++) {
    const totals = simulate();
    const starved = players
      .filter((player) => eligible(player))
      .filter((player) => (totals.get(player.id) ?? 0) === 0)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (starved.length === 0) break;

    let progressed = false;
    for (const victim of starved) {
      const candidates = plan
        .map((substitution, index) => ({ substitution, index }))
        .filter(({ substitution }) => {
          if ((substitution as S & { positionSwap?: unknown }).positionSwap) return false;
          if (substitution.playerIn.id === victim.id) return false;
          if (substitution.playerOut.id === victim.id) return false;
          if (!canPlay(victim, substitution.playerOut.currentPitchPosition)) return false;
          const sameWindowYoyo = plan.some((other) =>
            other !== substitution && absoluteTime(other) === absoluteTime(substitution) &&
            other.playerOut.id === victim.id);
          if (sameWindowYoyo) return false;
          if (starved.some((player) => player.id === substitution.playerIn.id)) return false;
          return true;
        })
        .map(({ substitution, index }) => ({
          substitution,
          index,
          incomingTotal: totals.get(substitution.playerIn.id) ?? 0,
        }))
        .sort((a, b) => b.incomingTotal - a.incomingTotal);
      if (candidates.length === 0) continue;
      const target = candidates[0];
      plan[target.index] = { ...target.substitution, playerIn: victim };
      progressed = true;
    }
    if (!progressed) break;
  }

  for (let injection = 0; injection < 6; injection++) {
    const totals = simulate();
    const stillStarved = players
      .filter((player) => eligible(player))
      .filter((player) => (totals.get(player.id) ?? 0) === 0)
      .sort((a, b) => a.id.localeCompare(b.id));
    if (stillStarved.length === 0) break;

    let injectedAny = false;
    for (const victim of stillStarved) {
      const rankedSegments = buildTimeline()
        .map((segment) => ({ segment, duration: segment.to - segment.from }))
        .filter(({ duration }) => duration >= 60)
        .sort((a, b) => b.duration - a.duration);
      let placed = false;

      for (const { segment } of rankedSegments) {
        const candidatesOut = [...segment.onPitch.entries()]
          .filter(([id]) => id !== victim.id)
          .filter(([id]) => {
            const candidate = players.find((player) => player.id === id);
            return Boolean(candidate) &&
              !(candidate?.assignedPositions?.length === 1 && candidate.assignedPositions[0] === "GK");
          })
          .filter(([, position]) => canPlay(victim, position))
          .map(([id, position]) => ({ id, position, total: totals.get(id) ?? 0 }))
          .sort((a, b) => b.total - a.total);
        if (candidatesOut.length === 0) continue;

        const outgoing = candidatesOut[0];
        const playerOut = players.find((player) => player.id === outgoing.id);
        if (!playerOut) continue;
        const insertAbsolute = Math.floor(
          segment.from + Math.max(60, (segment.to - segment.from) / 3),
        );
        const half: 1 | 2 = insertAbsolute < halfDurationSeconds ? 1 : 2;
        const time = half === 1 ? insertAbsolute : insertAbsolute - halfDurationSeconds;
        plan.push({
          half,
          time,
          executed: false,
          playerOut: { ...playerOut, currentPitchPosition: outgoing.position } as P,
          playerIn: { ...victim, currentPitchPosition: outgoing.position } as P,
        } as S);
        injectedAny = true;
        placed = true;
        break;
      }
      if (!placed) continue;
    }
    if (!injectedAny) break;
  }

  plan.sort((a, b) => absoluteTime(a) - absoluteTime(b));
  return plan;
}

export function substitutionAbsoluteTime(
  substitution: Pick<PlannerSubstitutionEvent, "half" | "time">,
  halfDurationSeconds: number,
): number {
  return substitution.half === 1
    ? substitution.time
    : halfDurationSeconds + substitution.time;
}

export function countSubstitutionWindows(
  plan: Pick<PlannerSubstitutionEvent, "half" | "time">[],
  halfDurationSeconds: number,
): number {
  return new Set(plan.map((substitution) =>
    substitutionAbsoluteTime(substitution, halfDurationSeconds))).size;
}

interface CompactStandardWindowOptions<
  P extends PlannerPlayer,
  S extends PlannerSubstitutionEvent<P>,
> {
  source: S[];
  players: P[];
  halfDurationSeconds: number;
  maxSpreadSeconds: number;
  isPlayable: (players: P[], candidate: S[], halfDurationSeconds: number) => boolean;
  calculateSpread: (players: P[], candidate: S[], halfDurationSeconds: number) => number;
}

/**
 * Find the fairest playable way to combine one adjacent pair of substitution
 * windows. The caller supplies playability and spread policies so this pure
 * cadence boundary does not own goalkeeper or position business rules.
 */
export function compactOneStandardWindow<
  P extends PlannerPlayer,
  S extends PlannerSubstitutionEvent<P>,
>({
  source,
  players,
  halfDurationSeconds,
  maxSpreadSeconds,
  isPlayable,
  calculateSpread,
}: CompactStandardWindowOptions<P, S>): S[] | null {
  const sourceWindows = Array.from(new Set(source.map((substitution) =>
    substitutionAbsoluteTime(substitution, halfDurationSeconds)))).sort((a, b) => a - b);
  if (sourceWindows.length < 2) return null;

  let best: { plan: S[]; spread: number } | null = null;
  const sameWindowYoyoCount = (plan: S[]) => {
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
        substitutionAbsoluteTime(b, halfDurationSeconds)) as S[];

      if (!isPlayable(players, candidate, halfDurationSeconds)) continue;
      if (sameWindowYoyoCount(candidate) > Math.max(1, sourceYoyos)) continue;
      const spread = calculateSpread(players, candidate, halfDurationSeconds);
      if (spread > maxSpreadSeconds) continue;
      if (!best || spread < best.spread) best = { plan: candidate, spread };
    }
  }

  return best?.plan ?? null;
}
