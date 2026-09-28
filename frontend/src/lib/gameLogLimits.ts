/**
 * Caps for append-only in-memory game logs.
 *
 * A long game with auto-subs every minute can produce hundreds of sub log
 * entries; multiply by the score log and the localStorage payload starts
 * pushing past 100KB per save. We trim the oldest entries to keep state +
 * sync writes fast — undo only needs the most recent few anyway.
 */
export const SUB_LOG_MAX = 200;
export const SCORE_LOG_MAX = 300;
export const CENTRE_PASS_LOG_MAX = 300;

/** Keep the last N entries; preserves order. */
export function trimLog<T>(log: T[] | undefined | null, max: number): T[] {
  if (!log || log.length <= max) return log ?? [];
  return log.slice(log.length - max);
}
