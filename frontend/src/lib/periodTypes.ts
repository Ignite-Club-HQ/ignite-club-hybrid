/**
 * Period type helpers — shared between basketball + netball boards.
 * "Quarters" = 4 periods (default for both sports).
 * "Halves" = 2 periods (junior leagues, half-court formats).
 *
 * The underlying timer state still tracks `currentQuarter` 1..4 for
 * compatibility, but in halves mode we map Q1↔H1, Q3↔H2, and skip
 * Q2 / Q4 entirely.
 */

/** Self-contained period-type union (avoids circular sport-type imports). */
export type PeriodType = "quarters" | "halves";

export const periodCount = (pt: PeriodType | undefined): number =>
  pt === "halves" ? 2 : 4;

/** "Q" or "H" — used as the prefix in timer chips and lineup tabs. */
export const periodPrefix = (pt: PeriodType | undefined): "Q" | "H" =>
  pt === "halves" ? "H" : "Q";

/**
 * Display label for the current period given the underlying quarter slot
 * (1..4) and the period type.
 *  - quarters: "Q1", "Q2", "Q3", "Q4"
 *  - halves:   "H1", "H1", "H2", "H2"  (so a runaway timer never shows "Q3" in halves mode)
 */
export const periodLabel = (
  quarter: 1 | 2 | 3 | 4,
  pt: PeriodType | undefined
): string => {
  if (pt === "halves") return `H${quarter <= 2 ? 1 : 2}`;
  return `Q${quarter}`;
};

/** All period slots (1..4) that are user-facing for the given period type. */
export const visiblePeriods = (pt: PeriodType | undefined): (1 | 2 | 3 | 4)[] =>
  pt === "halves" ? [1, 3] : [1, 2, 3, 4];

/**
 * Cumulative elapsed seconds across the whole game so far, accounting for
 * the period type. In halves mode the underlying quarter slot jumps Q1→Q3,
 * so we must NOT multiply by `(currentQuarter - 1)` blindly — that double-
 * counts H1's length.
 *
 *   quarters: Q1=0, Q2=1×len, Q3=2×len, Q4=3×len
 *   halves:   H1 (q=1) = 0,   H2 (q=3) = 1×len
 */
export const totalElapsedSeconds = (
  currentQuarter: 1 | 2 | 3 | 4,
  elapsedSeconds: number,
  minutesPerPeriod: number,
  pt: PeriodType | undefined
): number => {
  const periods = visiblePeriods(pt);
  const idx = Math.max(0, periods.indexOf(currentQuarter));
  return elapsedSeconds + idx * minutesPerPeriod * 60;
};

