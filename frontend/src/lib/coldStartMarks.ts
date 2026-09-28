/**
 * Cold-start stage instrumentation.
 *
 * Purpose: measure where time actually goes between app boot / notification
 * tap and the first painted chat message, so we can decide whether it is
 * worth investing in notification-side prefetch (option #2) or if the
 * bottleneck is elsewhere (Capacitor boot, auth resolution, route waterfall).
 *
 * Design: purely additive. Marks are stored on a module singleton (per JS
 * runtime, i.e. per cold start). `snapshotStages()` returns deltas relative
 * to the first mark and never mutates state. The chat-open latency logger
 * calls it once per chat mount and ships the payload with the existing
 * `chat_open_perf` insert so we get a per-user, per-platform breakdown.
 *
 * Zero side-effects: any failure is swallowed; no user-visible impact.
 */

export type ColdStartStage =
  | "boot"              // main.tsx module evaluated (Capacitor + JS runtime ready)
  | "notif_tap"         // notification tap dispatched (native or web)
  | "auth_ready"        // useAuth `initialized` flipped true
  | "pending_nav_consume_attempt" // first attempt to drain a pending push URL after auth/user resolved
  | "app_layout_gate_open"        // AppLayout loading/profile/theme gate released; child routes can render
  | "route_navigate"    // router navigate(path) invoked for the chat route (warm tap or drained cold-start)
  | "chat_chunk_loaded" // lazy chat page dynamic import resolved
  | "chat_mount"        // chat page component mounted
  | "chat_fetch"        // chat page queryFn began executing (RPC in flight)
  | "chat_query_return" // first messages RPC returned
  | "chat_render"       // chat page painted its first message
  | "inbox_mount"       // MessagesPage component mounted
  | "inbox_bootstrap_return" // messages-page bootstrap RPC resolved
  | "inbox_first_paint"      // MessagesPage rendered first conversation row
  | "home_mount"             // HomePage component mounted
  | "home_query_return"      // HomePage primary memberships+events query resolved
  | "home_first_paint"       // HomePage revealed content (unified skeleton hidden)
  | "schedule_mount"         // EventsPage (Schedule) component mounted
  | "schedule_query_return"  // EventsPage primary events query resolved
  | "schedule_first_paint";  // EventsPage rendered first events row / empty state

/**
 * Cumulative main-thread longtask blocking time (ms) between two stages.
 * Populated by `startLongTaskWindow` / `stopLongTaskWindow`. Reported in the
 * `chat_open_perf.stages` payload so we can attribute the auth_ready →
 * chat_mount gap between JS blocking vs I/O (chunk fetch).
 */
const longTaskWindows = new Map<string, { start: number; blockedMs: number; observer?: PerformanceObserver }>();

export function startLongTaskWindow(key: string): void {
  try {
    if (longTaskWindows.has(key)) return;
    const entry = { start: Date.now(), blockedMs: 0 } as { start: number; blockedMs: number; observer?: PerformanceObserver };
    longTaskWindows.set(key, entry);
    if (typeof PerformanceObserver === "undefined") return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const e of list.getEntries()) entry.blockedMs += Math.round(e.duration);
      });
      observer.observe({ entryTypes: ["longtask"] });
      entry.observer = observer;
    } catch {}
  } catch {}
}

export function stopLongTaskWindow(key: string): number | null {
  const entry = longTaskWindows.get(key);
  if (!entry) return null;
  try { entry.observer?.disconnect(); } catch {}
  longTaskWindows.delete(key);
  return entry.blockedMs;
}

export function peekLongTaskWindow(key: string): number | null {
  const entry = longTaskWindows.get(key);
  return entry ? entry.blockedMs : null;
}

interface MarkRecord {
  ts: number;
}

const marks = new Map<ColdStartStage, MarkRecord>();

// Absolute anchor for the very first thing we observe (usually `boot`).
let anchorTs: number | null = null;

/**
 * Milliseconds spent in native/webview startup BEFORE main.tsx evaluated.
 * Captured once at first `mark("boot")` call as
 * `Date.now() - performance.timeOrigin`. On true Android cold starts this
 * dominates when it's large (webview cold-init + JS bundle parse). On warm
 * in-session navigations this is ~0.
 */
let navMs: number | null = null;

export function mark(stage: ColdStartStage): void {
  try {
    if (marks.has(stage)) return; // first-write wins so retries don't overwrite
    const ts = Date.now();
    marks.set(stage, { ts });
    if (anchorTs === null) anchorTs = ts;
    if (stage === "boot" && navMs === null) {
      try {
        const origin = typeof performance !== "undefined" ? performance.timeOrigin : ts;
        navMs = Math.max(0, Math.round(ts - origin));
      } catch {
        navMs = 0;
      }
    }
  } catch {
    // ignore
  }
}

/** Force-refresh a mark (used when a warm tap happens after boot). */
export function remark(stage: ColdStartStage): void {
  try {
    marks.set(stage, { ts: Date.now() });
  } catch {
    // ignore
  }
}

/** Raw ms-epoch of a mark, or null if it hasn't fired this JS session. */
export function getMarkTs(stage: ColdStartStage): number | null {
  const rec = marks.get(stage);
  return rec ? rec.ts : null;
}

export interface StageSnapshot {
  /** Absolute ms epoch of the anchor mark (usually `boot`). */
  anchor: number | null;
  /** ms of native/webview startup before main.tsx evaluated (see `navMs`). */
  nav_ms: number | null;
  /** Per-stage delta from anchor in ms. Missing stages are omitted. */
  deltas: Partial<Record<ColdStartStage, number>>;
}

/**
 * Returns per-stage timings relative to the earliest recorded mark. Safe to
 * call any number of times — does not consume the marks (a single cold start
 * can open multiple chats and we want a consistent reference each time).
 */
export function snapshotStages(): StageSnapshot {
  const deltas: Partial<Record<ColdStartStage, number>> = {};
  if (anchorTs === null) return { anchor: null, nav_ms: navMs, deltas };
  for (const [stage, rec] of marks.entries()) {
    deltas[stage] = Math.max(0, rec.ts - anchorTs);
  }
  return { anchor: anchorTs, nav_ms: navMs, deltas };
}

/**
 * Compact single-line console dump. Only logs in dev / when
 * `?coldstart=1` is present or `localStorage.ff:coldstart-log=1` is set,
 * so we don't add noise to normal builds.
 */
export function logStagesToConsole(context: string): void {
  try {
    if (typeof window === "undefined") return;
    const forced =
      new URLSearchParams(window.location.search).get("coldstart") === "1" ||
      window.localStorage?.getItem("ff:coldstart-log") === "1";
    const isDev = (import.meta as any)?.env?.DEV === true;
    if (!isDev && !forced) return;

    const snap = snapshotStages();
    if (snap.anchor === null) return;
    const parts = Object.entries(snap.deltas)
      .sort((a, b) => (a[1] ?? 0) - (b[1] ?? 0))
      .map(([k, v]) => `${k}=${v}ms`)
      .join(" ");
    // eslint-disable-next-line no-console
    console.info(`[ColdStart:${context}] ${parts}`);
  } catch {
    // ignore
  }
}
