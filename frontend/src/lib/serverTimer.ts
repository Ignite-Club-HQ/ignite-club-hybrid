// Client wrapper for the server-anchored pitch timer.
// The server is the source of truth for elapsed time — clients only render.
// Drift is impossible because elapsed is derived as
//   (paused ? half_paused_at : now()) - half_started_at - accumulated_pause_ms
// Phase 1: helpers only. Phase 2 will wire these into GameTimer / Widget.
import { supabase } from "@/integrations/supabase/client";

export interface ServerTimer {
  schema_version: 2;
  current_half: 1 | 2;
  minutes_per_half: number;
  half_started_at: string | null;
  half_paused_at: string | null;
  accumulated_pause_ms: number;
  is_running: boolean;
  is_game_finished: boolean;
  half_ended_at: string | null;
  last_event_at: string;
}

export type TimerEvent =
  | "start_half"
  | "pause"
  | "resume"
  | "end_half"
  | "start_half_2"
  | "end_game"
  | "adjust"
  | "set_minutes"
  | "reset";

export interface TimerEventResponse {
  ok: true;
  row_id: string;
  timer_state: ServerTimer;
  elapsed_seconds: number;
  server_now: string;
}

export interface TimerReadResponse {
  found: boolean;
  row_id?: string;
  team_id?: string | null;
  timer_state?: ServerTimer;
  pitch_state?: unknown;
  elapsed_seconds?: number;
  server_now: string;
}

/**
 * Compute elapsed seconds from a ServerTimer using a reference timestamp.
 * Pass `serverNowMs` from the most recent read so the value is anchored
 * to server time and immune to device clock skew.
 */
export function deriveElapsedSeconds(
  t: ServerTimer | null | undefined,
  referenceMs: number = Date.now(),
): number {
  if (!t?.half_started_at) return 0;
  const start = new Date(t.half_started_at).getTime();
  const ref = t.half_paused_at ? new Date(t.half_paused_at).getTime() : referenceMs;
  const ms = Math.max(0, ref - start - (t.accumulated_pause_ms || 0));
  return Math.min(Math.floor(ms / 1000), (t.minutes_per_half || 0) * 60);
}

/**
 * A row is only safe to hydrate from when it carries the FULL server-anchored
 * shape. Legacy sync paths used to write `{ elapsedSeconds, lastUpdateTime,
 * schema_version: 2 }` over the top of a real v2 row: it passes a naive
 * `schema_version === 2` check but has no `half_started_at` / `last_event_at`,
 * so elapsed derives to 0 and the board hydrates at 00:00 after a resume.
 * Treat those rows as absent and fall back to the local projection instead.
 */
export function isServerAnchoredTimer(t: unknown): t is ServerTimer {
  if (!t || typeof t !== "object") return false;
  const r = t as Record<string, unknown>;
  if (r.schema_version !== 2) return false;
  if (typeof r.last_event_at !== "string" || !Number.isFinite(new Date(r.last_event_at).getTime())) return false;
  if (!("half_started_at" in r)) return false;
  if (r.half_started_at !== null && typeof r.half_started_at !== "string") return false;
  if (typeof r.is_running !== "boolean") return false;
  if (typeof r.minutes_per_half !== "number" || r.minutes_per_half <= 0) return false;
  return true;
}

/**
 * Marker-only detection, deliberately looser than `isServerAnchoredTimer`.
 *
 * Used to decide whether a LEGACY (v1) writer is allowed to publish
 * `timer_state` at all. It must return true even for a half-written or
 * already-clobbered v2 row (`{ elapsedSeconds, schema_version: 2 }`), because
 * such a row still belongs to a server-anchored board — overwriting it with a
 * v1 payload is what strands the board at 00:00. Recovery of a clobbered row is
 * the job of `pitch-timer-event` (`fromLegacyTimerState`), never of a v1 sync.
 */
export function hasAnchoredTimerMarker(t: unknown): boolean {
  if (!t || typeof t !== "object") return false;
  return (t as Record<string, unknown>).schema_version === 2;
}

/**
 * Whether a legacy (v1) sync loop may include `timer_state` in its write.
 *
 * Gating on the LOCAL localStorage shape alone is not sufficient, and was a
 * live reset path: `active_games` rows are shared per team, so a second device
 * (or a tab that never loaded the v2 writer) holds v1 localStorage, decides
 * "not anchored", adopts the team's existing row by `team_id` and republishes a
 * v1 `timer_state` over the authoritative anchored row. The next read derives
 * elapsed 0 and every device resets to 00:00 mid-match.
 *
 * So the write is only permitted when NEITHER side shows an anchored marker.
 * `pitch_state` is unaffected — the cron still needs autoSubPlan / players.
 */
export function mayWriteLegacyTimerState(args: { local: unknown; remote: unknown }): boolean {
  return !hasAnchoredTimerMarker(args.local) && !hasAnchoredTimerMarker(args.remote);
}

/**
 * First-hydrate protection. `shouldAcceptServerSnapshot` has no previous
 * snapshot to compare against on mount, so a stale/zeroed server row would be
 * accepted unconditionally and wipe a locally-persisted running clock.
 * Prefer the local projection when the server row would regress it AND the
 * local snapshot was written after the server's last event.
 */
export function shouldPreferLocalOnFirstHydrate(args: {
  incoming: ServerTimer;
  serverNowMs: number;
  localElapsedSeconds: number;
  localCurrentHalf: 1 | 2;
  localIsRunning: boolean;
  localLastUpdateMs: number;
  toleranceSeconds?: number;
}): boolean {
  const tolerance = args.toleranceSeconds ?? 5;
  if (!args.localIsRunning && args.localElapsedSeconds <= 0) return false;
  const lastEventMs = new Date(args.incoming.last_event_at).getTime();
  if (!Number.isFinite(lastEventMs) || !Number.isFinite(args.localLastUpdateMs)) return false;
  // The server has newer authoritative information — always defer to it.
  if (lastEventMs >= args.localLastUpdateMs) return false;
  const sameHalf = (args.incoming.current_half ?? 1) === args.localCurrentHalf;
  if (!sameHalf) return false;
  if (args.incoming.is_game_finished) return false;
  const serverElapsed = deriveElapsedSeconds(args.incoming, args.serverNowMs);
  return serverElapsed + tolerance < args.localElapsedSeconds;
}

/**
 * `active_games.team_id` is a uuid column, so a synthetic board id like
 * `event-group-<uuid>` (mini-league / event-group boards) can never match it.
 * Those boards are synced through `useEventGroupSync` instead. Calling the
 * edge functions with a non-uuid id is guaranteed to fail (invalid uuid →
 * 403 forbidden) on every tick, which is pure noise and — worse — makes the
 * `.catch()` paths indistinguishable from real network failures.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export function isServerTimerEligibleTeamId(teamId: string | null): boolean {
  if (teamId === null) return true; // personal / null-team board
  return UUID_RE.test(teamId);
}

export async function sendTimerEvent(args: {

  teamId: string | null;
  event: TimerEvent;
  minutesPerHalf?: number;
  payload?: Record<string, unknown>;
  /**
   * Optional pitch_state patch persisted server-side alongside the timer
   * event. Use to keep `autoSubPlan` / `players` fresh for the pending-sub
   * cron even when the board hasn't been linked to an event (so
   * `GlobalSubMonitor`'s own DB sync is skipped).
   */
  autoSubPlan?: unknown[];
  autoSubActive?: boolean;
  players?: unknown[];
}): Promise<TimerEventResponse> {
  if (!isServerTimerEligibleTeamId(args.teamId)) {
    throw new Error("server-timer-not-applicable");
  }
  const { data, error } = await supabase.functions.invoke("pitch-timer-event", {

    body: {
      team_id: args.teamId,
      event: args.event,
      minutes_per_half: args.minutesPerHalf,
      payload: args.payload ?? {},
      ...(args.autoSubPlan !== undefined ? { auto_sub_plan: args.autoSubPlan } : {}),
      ...(args.autoSubActive !== undefined ? { auto_sub_active: args.autoSubActive } : {}),
      ...(args.players !== undefined ? { players: args.players } : {}),
    },
  });
  if (error) throw error;
  return data as TimerEventResponse;
}

export async function readServerTimer(teamId: string | null): Promise<TimerReadResponse> {
  // Skip if user is not authenticated OR the access token is expired —
  // avoids 401 blank-screen reports on /auth, during sign-out, and when
  // a stale session is still in localStorage but auto-refresh hasn't run.
  const empty: TimerReadResponse = { found: false, server_now: new Date().toISOString() };
  if (!isServerTimerEligibleTeamId(teamId)) return empty;
  let accessToken: string | null = null;

  try {
    const { data: sessionData } = await supabase.auth.getSession();
    const session = sessionData?.session;
    if (!session?.access_token) return empty;
    const expiresAt = session.expires_at ?? 0;
    const nowSec = Math.floor(Date.now() / 1000);
    // If the token is expired (or about to be), skip — don't risk a 401.
    if (expiresAt && expiresAt - nowSec <= 5) return empty;
    accessToken = session.access_token;
  } catch {
    return empty;
  }

  const qs = teamId ? `?team_id=${encodeURIComponent(teamId)}` : "";
  try {
    // Use raw fetch with an explicit Authorization header so we never fall
    // back to the anon key (which is what triggers the 401 -> blank-screen
    // runtime-error report in the Lovable preview).
    const base = (import.meta.env.VITE_SUPABASE_URL || "").replace(/\/$/, "");
    const res = await fetch(`${base}/functions/v1/pitch-timer-read${qs}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY || "",
      },
    });
    if (!res.ok) return empty;
    return (await res.json()) as TimerReadResponse;
  } catch {
    return empty;
  }
}

/**
 * Returns the offset (ms) to add to Date.now() to approximate server time.
 * Use the most recent read for skew correction in the visual tick.
 */
export function computeClockSkewMs(serverNowIso: string): number {
  return new Date(serverNowIso).getTime() - Date.now();
}

/**
 * Local snapshot of the *displayed* timer state at the moment a server read
 * resolves. Used by `shouldAcceptServerSnapshot` to detect stale/racing reads
 * that would move an active clock backwards.
 */
export interface LocalTimerSnapshot {
  isRunning: boolean;
  currentHalf: 1 | 2;
  elapsedSeconds: number;
  isGameFinished: boolean;
}

/**
 * Guard against stale / out-of-order server snapshots overwriting a live
 * timer. Rules (in order):
 *
 *   1. No previous accepted snapshot → accept (first hydrate).
 *   2. Strictly newer `last_event_at` → accept (authoritative newer event).
 *   3. Equal `last_event_at`, and the incoming snapshot doesn't zero out a
 *      locally-advanced clock → accept (idempotent re-read).
 *   4. Otherwise reject. In particular a snapshot with an older or equal
 *      `last_event_at` that would move a running/advanced local clock
 *      backwards to zero is rejected — this is the "stale zero on resume"
 *      failure mode.
 *
 * A legitimate manual reset always propagates because `pitch-timer-event`
 * bumps `last_event_at` at the same time it zeroes the state, so rule (2)
 * matches. Half transitions and `set_minutes` behave the same way.
 */
export function shouldAcceptServerSnapshot(
  prev: Pick<ServerTimer, "last_event_at"> | null | undefined,
  incoming: ServerTimer,
  local?: LocalTimerSnapshot,
): { accept: boolean; reason: string } {
  const incomingIsZero =
    !incoming.is_running &&
    !incoming.half_started_at &&
    (incoming.current_half ?? 1) === 1 &&
    !incoming.is_game_finished;
  const localAdvanced = !!local && (local.isRunning || local.elapsedSeconds > 0 || local.currentHalf === 2 || local.isGameFinished);

  if (!prev?.last_event_at) {
    // First hydrate has no previous event timestamp to compare against, so it
    // used to be accepted unconditionally. That reopened the "resets to 0 on
    // resume" defect on any path where the mount hydrate deliberately kept the
    // local projection (serverTimerRef stays null) and a later resume read the
    // same clobbered/zeroed row. A zero row can never legitimately describe a
    // board that is visibly mid-match: refuse it and keep the local clock.
    if (incomingIsZero && localAdvanced) {
      return { accept: false, reason: "stale-zero-at-first-hydrate" };
    }
    return { accept: true, reason: "first-hydrate" };
  }

  const prevMs = new Date(prev.last_event_at).getTime();
  const nextMs = new Date(incoming.last_event_at).getTime();


  // Backwards-movement guard: reject any incoming snapshot whose derived
  // elapsed would regress the currently displayed clock in the same half,
  // regardless of `last_event_at`. Legitimate resets / half transitions
  // change `current_half` OR clear `half_started_at` under a newer event
  // timestamp, which is handled explicitly below.
  const REGRESSION_TOLERANCE_SEC = 2;
  if (local && Number.isFinite(nextMs) && Number.isFinite(prevMs)) {
    const incomingElapsed = deriveElapsedSeconds(incoming, nextMs);
    const sameHalf = (incoming.current_half ?? 1) === local.currentHalf;
    const wouldRegress = sameHalf && incomingElapsed + REGRESSION_TOLERANCE_SEC < local.elapsedSeconds;
    // Only enforce when the incoming isn't strictly newer AND either running
    // locally or paused with non-zero elapsed. Newer events (manual reset,
    // half transition) are always authoritative.
    if (wouldRegress && nextMs <= prevMs && localAdvanced) {
      return { accept: false, reason: "would-regress-displayed-elapsed" };
    }
  }

  if (Number.isFinite(nextMs) && Number.isFinite(prevMs)) {
    if (nextMs > prevMs) return { accept: true, reason: "newer-event" };
    if (nextMs === prevMs) {
      if (incomingIsZero && localAdvanced) {
        return { accept: false, reason: "stale-zero-at-equal-timestamp" };
      }
      // At equal timestamps, require materially-equivalent state to accept
      // an idempotent re-read. Divergent half_started_at / current_half /
      // is_running / accumulated_pause_ms with the same `last_event_at`
      // means one of the two snapshots is corrupt or racy — refuse to
      // overwrite the accepted state.
      if (prev && "half_started_at" in (prev as ServerTimer)) {
        const p = prev as ServerTimer;
        const stateMatches =
          p.half_started_at === incoming.half_started_at &&
          p.current_half === incoming.current_half &&
          p.is_running === incoming.is_running &&
          (p.accumulated_pause_ms || 0) === (incoming.accumulated_pause_ms || 0) &&
          p.is_game_finished === incoming.is_game_finished;
        if (!stateMatches) {
          return { accept: false, reason: "divergent-state-at-equal-timestamp" };
        }
      }
      return { accept: true, reason: "idempotent-reread" };
    }
  }

  if (localAdvanced) return { accept: false, reason: "older-event-while-local-advanced" };
  return { accept: false, reason: "older-event" };
}

