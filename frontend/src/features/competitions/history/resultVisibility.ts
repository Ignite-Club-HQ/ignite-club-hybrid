/** Nullable protected results are not zero-score draws. Never coerce null to 0. */
export function resultOutcome(home: number | null, away: number | null): "WIN" | "LOSS" | "DRAW" | null {
  if (home === null || away === null || !Number.isFinite(home) || !Number.isFinite(away)) return null;
  return home > away ? "WIN" : home < away ? "LOSS" : "DRAW";
}

export function optionalScore(value: unknown): number | null {
  if (Array.isArray(value)) return value.length ? optionalScore(value[0]) : null;
  if (value === null || value === undefined) return null;
  const score = Number(value);
  return Number.isFinite(score) ? score : null;
}