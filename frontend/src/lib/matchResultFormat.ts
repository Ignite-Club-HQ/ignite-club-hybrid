/**
 * Sport-aware result-sentence formatter.
 *
 * Produces the "X won 3–1" / "U10 Blue won by 22 runs" style sentence
 * that appears on the result summary card and in the post-save toast.
 * Pure function — given the saved game_results shape and labels, it
 * picks the right wording for the sport.
 */

import type { SportScoreConfig } from "./sportScoreConfig";

export interface FormatInput {
  config: SportScoreConfig;
  homeLabel: string;
  awayLabel: string;
  homeScore: number;
  awayScore: number;
  /** game_results.period_scores raw value (object or array). */
  periodScores?: unknown;
}

const isObj = (v: unknown): v is Record<string, any> =>
  !!v && typeof v === "object" && !Array.isArray(v);
const isArr = (v: unknown): v is any[] => Array.isArray(v);

/** AFL G.B (Total) e.g. "8.10 (58)". */
const aflLine = (
  pts: number,
  side: any
): string => {
  const g = Number(side?.goals ?? Math.floor(pts / 6));
  const b = Number(side?.behinds ?? Math.max(0, pts - g * 6));
  return `${g}.${b} (${pts})`;
};

/** Cricket runs/wickets e.g. "120/6" or "98 all out". */
const cricketLine = (runs: number, side: any) => {
  const w = side?.wickets;
  const overs = side?.overs;
  let body: string;
  if (w === undefined || w === null || w === "") body = `${runs}`;
  else if (Number(w) >= 10) body = `${runs} all out`;
  else body = `${runs}/${w}`;
  if (overs !== undefined && overs !== null && overs !== "")
    body += ` (${overs} ov)`;
  return body;
};

export const formatScoreLine = (i: FormatInput): string => {
  const { config, homeLabel, awayLabel, homeScore, awayScore, periodScores } = i;

  if (config.scoreLayout === "afl") {
    const ps = isObj(periodScores) ? periodScores : {};
    return `${homeLabel} ${aflLine(homeScore, ps.home)} – ${aflLine(
      awayScore,
      ps.away
    )} ${awayLabel}`;
  }

  if (config.scoreLayout === "cricket") {
    const ps = isObj(periodScores) ? periodScores : {};
    return `${homeLabel} ${cricketLine(homeScore, ps.home)} vs ${cricketLine(
      awayScore,
      ps.away
    )} ${awayLabel}`;
  }

  if (config.scoreLayout === "sets") {
    return `${homeLabel} ${homeScore} – ${awayScore} ${awayLabel} in sets`;
  }

  return `${homeLabel} ${homeScore} – ${awayScore} ${awayLabel}`;
};

/** "Riverside won 3–1" / "Draw 2–2" / "Won by 22 runs". */
export const formatResultSentence = (i: FormatInput): string => {
  const { config, homeLabel, awayLabel, homeScore, awayScore, periodScores } = i;
  const homeWon = homeScore > awayScore;
  const awayWon = awayScore > homeScore;
  const winner = homeWon ? homeLabel : awayWon ? awayLabel : null;

  if (!winner) {
    if (config.scoreLayout === "sets")
      return `Draw ${homeScore}–${awayScore} in sets`;
    return `Draw ${homeScore}–${awayScore}`;
  }

  if (config.scoreLayout === "cricket") {
    const ps = isObj(periodScores) ? periodScores : {};
    // Loser's wickets determine "won by N wickets" framing only when the
    // winning side batted second; we don't track innings order, so fall
    // back to a simple run margin which is unambiguous either way.
    const margin = Math.abs(homeScore - awayScore);
    void ps;
    return `${winner} won by ${margin} ${margin === 1 ? "run" : "runs"}`;
  }

  if (config.scoreLayout === "sets")
    return `${winner} won ${Math.max(homeScore, awayScore)}–${Math.min(
      homeScore,
      awayScore
    )} in sets`;

  if (config.scoreLayout === "afl")
    return `${winner} won by ${Math.abs(homeScore - awayScore)} points`;

  return `${winner} won ${Math.max(homeScore, awayScore)}–${Math.min(
    homeScore,
    awayScore
  )}`;
};

export type ResultOutcome = "win" | "loss" | "draw";

export const outcomeFor = (home: number, away: number): ResultOutcome =>
  home > away ? "win" : home < away ? "loss" : "draw";
