/**
 * Instrumentation for the Messages inbox open path.
 *
 * Mirrors `chatOpenLatency.ts` but scoped to the /messages route so we can
 * attribute "inbox is slow to open" between:
 *   - cold-start stages (boot / notif_tap / auth_ready)
 *   - inbox_mount (component actually rendered)
 *   - inbox_bootstrap_return (messages-page bootstrap RPC resolved)
 *   - inbox_first_paint (first conversation row painted)
 *
 * Also records whether the disk cache was hit, whether the bootstrap RPC
 * kill-switch is engaged, and a coarse section-count snapshot so we can spot
 * outliers (users with many teams/clubs/groups where hydrate dominates).
 *
 * Best-effort — any failure is swallowed. One sample per page open, gated
 * by an in-module flag so re-renders don't multi-log.
 */
import { supabase } from "@/integrations/supabase/client";
import { Capacitor } from "@capacitor/core";
import { mark as coldMark, snapshotStages, logStagesToConsole, getMarkTs } from "./coldStartMarks";

export type InboxPerfSource = "cold_open" | "warm_nav" | "notification";

interface LogArgs {
  source: InboxPerfSource;
  /** Reference timestamp (ms epoch) — when the inbox open started (route landing / tap).
   *  For `cold_open`/`notification` this is rebased below to the earliest observed
   *  signal (notif_tap → boot → performance.timeOrigin) so tap_to_paint_ms includes
   *  the pre-mount waterfall (webview init, JS bundle parse, auth resolve, route settle). */
  startTs: number;
  cacheHit: boolean;
  bootstrapEnabled: boolean;
  mountTs?: number | null;
  bootstrapReturnTs?: number | null;
  firstPaintTs?: number | null;
  sectionCounts: {
    teams: number;
    clubs: number;
    groups: number;
    dms: number;
    total: number;
  };
  primaryClubId?: string | null;
  userId?: string | null;
}

let logged = false;

/** Reset when the user leaves /messages so the next open logs again. */
export function resetInboxOpenLog(): void {
  logged = false;
}

export async function logInboxOpenLatency(args: LogArgs): Promise<void> {
  try {
    if (logged) return;
    if (!args.userId) return;
    logged = true;

    coldMark("inbox_first_paint");

    // Rebase startTs for non-warm opens so tap_to_paint_ms captures the
    // pre-mount prefix. Warm SPA navs stay as-is (mount time is correct).
    let startTs = args.startTs;
    if (args.source === "cold_open" || args.source === "notification") {
      const notifTs = getMarkTs("notif_tap");
      const bootTs = getMarkTs("boot");
      const originTs =
        typeof performance !== "undefined" && performance.timeOrigin
          ? Math.round(performance.timeOrigin)
          : null;
      const earliest = [notifTs, bootTs, originTs, args.startTs]
        .filter((v): v is number => typeof v === "number" && v > 0)
        .reduce((a, b) => Math.min(a, b), args.startTs);
      startTs = earliest;
    }

    const tap_to_paint_ms = Math.max(0, Math.round(Date.now() - startTs));
    if (tap_to_paint_ms > 120_000) return; // sanity bound

    let platform = "web";
    try {
      platform = Capacitor.isNativePlatform() ? Capacitor.getPlatform() : "web";
    } catch {}

    const snap = snapshotStages();
    const deltas = snap.deltas;
    // Prefer fresh per-open timings; fall back to (potentially stale) coldMark deltas.
    const bootstrap_ms =
      args.mountTs != null && args.bootstrapReturnTs != null
        ? Math.max(0, Math.round(args.bootstrapReturnTs - args.mountTs))
        : deltas.inbox_bootstrap_return != null && deltas.inbox_mount != null
          ? Math.max(0, deltas.inbox_bootstrap_return - deltas.inbox_mount)
          : null;
    const first_paint_ms =
      args.mountTs != null && args.firstPaintTs != null
        ? Math.max(0, Math.round(args.firstPaintTs - args.mountTs))
        : deltas.inbox_first_paint != null && deltas.inbox_mount != null
          ? Math.max(0, deltas.inbox_first_paint - deltas.inbox_mount)
          : null;

    // Raw per-stage timestamps computed relative to `startTs` (the true open
    // anchor). Unlike snapshotStages().deltas (anchored to first-write boot,
    // which can go stale for later opens), these are always fresh because
    // startTs itself is rebased per open above.
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
      bootstrap_return_from_start_ms:
        args.bootstrapReturnTs != null ? args.bootstrapReturnTs - startTs : null,
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

    logStagesToConsole(`inboxOpen:${args.source}`);

    const doInsert = () => {
      void supabase.from("inbox_open_perf").insert({
        user_id: args.userId!,
        source: args.source,
        tap_to_paint_ms,
        bootstrap_ms,
        first_paint_ms,
        cache_hit: args.cacheHit,
        bootstrap_enabled: args.bootstrapEnabled,
        section_counts: args.sectionCounts as any,
        platform,
        stages: stages as any,
        primary_club_id: args.primaryClubId ?? null,
      } as any).then(() => {}, () => {});
    };

    // Fire immediately — deferring via requestIdleCallback/setTimeout drops
    // writes on Android WebView when the app is backgrounded or the OS freezes
    // the tab before the callback runs.
    doInsert();
  } catch {
    // ignore
  }
}
