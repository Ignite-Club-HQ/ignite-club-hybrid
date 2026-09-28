/**
 * Instrumentation for the Home screen open path.
 *
 * Mirrors `inboxOpenLatency.ts` but scoped to `/` so we can attribute
 * "home is slow to open" between cold-start stages, mount, query return
 * and first paint (unified skeleton → real content reveal).
 *
 * One sample per page open. Any failure is swallowed.
 */
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { mark as coldMark, snapshotStages, logStagesToConsole } from "./coldStartMarks";

export type HomePerfSource = "cold_open" | "warm_nav" | "notification";

interface LogArgs {
  source: HomePerfSource;
  /** Reference timestamp (ms epoch) — when the home open started (route landing / tap). */
  startTs: number;
  cacheHit: boolean;
  /** Per-open timestamps (Date.now()). Preferred over `coldMark` deltas
   *  because those are first-write-wins per JS session and go stale on
   *  subsequent opens. */
  mountTs?: number | null;
  queryReturnTs?: number | null;
  firstPaintTs?: number | null;
  context: {
    clubCount: number;
    teamCount: number;
    upcomingEvents: number;
    activeClubFilter: string | null;
    isNewUserEmptyState: boolean;
  };
  /** Resolved "primary" club for this open (active filter → first membership). */
  primaryClubId?: string | null;
  userId?: string | null;
}

let logged = false;

/** Reset when the user leaves `/` so the next open logs again. */
export function resetHomeOpenLog(): void {
  logged = false;
}

export async function logHomeOpenLatency(args: LogArgs): Promise<void> {
  try {
    if (logged) return;
    if (!args.userId) return;
    logged = true;

    coldMark("home_first_paint");
    const tap_to_paint_ms = Math.max(0, Math.round(Date.now() - args.startTs));
    if (tap_to_paint_ms > 60_000) return;

    let platform = "web";
    try {
      platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    } catch {}

    const snap = snapshotStages();
    const deltas = snap.deltas;
    // Prefer fresh per-open timings; fall back to (potentially stale) coldMark deltas.
    const query_ms =
      args.mountTs != null && args.queryReturnTs != null
        ? Math.max(0, Math.round(args.queryReturnTs - args.mountTs))
        : deltas.home_query_return != null && deltas.home_mount != null
          ? Math.max(0, deltas.home_query_return - deltas.home_mount)
          : null;
    const first_paint_ms =
      args.mountTs != null && args.firstPaintTs != null
        ? Math.max(0, Math.round(args.firstPaintTs - args.mountTs))
        : deltas.home_first_paint != null && deltas.home_mount != null
          ? Math.max(0, deltas.home_first_paint - deltas.home_mount)
          : null;

    const stages = snap.anchor !== null
      ? { anchor: snap.anchor, nav_ms: snap.nav_ms ?? 0, ...deltas, total_ms: tap_to_paint_ms }
      : null;

    logStagesToConsole(`homeOpen:${args.source}`);

    const doInsert = () => {
      void (supabase as any).from("home_open_perf").insert({
        user_id: args.userId!,
        source: args.source,
        tap_to_paint_ms,
        query_ms,
        first_paint_ms,
        cache_hit: args.cacheHit,
        context: args.context,
        platform,
        stages,
        primary_club_id: args.primaryClubId ?? null,
      }).then(() => {}, () => {});
    };

    // Fire immediately — deferring drops writes on Android WebView when the app
    // is backgrounded before the idle/timeout callback runs.
    doInsert();
  } catch {
    // ignore
  }
}
