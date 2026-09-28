import type { PitchPosition } from "../PositionBadge";

export interface PlannerPlayer {
  id: string;
  name: string;
  position: { x: number; y: number } | null;
  assignedPositions?: PitchPosition[];
  currentPitchPosition?: PitchPosition;
  minutesPlayed?: number;
  isInjured?: boolean;
}

export interface PlannerSubstitutionEvent<P extends PlannerPlayer = PlannerPlayer> {
  time: number;
  half: 1 | 2;
  playerOut: P;
  playerIn: P;
  executed?: boolean;
  skipped?: boolean;
}

export interface PlayerTimeForecast<P extends PlannerPlayer = PlannerPlayer> {
  player: P;
  predictedMinutes: number;
  percentageOfGame: number;
  startsOnPitch: boolean;
  gkRole?: "full" | "1h" | "2h";
}

export interface FairnessPlayerStat {
  playerId: string;
  playerName: string;
  totalSeconds: number;
  shortShifts: number;
  bounceBacks: number;
  startsOnPitch: boolean;
}

export interface FairnessReport {
  perPlayer: FairnessPlayerStat[];
  spreadSeconds: number;
  minSeconds: number;
  maxSeconds: number;
  avgSeconds: number;
  totalShortShifts: number;
  totalBounceBacks: number;
  totalSubs: number;
  grade: "excellent" | "good" | "fair" | "poor";
}

const FAIRNESS_SHORT_SHIFT_SECONDS = 180;
const FAIRNESS_BOUNCE_BACK_SECONDS = 180;

export function inferredOutfieldPosition(
  player: Pick<PlannerPlayer, "currentPitchPosition" | "assignedPositions">,
): PitchPosition {
  if (player.currentPitchPosition && player.currentPitchPosition !== "GK") {
    return player.currentPitchPosition;
  }
  return player.assignedPositions?.find((position) => position !== "GK") || "MID";
}

export function inferredPitchPosition(
  player: Pick<PlannerPlayer, "currentPitchPosition" | "assignedPositions">,
): PitchPosition {
  if (player.currentPitchPosition) return player.currentPitchPosition;
  if (player.assignedPositions?.length === 1 && player.assignedPositions[0] === "GK") {
    return "GK";
  }
  return inferredOutfieldPosition(player);
}

export const normalizeRotationSpeed = (speed: number | null | undefined): number => {
  const normalized = typeof speed === "number" ? speed : 1;
  if (normalized >= 2) return 2;
  return 1;
};

export function calculateTimeForecasts<P extends PlannerPlayer>(
  players: P[],
  plan: PlannerSubstitutionEvent<P>[],
  minutesPerHalf: number,
  preferredSecondHalfGkId?: string,
  rotateGkAtHalftime: boolean = true,
  currentHalf: 1 | 2 = 1,
  currentElapsedSeconds: number = 0,
): PlayerTimeForecast<P>[] {
  const totalGameMinutes = minutesPerHalf * 2;
  const halfSec = minutesPerHalf * 60;
  const startAbs = currentHalf === 1
    ? Math.min(currentElapsedSeconds, halfSec)
    : halfSec + Math.min(currentElapsedSeconds, halfSec);
  const playersOnPitch = players.filter((player) => player.position !== null);

  const timeOnPitch = new Map<string, number>();
  const startsOnPitchMap = new Map<string, boolean>();
  players.forEach((player) => {
    timeOnPitch.set(player.id, 0);
    startsOnPitchMap.set(player.id, player.position !== null);
  });

  const currentOnPitch = new Set(playersOnPitch.map((player) => player.id));
  playersOnPitch.forEach((player) => {
    timeOnPitch.set(player.id, player.minutesPlayed || 0);
  });

  const startingGk = playersOnPitch.find((player) => inferredPitchPosition(player) === "GK");
  const gkSwapSub = startingGk
    ? plan.find((sub) => sub.half === 2 && sub.time === 0 && sub.playerOut.id === startingGk.id)
    : null;
  const preferredSecondHalfGk = preferredSecondHalfGkId
    ? players.find((player) => player.id === preferredSecondHalfGkId && player.id !== startingGk?.id)
    : undefined;
  const inferredSecondHalfGk = rotateGkAtHalftime && currentHalf === 1
    ? preferredSecondHalfGk || gkSwapSub?.playerIn
    : undefined;

  const gkRoles = new Map<string, "full" | "1h" | "2h">();
  if (startingGk) {
    if (inferredSecondHalfGk) {
      gkRoles.set(startingGk.id, "1h");
      gkRoles.set(inferredSecondHalfGk.id, "2h");
    } else {
      gkRoles.set(startingGk.id, "full");
    }
  }

  const orderedPlan = [...plan]
    .filter((sub) => !sub.executed && !sub.skipped)
    .map((sub) => ({ sub, abs: sub.half === 1 ? sub.time : halfSec + sub.time }))
    .filter((item) => item.abs >= startAbs)
    .sort((a, b) => a.abs - b.abs);
  let lastTime = startAbs;

  for (const { sub, abs } of orderedPlan) {
    const elapsed = Math.max(0, abs - lastTime);
    currentOnPitch.forEach((playerId) => {
      timeOnPitch.set(playerId, (timeOnPitch.get(playerId) || 0) + elapsed);
    });
    currentOnPitch.delete(sub.playerOut.id);
    currentOnPitch.add(sub.playerIn.id);
    lastTime = abs;
  }

  const remaining = Math.max(0, halfSec * 2 - lastTime);
  currentOnPitch.forEach((playerId) => {
    timeOnPitch.set(playerId, (timeOnPitch.get(playerId) || 0) + remaining);
  });

  return players.map((player) => ({
    player,
    predictedMinutes: Math.round((timeOnPitch.get(player.id) || 0) / 60),
    percentageOfGame: Math.round(
      ((timeOnPitch.get(player.id) || 0) / 60 / totalGameMinutes) * 100,
    ),
    startsOnPitch: startsOnPitchMap.get(player.id) || false,
    gkRole: gkRoles.get(player.id),
  })).sort((a, b) => b.predictedMinutes - a.predictedMinutes);
}

export function calculateFairnessReport<P extends PlannerPlayer>(
  players: P[],
  plan: PlannerSubstitutionEvent<P>[],
  minutesPerHalf: number,
): FairnessReport {
  const halfSec = minutesPerHalf * 60;
  const totalSec = halfSec * 2;
  const stints = new Map<string, { start: number; end: number }[]>();

  for (const player of players) {
    stints.set(player.id, player.position !== null ? [{ start: 0, end: totalSec }] : []);
  }

  const events = [...plan].sort((a, b) => {
    const aAbs = (a.half - 1) * halfSec + a.time;
    const bAbs = (b.half - 1) * halfSec + b.time;
    return aAbs - bAbs;
  });

  for (const event of events) {
    if (event.skipped) continue;
    const absoluteTime = (event.half - 1) * halfSec + event.time;
    const outgoingStints = stints.get(event.playerOut.id);
    if (outgoingStints?.length) {
      const last = outgoingStints[outgoingStints.length - 1];
      if (last.end > absoluteTime) last.end = absoluteTime;
    }
    stints.get(event.playerIn.id)?.push({ start: absoluteTime, end: totalSec });
  }

  const perPlayer = players.map((player): FairnessPlayerStat => {
    const playerStints = stints.get(player.id) || [];
    let totalSeconds = 0;
    let shortShifts = 0;
    let bounceBacks = 0;

    playerStints.forEach((stint, index) => {
      const duration = Math.max(0, stint.end - stint.start);
      totalSeconds += duration;
      if (duration < FAIRNESS_SHORT_SHIFT_SECONDS) shortShifts++;
      if (index > 0) {
        const gap = stint.start - playerStints[index - 1].end;
        if (gap > 0 && gap < FAIRNESS_BOUNCE_BACK_SECONDS) bounceBacks++;
      }
    });

    return {
      playerId: player.id,
      playerName: player.name,
      totalSeconds,
      shortShifts,
      bounceBacks,
      startsOnPitch: player.position !== null,
    };
  });

  const totals = perPlayer.map((stat) => stat.totalSeconds);
  const minSeconds = totals.length ? Math.min(...totals) : 0;
  const maxSeconds = totals.length ? Math.max(...totals) : 0;
  const avgSeconds = totals.length
    ? totals.reduce((total, seconds) => total + seconds, 0) / totals.length
    : 0;
  const spreadSeconds = maxSeconds - minSeconds;
  const totalShortShifts = perPlayer.reduce((total, stat) => total + stat.shortShifts, 0);
  const totalBounceBacks = perPlayer.reduce((total, stat) => total + stat.bounceBacks, 0);
  const spreadMinutes = spreadSeconds / 60;

  let grade: FairnessReport["grade"];
  if (spreadMinutes <= 4 && totalShortShifts === 0 && totalBounceBacks === 0) grade = "excellent";
  else if (spreadMinutes <= 7 && totalShortShifts <= 1 && totalBounceBacks <= 1) grade = "good";
  else if (spreadMinutes <= 12 && totalShortShifts <= 3) grade = "fair";
  else grade = "poor";

  return {
    perPlayer: perPlayer.sort((a, b) => b.totalSeconds - a.totalSeconds),
    spreadSeconds,
    minSeconds,
    maxSeconds,
    avgSeconds,
    totalShortShifts,
    totalBounceBacks,
    totalSubs: events.length,
    grade,
  };
}
