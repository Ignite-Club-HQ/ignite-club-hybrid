/**
 * Regression guard for the "event-group pitch board timer resets to 0" defect.
 *
 * Event-group / mini-league boards (teamId = `event-group-<uuid>`) never reach
 * the server-anchored timer: `pitch-timer-read` filters `active_games.team_id`
 * (a uuid column) so a prefixed id can never match and always returns
 * `found: false`. Those boards therefore rely entirely on
 * `useEventGroupSync`, which mirrors `event_groups.timer_state` into
 * localStorage.
 *
 * Two ways that mirror used to zero a live clock:
 *  1. `event_groups.timer_state` defaults to `{}` — a truthy object — so a row
 *     that has never been written overwrote a locally-advanced board with a
 *     state carrying no `elapsedSeconds`, hydrating the board at 00:00.
 *  2. A realtime "state-changed" signal force-applied whatever the DB held,
 *     even when the local device owned strictly newer progress (peer with a
 *     stale snapshot, or our own write not yet flushed).
 *
 * `shouldApplyRemoteTimerState` is the single decision point: apply remote
 * state only when it is meaningful AND does not move the clock backwards.
 */

export interface LocalEventGroupTimer {
  elapsedSeconds?: number;
  currentHalf?: number;
  isRunning?: boolean;
  isGameFinished?: boolean;
  lastUpdateTime?: number;
}

/**
 * A timer payload is "meaningful" when it actually describes a game clock.
 * `{}` (the column default) and `{ teamId }` are not.
 */
export function isMeaningfulTimerState(t: unknown): boolean {
  if (!t || typeof t !== "object" || Array.isArray(t)) return false;
  const r = t as Record<string, unknown>;
  return (
    typeof r.elapsedSeconds === "number" ||
    typeof r.isRunning === "boolean" ||
    typeof r.currentHalf === "number"
  );
}

/** Projected local elapsed seconds, including drift while running. */
export function projectLocalElapsed(local: LocalEventGroupTimer | null | undefined, nowMs = Date.now()): number {
  if (!local) return 0;
  const base = typeof local.elapsedSeconds === "number" ? Math.max(0, local.elapsedSeconds) : 0;
  if (!local.isRunning || !local.lastUpdateTime) return base;
  return base + Math.max(0, Math.floor((nowMs - local.lastUpdateTime) / 1000));
}

export interface RemoteTimerDecision {
  apply: boolean;
  reason: string;
}

export function shouldApplyRemoteTimerState(args: {
  remote: unknown;
  local: LocalEventGroupTimer | null | undefined;
  /** true when triggered by a realtime signal (previously an unconditional overwrite) */
  force: boolean;
  nowMs?: number;
}): RemoteTimerDecision {
  const { remote, local, force } = args;
  const nowMs = args.nowMs ?? Date.now();

  if (!isMeaningfulTimerState(remote)) {
    return { apply: false, reason: "remote-not-meaningful" };
  }

  // No usable local state → nothing can regress.
  if (!isMeaningfulTimerState(local)) {
    return { apply: true, reason: "no-local-state" };
  }

  // Initial (non-forced) load must not clobber an existing local board.
  if (!force) return { apply: false, reason: "local-state-present" };

  const r = remote as LocalEventGroupTimer;
  const l = local as LocalEventGroupTimer;

  // A finished game is authoritative — always accept full time.
  if (r.isGameFinished && !l.isGameFinished) {
    return { apply: true, reason: "remote-game-finished" };
  }

  // Later half always wins (half-time / 2nd-half transition from a peer).
  const remoteHalf = r.currentHalf ?? 1;
  const localHalf = l.currentHalf ?? 1;
  if (remoteHalf > localHalf) return { apply: true, reason: "remote-newer-half" };
  if (remoteHalf < localHalf) return { apply: false, reason: "remote-older-half" };

  const remoteElapsed = projectLocalElapsed(r, nowMs);
  const localElapsed = projectLocalElapsed(l, nowMs);

  // Same half: never move an advanced clock backwards. A tiny tolerance keeps
  // normal peer jitter from being treated as a regression.
  if (localElapsed > remoteElapsed + 2) {
    return { apply: false, reason: "would-regress-clock" };
  }

  // A remote pause/stop must be backed by a strictly newer write; otherwise a
  // stale snapshot could freeze a running board.
  if (l.isRunning && !r.isRunning) {
    const remoteTs = r.lastUpdateTime ?? 0;
    const localTs = l.lastUpdateTime ?? 0;
    if (remoteTs <= localTs) return { apply: false, reason: "stale-remote-pause" };
  }

  return { apply: true, reason: "remote-accepted" };
}

/**
 * Write-side mirror of `shouldApplyRemoteTimerState`.
 *
 * The read guard only decides what a client ACCEPTS into localStorage; it does
 * nothing to stop a losing writer from clobbering the shared
 * `event_groups.timer_state` row. `useEventGroupSync` writes on a blind 5s
 * `UPDATE`, so two co-admins race last-write-wins: B's tick fires with a
 * snapshot older than A's write and overwrites it. A's own next read rejects
 * the regression, but the ROW stays clobbered — and any third device joining in
 * that window has no local state, so `shouldApplyRemoteTimerState` returns
 * `no-local-state` and hydrates the wrong clock.
 *
 * So before writing, compare against the row we are about to overwrite and
 * refuse when the remote copy is strictly ahead of ours.
 */
export function shouldWriteLocalTimerState(args: {
  local: unknown;
  remote: unknown;
  nowMs?: number;
}): RemoteTimerDecision {
  const { local, remote } = args;
  const nowMs = args.nowMs ?? Date.now();

  // Nothing meaningful remotely (including the `{}` column default) → our write
  // is the first real state for this board.
  if (!isMeaningfulTimerState(remote)) return { apply: true, reason: "remote-not-meaningful" };
  if (!isMeaningfulTimerState(local)) return { apply: false, reason: "local-not-meaningful" };

  const r = remote as LocalEventGroupTimer;
  const l = local as LocalEventGroupTimer;

  if (r.isGameFinished && !l.isGameFinished) {
    return { apply: false, reason: "remote-game-finished" };
  }

  const remoteHalf = r.currentHalf ?? 1;
  const localHalf = l.currentHalf ?? 1;
  if (remoteHalf > localHalf) return { apply: false, reason: "remote-newer-half" };
  if (remoteHalf < localHalf) return { apply: true, reason: "local-newer-half" };

  const remoteElapsed = projectLocalElapsed(r, nowMs);
  const localElapsed = projectLocalElapsed(l, nowMs);

  // Same tolerance as the read guard, so the two can never disagree about
  // which side is "ahead" for the same pair of snapshots.
  if (remoteElapsed > localElapsed + 2) {
    return { apply: false, reason: "would-regress-remote-clock" };
  }

  // Don't let our stale "still running" snapshot resurrect a peer's pause.
  if (r.isRunning === false && l.isRunning && (l.lastUpdateTime ?? 0) <= (r.lastUpdateTime ?? 0)) {
    return { apply: false, reason: "stale-local-resume" };
  }

  return { apply: true, reason: "local-accepted" };
}

