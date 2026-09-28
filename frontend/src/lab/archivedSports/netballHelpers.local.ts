/**
 * Netball game board types.
 * Kept fully isolated from src/components/pitch/types.ts so the soccer
 * pitch board logic remains untouched.
 */
import { visiblePeriods, type PeriodType } from "../../lib/periodTypes";

export type { PeriodType } from "../../lib/periodTypes";

export type NetballPosition = "GS" | "GA" | "WA" | "C" | "WD" | "GD" | "GK";

export const NETBALL_POSITIONS: NetballPosition[] = ["GS", "GA", "WA", "C", "WD", "GD", "GK"];

/**
 * Court zones a player is allowed to enter.
 * Court is divided vertically into thirds (attack / centre / defence)
 * with two shooting circles (one inside the attacking third, one inside the
 * defending third).
 */
export type CourtZone =
  | "attack-third"
  | "attack-circle"
  | "centre-third"
  | "defence-third"
  | "defence-circle";

export const POSITION_ALLOWED_ZONES: Record<NetballPosition, CourtZone[]> = {
  GS: ["attack-third", "attack-circle"],
  GA: ["attack-third", "attack-circle", "centre-third"],
  WA: ["attack-third", "centre-third"],
  C: ["attack-third", "centre-third", "defence-third"],
  WD: ["centre-third", "defence-third"],
  GD: ["centre-third", "defence-third", "defence-circle"],
  GK: ["defence-third", "defence-circle"],
};

export interface NetballPlayer {
  id: string;
  name: string;
  number?: number;
  position: NetballPosition | null;
  minutesPlayed?: number;
  isInjured?: boolean;
  isFillIn?: boolean;
  preferredPositions?: NetballPosition[];
  lastBenchedAt?: number | null;
  goals?: number;
}

export type Quarter = 1 | 2 | 3 | 4;

export type RotationMode = "time-based" | "quarter-break" | "off";

export type ValidationMode = "strict" | "warn" | "free";

export interface NetballSubEvent {
  quarter: Quarter;
  time: number;
  playerOut: NetballPlayer;
  playerIn: NetballPlayer;
  position: NetballPosition;
  executed?: boolean;
  skipped?: boolean;
}

export interface QuarterLineup {
  quarter: Quarter;
  assignments: Partial<Record<NetballPosition, string>>;
  createdAt: number;
}

export const getSubKey = (sub: NetballSubEvent): string =>
  `${sub.quarter}-${sub.time}-${sub.playerOut.id}-${sub.position}`;

/**
 * Validate whether a player can occupy a position.
 * In netball, positions are fixed — if a player is allowed to play GS they may
 * stand anywhere a GS may go. We treat the position itself as the validation
 * unit (since each slot is hard-coded).
 *
 * Coach-set preferred positions act as the "this player can play here" list.
 * If a player has no preferredPositions, they're considered eligible for all.
 */
export const isPositionAllowedForPlayer = (
  player: NetballPlayer,
  position: NetballPosition
): boolean => {
  if (!player.preferredPositions || player.preferredPositions.length === 0) return true;
  return player.preferredPositions.includes(position);
};

/**
 * Strength of the swap fit between an outgoing player's position and an
 * incoming player. Used to grade sub suggestions and to back the "warn" mode
 * when no preferredPositions are set.
 *   - "exact"      → incoming has the position in preferredPositions
 *   - "zone"       → incoming's preferred positions share a court zone
 *   - "any"        → no preferred positions known
 *   - "violation"  → preferred positions exist but none overlap zones
 */
export type SwapFit = "exact" | "zone" | "any" | "violation";

export const classifySwapFit = (
  incoming: NetballPlayer,
  position: NetballPosition
): SwapFit => {
  const prefs = incoming.preferredPositions ?? [];
  if (prefs.length === 0) return "any";
  if (prefs.includes(position)) return "exact";
  const targetZones = new Set(POSITION_ALLOWED_ZONES[position]);
  const zoneOverlap = prefs.some((pp) =>
    POSITION_ALLOWED_ZONES[pp].some((z) => targetZones.has(z))
  );
  return zoneOverlap ? "zone" : "violation";
};

/**
 * Find the closest valid like-for-like swap candidate from the bench
 * for a player coming off a given position.
 * Preference order:
 *   1. Bench player whose preferredPositions includes the target position
 *   2. Bench player with overlapping allowed zones
 *   3. Any non-injured bench player
 */
export const pickLikeForLikeBenchPlayer = (
  position: NetballPosition,
  bench: NetballPlayer[],
  excludeIds: string[] = []
): NetballPlayer | undefined => {
  const eligible = bench.filter((p) => !p.isInjured && !excludeIds.includes(p.id));
  if (eligible.length === 0) return undefined;

  const exactMatch = eligible.find((p) =>
    p.preferredPositions?.includes(position)
  );
  if (exactMatch) return exactMatch;

  const targetZones = new Set(POSITION_ALLOWED_ZONES[position]);
  const zoneMatch = eligible.find((p) =>
    (p.preferredPositions ?? []).some((pp) =>
      POSITION_ALLOWED_ZONES[pp].some((z) => targetZones.has(z))
    )
  );
  if (zoneMatch) return zoneMatch;

  return eligible[0];
};

export const getBench = (players: NetballPlayer[]): NetballPlayer[] =>
  players.filter((p) => p.position === null);

export const getOnCourt = (players: NetballPlayer[]): NetballPlayer[] =>
  players.filter((p) => p.position !== null);

export const getEmptyPositions = (players: NetballPlayer[]): NetballPosition[] => {
  const filled = new Set(players.map((p) => p.position).filter(Boolean) as NetballPosition[]);
  return NETBALL_POSITIONS.filter((p) => !filled.has(p));
};

export const findPlayerInPosition = (
  players: NetballPlayer[],
  position: NetballPosition
): NetballPlayer | undefined => players.find((p) => p.position === position);

export const transitionPosition = (
  p: NetballPlayer,
  next: NetballPosition | null,
  now: number = Date.now()
): NetballPlayer => {
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
  players: NetballPlayer[],
  lineup: QuarterLineup
): NetballPlayer[] => {
  const positionByPlayerId = new Map<string, NetballPosition>();
  for (const [position, playerId] of Object.entries(lineup.assignments)) {
    if (playerId) positionByPlayerId.set(playerId, position as NetballPosition);
  }
  return players.map((p) => transitionPosition(p, positionByPlayerId.get(p.id) ?? null));
};

export const snapshotLineup = (
  players: NetballPlayer[],
  quarter: Quarter
): QuarterLineup => {
  const assignments: Partial<Record<NetballPosition, string>> = {};
  for (const p of players) {
    if (p.position) assignments[p.position] = p.id;
  }
  return { quarter, assignments, createdAt: Date.now() };
};

const pickFairestBenchPlayer = (
  position: NetballPosition,
  bench: NetballPlayer[],
  projectedSeconds: Map<string, number>,
  excludeIds: Set<string>
): NetballPlayer | undefined => {
  const eligible = bench.filter((p) => !p.isInjured && !excludeIds.has(p.id));
  if (eligible.length === 0) return undefined;

  const fitRank = (p: NetballPlayer): number => {
    const fit = classifySwapFit(p, position);
    return fit === "exact" ? 0 : fit === "zone" ? 1 : fit === "any" ? 2 : 3;
  };

  return [...eligible].sort((a, b) => {
    const aMin = projectedSeconds.get(a.id) ?? 0;
    const bMin = projectedSeconds.get(b.id) ?? 0;
    if (aMin !== bMin) return aMin - bMin;
    return fitRank(a) - fitRank(b);
  })[0];
};

/**
 * Generate a time-based rotation plan that EQUALISES playing time.
 *
 * Algorithm:
 *  - Simulate the game forward, tracking projected seconds for every player.
 *  - At each interval, sub OUT the on-court player with the MOST projected
 *    minutes, and bring IN the bench player with the LEAST projected minutes.
 *  - Position assignment follows the outgoing player's slot (like-for-like
 *    when possible, but fairness wins ties).
 *
 * This guarantees every available player is cycled through before anyone is
 * subbed twice, and over a full game the spread between most and least
 * minutes converges to ~one interval.
 */
export const generateTimeBasedRotationPlan = (
  players: NetballPlayer[],
  intervalMinutes: number,
  minutesPerQuarter: number,
  periodType: PeriodType = "quarters"
): NetballSubEvent[] => {
  const plan: NetballSubEvent[] = [];
  const intervalSeconds = intervalMinutes * 60;
  const quarterSeconds = minutesPerQuarter * 60;

  const roster = players.filter((p) => !p.isInjured);
  if (roster.length <= 7) return plan;

  const onCourt = new Map<NetballPosition, string>();
  for (const p of roster) {
    if (p.position) onCourt.set(p.position, p.id);
  }
  if (onCourt.size === 0) return plan;

  const projectedSeconds = new Map<string, number>();
  for (const p of roster) projectedSeconds.set(p.id, 0);
  const playerById = new Map(roster.map((p) => [p.id, p]));

  const advance = (deltaSeconds: number) => {
    if (deltaSeconds <= 0) return;
    for (const id of onCourt.values()) {
      projectedSeconds.set(id, (projectedSeconds.get(id) ?? 0) + deltaSeconds);
    }
  };

  let lastTickAbsolute = 0;
  const periods = visiblePeriods(periodType);

  for (let qi = 0; qi < periods.length; qi++) {
    const q = periods[qi] as Quarter;
    const periodStartAbs = qi * quarterSeconds;
    const periodEndAbs = periodStartAbs + quarterSeconds;

    let t = intervalSeconds;
    while (t < quarterSeconds) {
      const absTick = periodStartAbs + t;
      advance(absTick - lastTickAbsolute);
      lastTickAbsolute = absTick;

      const onCourtList = Array.from(onCourt.entries())
        .map(([position, id]) => ({
          position,
          player: playerById.get(id)!,
          mins: projectedSeconds.get(id) ?? 0,
        }))
        .filter((x) => x.player);
      onCourtList.sort((a, b) => b.mins - a.mins);

      const benchPlayers = roster.filter((p) => !Array.from(onCourt.values()).includes(p.id));
      if (benchPlayers.length === 0) break;
      const minBenchMins = Math.min(...benchPlayers.map((p) => projectedSeconds.get(p.id) ?? 0));

      let chosen: { position: NetballPosition; player: NetballPlayer; replacement: NetballPlayer } | null = null;
      for (const candidate of onCourtList) {
        if (candidate.mins <= minBenchMins) continue;
        const replacement = pickFairestBenchPlayer(
          candidate.position,
          benchPlayers,
          projectedSeconds,
          new Set()
        );
        if (replacement && (projectedSeconds.get(replacement.id) ?? 0) < candidate.mins) {
          chosen = { position: candidate.position, player: candidate.player, replacement };
          break;
        }
      }

      if (!chosen) {
        t += intervalSeconds;
        continue;
      }

      onCourt.set(chosen.position, chosen.replacement.id);
      plan.push({
        quarter: q,
        time: t,
        playerOut: chosen.player,
        playerIn: chosen.replacement,
        position: chosen.position,
      });
      t += intervalSeconds;
    }

    advance(periodEndAbs - lastTickAbsolute);
    lastTickAbsolute = periodEndAbs;
  }
  return plan;
};

/**
 * Generate a quarter-break rotation plan that EQUALISES playing time.
 *
 * At each break we credit the period's minutes, then pick the N most-played
 * starters and swap them for the N least-played bench players (subject to
 * position fit). This balances minutes across the whole roster.
 */
export const generateQuarterBreakRotationPlan = (
  players: NetballPlayer[],
  swapsPerBreak = 2,
  periodType: PeriodType = "quarters",
  minutesPerQuarter = 15
): NetballSubEvent[] => {
  const plan: NetballSubEvent[] = [];
  const roster = players.filter((p) => !p.isInjured);
  if (roster.length <= 7) return plan;

  const onCourt = new Map<NetballPosition, string>();
  for (const p of roster) {
    if (p.position) onCourt.set(p.position, p.id);
  }
  if (onCourt.size === 0) return plan;

  const projectedSeconds = new Map<string, number>();
  for (const p of roster) projectedSeconds.set(p.id, 0);
  const playerById = new Map(roster.map((p) => [p.id, p]));
  const quarterSeconds = minutesPerQuarter * 60;

  const periods = visiblePeriods(periodType) as Quarter[];
  for (const id of onCourt.values()) {
    projectedSeconds.set(id, (projectedSeconds.get(id) ?? 0) + quarterSeconds);
  }

  for (let i = 1; i < periods.length; i++) {
    const q = periods[i];
    const usedBenchThisBreak = new Set<string>();

    for (let s = 0; s < swapsPerBreak; s++) {
      const onCourtList = Array.from(onCourt.entries())
        .map(([position, id]) => ({
          position,
          player: playerById.get(id)!,
          mins: projectedSeconds.get(id) ?? 0,
        }))
        .sort((a, b) => b.mins - a.mins);

      const benchPlayers = roster.filter(
        (p) => !Array.from(onCourt.values()).includes(p.id) && !usedBenchThisBreak.has(p.id)
      );
      if (benchPlayers.length === 0) break;

      let picked: { position: NetballPosition; player: NetballPlayer; replacement: NetballPlayer } | null = null;
      for (const cand of onCourtList) {
        const replacement = pickFairestBenchPlayer(
          cand.position,
          benchPlayers,
          projectedSeconds,
          usedBenchThisBreak
        );
        if (replacement && (projectedSeconds.get(replacement.id) ?? 0) < cand.mins) {
          picked = { position: cand.position, player: cand.player, replacement };
          break;
        }
      }
      if (!picked) break;

      onCourt.set(picked.position, picked.replacement.id);
      usedBenchThisBreak.add(picked.replacement.id);
      plan.push({
        quarter: q,
        time: 0,
        playerOut: picked.player,
        playerIn: picked.replacement,
        position: picked.position,
      });
    }

    for (const id of onCourt.values()) {
      projectedSeconds.set(id, (projectedSeconds.get(id) ?? 0) + quarterSeconds);
    }
  }
  return plan;
};

/**
 * Next un-executed sub that's due **in the current quarter only**.
 *
 * Subs from earlier quarters are intentionally NOT cascaded (N1 audit fix).
 * A missed Q1 sub at 5:00 should not fire 30 seconds into Q2 and yank a
 * fresh starter off court. Quarter-break rotations have a separate path
 * via `handleQuarterEnd`.
 */
export const findNextDueSub = (
  plan: NetballSubEvent[],
  currentQuarter: Quarter,
  elapsedSeconds: number
): NetballSubEvent | undefined => {
  return plan
    .filter((s) => !s.executed && !s.skipped)
    .find((s) => s.quarter === currentQuarter && s.time <= elapsedSeconds);
};

export const formatTime = (seconds: number): string => {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
};

/**
 * Suggest a 7-player lineup for a quarter that:
 *   1. Honours each player's preferredPositions (best fit first)
 *   2. Falls back to zone-compatible candidates
 *   3. Prefers players with the FEWEST minutes already played (fairness)
 *
 * `existingAssignments` lets the caller seed locked positions; suggested
 * picks won't reuse those player ids or overwrite those slots.
 */
export const suggestQuarterLineup = (
  players: NetballPlayer[],
  existingAssignments: Partial<Record<NetballPosition, string>> = {}
): Partial<Record<NetballPosition, string>> => {
  const result: Partial<Record<NetballPosition, string>> = { ...existingAssignments };
  const taken = new Set(Object.values(result).filter(Boolean) as string[]);
  const open = NETBALL_POSITIONS.filter((p) => !result[p]);

  const eligible = players.filter((p) => !p.isInjured);

  type Cand = { position: NetballPosition; player: NetballPlayer; score: number };
  const cands: Cand[] = [];
  for (const position of open) {
    for (const player of eligible) {
      if (taken.has(player.id)) continue;
      const fit = classifySwapFit(player, position);
      if (fit === "violation") continue;
      const fitWeight = fit === "exact" ? 0 : fit === "zone" ? 100 : 200;
      const minutes = player.minutesPlayed ?? 0;
      cands.push({ position, player, score: fitWeight + minutes });
    }
  }
  cands.sort((a, b) => a.score - b.score);

  for (const c of cands) {
    if (result[c.position] || taken.has(c.player.id)) continue;
    result[c.position] = c.player.id;
    taken.add(c.player.id);
  }
  return result;
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
