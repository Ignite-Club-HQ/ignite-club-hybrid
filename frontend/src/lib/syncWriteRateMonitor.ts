/**
 * Client-side write-rate monitor for active_games sync hooks.
 *
 * Each sync hook (basketball, netball, soccer) calls `recordWrite()` whenever
 * it actually pushes a row to Supabase. If the same (user, team) pair exceeds
 * STORM_THRESHOLD writes within WINDOW_MS we:
 *   - console.warn once per cooldown
 *   - flag the local sync status with an explanatory error (so the existing
 *     SyncStatusIndicator UI surfaces it)
 *   - return true so callers can short-circuit further writes if they want
 *
 * This is the local mirror of the DB trigger `log_active_game_write` —
 * it catches the storm BEFORE the writes hit the network, which is what we
 * actually want to prevent at scale.
 */
import { setSyncStatus } from "@/hooks/useSyncStatus";

const WINDOW_MS = 60_000;
// Normal cadence is one sync per 10s = 6/min. Anything above 30/min means
// something is genuinely looping (effect re-running, signature broken, etc).
const STORM_THRESHOLD = 30;
const ALERT_COOLDOWN_MS = 10 * 60_000;

interface BucketState {
  timestamps: number[];
  lastAlertAt: number;
}

const buckets = new Map<string, BucketState>();

function bucketKey(userId: string, teamId: string | null): string {
  return `${userId}::${teamId ?? "_no_team"}`;
}

/**
 * Records a single write. Returns true if the write should be considered
 * part of a storm (caller may choose to throttle the next interval).
 */
export function recordSyncWrite(opts: {
  userId: string;
  teamId: string | null;
  source: "basketball" | "netball" | "soccer";
}): boolean {
  const { userId, teamId, source } = opts;
  const now = Date.now();
  const key = bucketKey(userId, teamId);
  const bucket = buckets.get(key) ?? { timestamps: [], lastAlertAt: 0 };

  // Sliding window prune.
  const cutoff = now - WINDOW_MS;
  bucket.timestamps = bucket.timestamps.filter((t) => t > cutoff);
  bucket.timestamps.push(now);
  buckets.set(key, bucket);

  if (bucket.timestamps.length < STORM_THRESHOLD) return false;

  // Throttle the warn so we don't spam the console once a storm starts.
  if (now - bucket.lastAlertAt < ALERT_COOLDOWN_MS) return true;
  bucket.lastAlertAt = now;

  const msg =
    `[sync-storm] ${source} board wrote ${bucket.timestamps.length} times in the last 60s ` +
    `for team=${teamId ?? "(none)"} user=${userId}. Expected ~6/min.`;
  console.warn(msg);
  setSyncStatus({
    status: "error",
    lastSyncTime: now,
    error: `Sync rate too high (${bucket.timestamps.length}/min). Investigate.`,
  });
  return true;
}

/** Test-only helper. */
export function __resetSyncWriteRateMonitor() {
  buckets.clear();
}
