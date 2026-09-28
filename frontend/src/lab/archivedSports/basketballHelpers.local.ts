/**
 * Basketball game board types.
 * Fully isolated from soccer (`pitch/types.ts`) and netball (`netball/types.ts`)
 * so the existing boards remain untouched.
 *
 * Positions are SOFT roles: any player can occupy any slot. Validation modes
 * exist only for "Structured Mode" coaches who want one player per role.
 */
import { visiblePeriods, type PeriodType } from "../../lib/periodTypes";

export type { PeriodType } from "../../lib/periodTypes";

export type BasketballPosition = "PG" | "SG" | "SF" | "PF" | "C";

export const BASKETBALL_POSITIONS: BasketballPosition[] = ["PG", "SG", "SF", "PF", "C"];

export interface BasketballPlayer {
  id: string;
  name: string;
  number?: number;
  position: BasketballPosition | null;
  minutesPlayed?: number;
  isInjured?: boolean;
  isFillIn?: boolean;
  preferredPositions?: BasketballPosition[];
  fouls?: number;
  isFouledOut?: boolean;
  points?: number;
  pointsBy1?: number;
  pointsBy2?: number;
  pointsBy3?: number;
  ftMade?: number;
  ftAttempted?: number;
  lastBenchedAt?: number | null;
}

export type Quarter = 1 | 2 | 3 | 4;

export type RotationMode = "time-based" | "quarter-break" | "off";

export type ValidationMode = "free" | "structured";

export interface BasketballSubEvent {
  quarter: Quarter;
  time: number;
  playerOut: BasketballPlayer;
  playerIn: BasketballPlayer;
  position: BasketballPosition;
  executed?: boolean;
  skipped?: boolean;
}

export interface QuarterLineup {
  quarter: Quarter;
  assignments: Partial<Record<BasketballPosition, string>>;
  createdAt: number;
}

export const getSubKey = (sub: BasketballSubEvent): string =>
  `${sub.quarter}-${sub.time}-${sub.playerOut.id}-${sub.position}`;

/**
 * Basketball positions are SOFT — every player is eligible everywhere.
 * Preferred positions are used only as a hint for like-for-like swaps.
 */
export const isPositionAllowedForPlayer = (): boolean => true;

/**
 * Pick a like-for-like bench candidate. Preference order:
 *   1. Bench player whose preferredPositions includes the target position
 *   2. Bench player with FEWEST minutes played (equal-time philosophy)
 */
export const pickLikeForLikeBenchPlayer = (
  position: BasketballPosition,
  bench: BasketballPlayer[],
  excludeIds: string[] = []
): BasketballPlayer | undefined => {
  const eligible = bench.filter(
    (p) => !p.isInjured && !p.isFouledOut && !excludeIds.includes(p.id)
  );
  if (eligible.length === 0) return undefined;

  const preferred = eligible.filter((p) => p.preferredPositions?.includes(position));
  const pool = preferred.length > 0 ? preferred : eligible;

  return [...pool].sort((a, b) => (a.minutesPlayed ?? 0) - (b.minutesPlayed ?? 0))[0];
};

export const getBench = (players: BasketballPlayer[]): BasketballPlayer[] =>
  players.filter((p) => p.position === null);

export const getOnCourt = (players: BasketballPlayer[]): BasketballPlayer[] =>
  players.filter((p) => p.position !== null);

export const getEmptyPositions = (players: BasketballPlayer[]): BasketballPosition[] => {
  const filled = new Set(players.map((p) => p.position).filter(Boolean) as BasketballPosition[]);
  return BASKETBALL_POSITIONS.filter((p) => !filled.has(p));
};

export const findPlayerInPosition = (
  players: BasketballPlayer[],
  position: BasketballPosition
): BasketballPlayer | undefined => players.find((p) => p.position === position);

export const transitionPosition = (
  p: BasketballPlayer,
  next: BasketballPosition | null,
  now: number = Date.now()
): BasketballPlayer => {
  const wasOnCourt = p.position !== null;
  const goingToBench = next === null;
  if (wasOnCourt && goingToBench) {
    return { ...p, position: null, lastBenchedAt: now };
  }
  if (!goingToBench && p.lastBenchedAt) {
    return { ...p, position: next, lastBenchedAt: null };
  }
  return { ...p, position: next };
};

export const applyLineup = (
  players: BasketballPlayer[],
  lineup: QuarterLineup
): BasketballPlayer[] => {
  const positionByPlayerId = new Map<string, BasketballPosition>();
  for (const [position, playerId] of Object.entries(lineup.assignments)) {
    if (playerId) positionByPlayerId.set(playerId, position as BasketballPosition);
  }
  return players.map((p) => {
    const next = positionByPlayerId.get(p.id) ?? null;
    if (p.position === null && next === null) return p;
    return transitionPosition(p, next);
  });
};

export const snapshotLineup = (
  players: BasketballPlayer[],
  quarter: Quarter
): QuarterLineup => {
  const assignments: Partial<Record<BasketballPosition, string>> = {};
  for (const p of players) {
    if (p.position) assignments[p.position] = p.id;
  }
  return { quarter, assignments, createdAt: Date.now() };
};

/**
 * Time-based rotation: every N minutes, swap the highest-minutes on-court
 * player with the lowest-minutes bench player (equal time philosophy).
 * Basketball is high-tempo — keep the pool moving.
 */
export const generateTimeBasedRotationPlan = (
  players: BasketballPlayer[],
  intervalMinutes: number,
  minutesPerQuarter: number,
  periodType: PeriodType = "quarters"
): BasketballSubEvent[] => {
  const plan: BasketballSubEvent[] = [];
  const intervalSeconds = intervalMinutes * 60;
  const quarterSeconds = minutesPerQuarter * 60;

  for (const q of visiblePeriods(periodType)) {
    let t = intervalSeconds;
    while (t < quarterSeconds) {
      const bench = getBench(players);
      if (bench.length === 0) break;
      const onCourt = getOnCourt(players);
      const sortedOnCourt = [...onCourt].sort(
        (a, b) => (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0)
      );
      const playerOut = sortedOnCourt[0];
      if (!playerOut || !playerOut.position) break;
      const candidate = pickLikeForLikeBenchPlayer(
        playerOut.position,
        bench,
        plan.filter((s) => s.quarter === q).map((s) => s.playerIn.id)
      );
      if (!candidate) break;
      plan.push({
        quarter: q as Quarter,
        time: t,
        playerOut,
        playerIn: candidate,
        position: playerOut.position,
      });
      t += intervalSeconds;
    }
  }
  return plan;
};

/**
 * Quarter-break rotation: at the start of Q2/Q3/Q4, swap N bench players in.
 * Basketball coaches typically rotate aggressively at breaks — default 3.
 */
export const generateQuarterBreakRotationPlan = (
  players: BasketballPlayer[],
  swapsPerBreak = 3,
  periodType: PeriodType = "quarters"
): BasketballSubEvent[] => {
  const plan: BasketballSubEvent[] = [];
  const bench = getBench(players);
  if (bench.length === 0) return plan;

  const breaks = visiblePeriods(periodType).slice(1) as Quarter[];
  for (const q of breaks) {
    const onCourt = getOnCourt(players);
    const sortedOnCourt = [...onCourt].sort(
      (a, b) => (b.minutesPlayed ?? 0) - (a.minutesPlayed ?? 0)
    );
    for (let i = 0; i < Math.min(swapsPerBreak, bench.length); i++) {
      const playerOut = sortedOnCourt[i];
      if (!playerOut || !playerOut.position) continue;
      const candidate = pickLikeForLikeBenchPlayer(
        playerOut.position,
        bench,
        plan.filter((s) => s.quarter === q).map((s) => s.playerIn.id)
      );
      if (!candidate) continue;
      plan.push({
        quarter: q,
        time: 0,
        playerOut,
        playerIn: candidate,
        position: playerOut.position,
      });
    }
  }
  return plan;
};

/**
 * Next un-executed sub that's due **in the current quarter only**.
 *
 * We deliberately do NOT cascade un-executed subs from previous quarters
 * (B1 audit fix). If a sub from Q1 was missed, the coach has either skipped
 * it or paused auto-subs — re-firing it at the start of Q2 would yank a
 * starter off in the middle of a fresh quarter. Quarter-break rotations are
 * handled separately via `handleQuarterEnd` + `pendingQuarterSubs`.
 */
export const findNextDueSub = (
  plan: BasketballSubEvent[],
  currentQuarter: Quarter,
  elapsedSeconds: number
): BasketballSubEvent | undefined => {
  return plan
    .filter((s) => !s.executed && !s.skipped)
    .find((s) => s.quarter === currentQuarter && s.time <= elapsedSeconds);
};

export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

export const safeLoad = <T>(key: string): T | null => {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
};

export const safeSave = <T>(key: string, value: T): void => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* quota / private mode — ignore */
  }
};
