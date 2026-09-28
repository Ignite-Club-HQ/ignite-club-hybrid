/**
 * Instrumentation for the Schedule (Events) screen open path.
 *
 * Mirrors `inboxOpenLatency.ts`. Scoped to `/events` so we can attribute
 * "schedule is slow to open" between cold-start stages, mount, primary
 * events query return, and first paint.
 *
 * One sample per page open. Any failure is swallowed.
 */
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { mark as coldMark, snapshotStages, logStagesToConsole, getMarkTs } from "./coldStartMarks";

export type SchedulePerfSource = "cold_open" | "warm_nav" | "notification";

interface LogArgs {
  source: SchedulePerfSource;
  startTs: number;
  cacheHit: boolean;
  mountTs?: number | null;
  queryReturnTs?: number | null;
  firstPaintTs?: number | null;
  context: {
    viewMode: "list" | "calendar";
    filter: string;
    clubFilter: string | null;
    teamFilter: string | null;
    eventCount: number;
  };
  primaryClubId?: string | null;
  userId?: string | null;
}

let logged = false;

export function resetScheduleOpenLog(): void {
  logged = false;
}

export async function logScheduleOpenLatency(args: LogArgs): Promise<void> {
  try {
    if (logged) return;
    if (!args.userId) return;
    logged = true;

    coldMark("schedule_first_paint");

    // Rebase startTs for cold/notification opens so tap_to_paint_ms includes
    // the pre-mount waterfall (webview boot, JS parse, auth resolve, route).
    let startTs = args.startTs;
    if (args.source === "cold_open" || args.source === "notification") {
      const notifTs = getMarkTs("notif_tap");
      const bootTs = getMarkTs("boot");
      const originTs =
        typeof performance !== "undefined" && performance.timeOrigin
          ? Math.round(performance.timeOrigin)
          : null;
      startTs = [notifTs, bootTs, originTs, args.startTs]
        .filter((v): v is number => typeof v === "number" && v > 0)
        .reduce((a, b) => Math.min(a, b), args.startTs);
    }

    const tap_to_paint_ms = Math.max(0, Math.round(Date.now() - startTs));
    if (tap_to_paint_ms > 120_000) return;

    let platform = "web";
    try {
      platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    } catch {}

    const snap = snapshotStages();
    const deltas = snap.deltas;
    const query_ms =
      args.mountTs != null && args.queryReturnTs != null
        ? Math.max(0, Math.round(args.queryReturnTs - args.mountTs))
        : deltas.schedule_query_return != null && deltas.schedule_mount != null
          ? Math.max(0, deltas.schedule_query_return - deltas.schedule_mount)
          : null;
    const first_paint_ms =
      args.mountTs != null && args.firstPaintTs != null
        ? Math.max(0, Math.round(args.firstPaintTs - args.mountTs))
        : deltas.schedule_first_paint != null && deltas.schedule_mount != null
          ? Math.max(0, deltas.schedule_first_paint - deltas.schedule_mount)
          : null;

    const bootTs = getMarkTs("boot");
    const notifTs = getMarkTs("notif_tap");
    const authReadyTs = getMarkTs("auth_ready");
    const originTs =
      typeof performance !== "undefined" && performance.timeOrigin
        ? Math.round(performance.timeOrigin)
        : null;
    const fresh = {
      origin_from_start_ms: originTs != null ? originTs - startTs : null,
      boot_from_start_ms: bootTs != null ? bootTs - startTs : null,
      notif_tap_from_start_ms: notifTs != null ? notifTs - startTs : null,
      auth_ready_from_start_ms: authReadyTs != null ? authReadyTs - startTs : null,
      mount_from_start_ms: args.mountTs != null ? args.mountTs - startTs : null,
      query_return_from_start_ms:
        args.queryReturnTs != null ? args.queryReturnTs - startTs : null,
      first_paint_from_start_ms:
        args.firstPaintTs != null ? args.firstPaintTs - startTs : null,
    };

    const stages = snap.anchor !== null
      ? {
          anchor: snap.anchor,
          nav_ms: snap.nav_ms ?? 0,
          ...deltas,
          fresh,
          rebased_start_ts: startTs,
          total_ms: tap_to_paint_ms,
        }
      : { fresh, rebased_start_ts: startTs, total_ms: tap_to_paint_ms };

    logStagesToConsole(`scheduleOpen:${args.source}`);

    const doInsert = () => {
      void (supabase as any).from("schedule_open_perf").insert({
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
