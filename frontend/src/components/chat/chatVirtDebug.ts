/**
 * Runtime instrumentation for the virtualised chat list.
 *
 * Disabled by default. Enable in any environment with one of:
 *   - URL param      `?chatVirtDebug=1`
 *   - localStorage   `ff:chat-virt-debug` = `1`
 *   - global         `window.__chatVirtDebug = true`
 *
 * Once enabled, the following are emitted to the console (grouped under
 * `[chat-virt]`) and buffered in-memory for post-hoc inspection via
 * `window.__chatVirtDebugDump()`:
 *
 *  - row height measurements      → estimated vs measured per row, with
 *                                    a delta + warning when |delta| > 24px
 *                                    (the dominant cause of visible jolts).
 *  - key stability                → re-render count per message id; warns
 *                                    on excessive churn (>20 renders / 5s
 *                                    for the same id) which usually means
 *                                    a parent closure is invalidating
 *                                    `itemContent` and the row is being
 *                                    re-mounted instead of re-used.
 *  - re-anchoring events          → anchor base id swaps, firstItemIndex
 *                                    deltas, bottom-pin revisions.
 *  - scrollTop ownership conflicts → any mutation of `scrollTop` on the
 *                                    Virtuoso scroller from outside the
 *                                    Virtuoso write path (e.g. a legacy
 *                                    chat hook still imperatively pinning).
 *
 * The instrumentation is intentionally cheap when disabled (a single
 * boolean check on the hot path) so it can ship to production behind the
 * `chatVirtDebug` flag for field debugging.
 */

const BUFFER_LIMIT = 500;

type DebugEvent = {
  t: number;
  kind:
    | "measure"
    | "key-churn"
    | "anchor"
    | "first-index"
    | "pin"
    | "scrolltop-write"
    | "start-reached"
    | "duplicate-id"
    | (string & {});
  data: Record<string, unknown>;
};

declare global {
  interface Window {
    __chatVirtDebug?: boolean;
    __chatVirtDebugDump?: () => DebugEvent[];
    __chatVirtDebugClear?: () => void;
    __chatVirtDebugBuffer?: DebugEvent[];
    __chatVirtDebugSummary?: () => MeasurementSummary;
    __chatVirtDebugSummaryJSON?: () => string;
  }
}

let cachedEnabled: boolean | null = null;

/**
 * Programmatically toggle the debug flag at runtime. Persists in
 * localStorage so it survives reloads, and resets the cached value so the
 * very next `isChatVirtDebugEnabled()` call reflects the new state without
 * a page reload.
 */
export function setChatVirtDebugEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage?.setItem("ff:chat-virt-debug", "1");
    else window.localStorage?.removeItem("ff:chat-virt-debug");
  } catch {
    /* ignore quota / private mode errors */
  }
  window.__chatVirtDebug = enabled || undefined;
  cachedEnabled = null;
  if (enabled) {
    // Force-init buffer + global helpers immediately.
    isChatVirtDebugEnabled();
  }
}

export function isChatVirtDebugEnabled(): boolean {
  if (cachedEnabled !== null) return cachedEnabled;
  if (typeof window === "undefined") {
    cachedEnabled = false;
    return false;
  }
  try {
    if (window.__chatVirtDebug === true) {
      cachedEnabled = true;
    } else if (
      typeof window.location !== "undefined" &&
      new URLSearchParams(window.location.search).get("chatVirtDebug") === "1"
    ) {
      cachedEnabled = true;
    } else if (window.localStorage?.getItem("ff:chat-virt-debug") === "1") {
      cachedEnabled = true;
    } else {
      cachedEnabled = false;
    }
  } catch {
    cachedEnabled = false;
  }
  if (cachedEnabled) initRuntime();
  return cachedEnabled;
}

function initRuntime() {
  if (typeof window === "undefined") return;
  if (!window.__chatVirtDebugBuffer) window.__chatVirtDebugBuffer = [];
  window.__chatVirtDebugDump = () => window.__chatVirtDebugBuffer ?? [];
  window.__chatVirtDebugClear = () => {
    if (window.__chatVirtDebugBuffer) window.__chatVirtDebugBuffer.length = 0;
    clearMeasurementSummary();
  };
  window.__chatVirtDebugSummary = () => getMeasurementSummary();
  window.__chatVirtDebugSummaryJSON = () => JSON.stringify(getMeasurementSummary(), null, 2);
  // eslint-disable-next-line no-console
  console.info(
    "[chat-virt] debug instrumentation enabled — call __chatVirtDebugDump() / __chatVirtDebugSummary() to inspect events",
  );
}

function push(event: DebugEvent) {
  if (typeof window === "undefined") return;
  const buf = window.__chatVirtDebugBuffer;
  if (!buf) return;
  buf.push(event);
  if (buf.length > BUFFER_LIMIT) buf.splice(0, buf.length - BUFFER_LIMIT);
}

function log(level: "log" | "warn", label: string, payload: Record<string, unknown>) {
  // eslint-disable-next-line no-console
  console[level](`[chat-virt] ${label}`, payload);
}

// ─── row height measurements ──────────────────────────────────────────────
const measuredOnce = new Set<string>();

/**
 * Coarse row classification used to bucket measurements in the per-run
 * summary. Categories are content-driven (not visual layout) so the buckets
 * map directly to branches in `estimateChatRowHeight`.
 */
export type ChatRowType =
  | "system"
  | "image"
  | "image+reply"
  | "url-preview"
  | "event"
  | "poll"
  | "board"
  | "vault"
  | "gallery"
  | "text+reply"
  | "text-empty"
  | "text";

type TypeStats = {
  type: ChatRowType;
  count: number;
  driftedCount: number;
  sumDelta: number;
  sumAbsDelta: number;
  maxAbsDelta: number;
  sumEstimated: number;
  sumMeasured: number;
  deltas: number[];
};

const typeStats = new Map<ChatRowType, TypeStats>();

function getTypeBucket(type: ChatRowType): TypeStats {
  let entry = typeStats.get(type);
  if (!entry) {
    entry = {
      type,
      count: 0,
      driftedCount: 0,
      sumDelta: 0,
      sumAbsDelta: 0,
      maxAbsDelta: 0,
      sumEstimated: 0,
      sumMeasured: 0,
      deltas: [],
    };
    typeStats.set(type, entry);
  }
  return entry;
}

function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.min(sortedAsc.length - 1, Math.max(0, Math.floor((p / 100) * sortedAsc.length)));
  return sortedAsc[idx];
}

export interface MeasurementSummaryRow {
  type: ChatRowType;
  count: number;
  driftedOver24px: number;
  avgEstimated: number;
  avgMeasured: number;
  avgDelta: number;
  avgAbsDelta: number;
  maxAbsDelta: number;
  p50Delta: number;
  p95Delta: number;
}

export interface MeasurementSummary {
  generatedAt: string;
  totalMeasurements: number;
  totalDriftedOver24px: number;
  byType: MeasurementSummaryRow[];
}

/**
 * Build a summary of every measurement recorded since the last `clear()`.
 * Stable JSON shape suitable for pasting into bug reports.
 */
export function getMeasurementSummary(): MeasurementSummary {
  const byType: MeasurementSummaryRow[] = [];
  let totalCount = 0;
  let totalDrifted = 0;
  for (const stats of typeStats.values()) {
    if (stats.count === 0) continue;
    const sorted = stats.deltas.slice().sort((a, b) => a - b);
    totalCount += stats.count;
    totalDrifted += stats.driftedCount;
    byType.push({
      type: stats.type,
      count: stats.count,
      driftedOver24px: stats.driftedCount,
      avgEstimated: Math.round(stats.sumEstimated / stats.count),
      avgMeasured: Math.round(stats.sumMeasured / stats.count),
      avgDelta: Math.round(stats.sumDelta / stats.count),
      avgAbsDelta: Math.round(stats.sumAbsDelta / stats.count),
      maxAbsDelta: stats.maxAbsDelta,
      p50Delta: percentile(sorted, 50),
      p95Delta: percentile(sorted, 95),
    });
  }
  // Sort by drift impact: most-drifted buckets first.
  byType.sort((a, b) => b.driftedOver24px - a.driftedOver24px || b.count - a.count);
  return {
    generatedAt: new Date().toISOString(),
    totalMeasurements: totalCount,
    totalDriftedOver24px: totalDrifted,
    byType,
  };
}

export function clearMeasurementSummary() {
  typeStats.clear();
  measuredOnce.clear();
}

export function debugLogMeasure(
  messageId: string,
  estimated: number | undefined,
  measured: number,
  rowType: ChatRowType = "text",
) {
  if (!isChatVirtDebugEnabled()) return;
  // Aggregate every measurement (not just first) so the summary reflects
  // real drift distribution, including post-hydrate corrections.
  if (estimated != null) {
    const delta = measured - estimated;
    const stats = getTypeBucket(rowType);
    stats.count += 1;
    stats.sumDelta += delta;
    stats.sumAbsDelta += Math.abs(delta);
    if (Math.abs(delta) > stats.maxAbsDelta) stats.maxAbsDelta = Math.abs(delta);
    stats.sumEstimated += estimated;
    stats.sumMeasured += measured;
    if (Math.abs(delta) > 24) stats.driftedCount += 1;
    // Cap stored deltas at 1000 per bucket to bound memory; keep most recent.
    if (stats.deltas.length >= 1000) stats.deltas.shift();
    stats.deltas.push(delta);
  }
  // De-noise event stream: only push first measurement per id, plus any later
  // remeasure with material drift (>24px).
  const firstTime = !measuredOnce.has(messageId);
  measuredOnce.add(messageId);
  const delta = estimated == null ? null : measured - estimated;
  const big = delta != null && Math.abs(delta) > 24;
  if (!firstTime && !big) return;
  push({
    t: Date.now(),
    kind: "measure",
    data: { messageId, rowType, estimated, measured, delta },
  });
  if (big) log("warn", "row height drift", { messageId, rowType, estimated, measured, delta });
}

// ─── key stability ────────────────────────────────────────────────────────
const renderCounts = new Map<string, { count: number; firstAt: number }>();
const churnWarned = new Set<string>();

export function debugTrackRender(messageId: string) {
  if (!isChatVirtDebugEnabled()) return;
  const now = Date.now();
  const entry = renderCounts.get(messageId);
  if (!entry) {
    renderCounts.set(messageId, { count: 1, firstAt: now });
    return;
  }
  // 5s rolling window
  if (now - entry.firstAt > 5000) {
    entry.count = 1;
    entry.firstAt = now;
    return;
  }
  entry.count += 1;
  if (entry.count > 20 && !churnWarned.has(messageId)) {
    churnWarned.add(messageId);
    push({
      t: now,
      kind: "key-churn",
      data: { messageId, renders: entry.count, windowMs: now - entry.firstAt },
    });
    log("warn", "row key churn — likely itemContent identity instability", {
      messageId,
      renders: entry.count,
    });
  }
}

// ─── anchor / first-index / pin events ────────────────────────────────────
export function debugLogAnchor(reason: string, data: Record<string, unknown>) {
  if (!isChatVirtDebugEnabled()) return;
  push({ t: Date.now(), kind: "anchor", data: { reason, ...data } });
  log("log", `anchor: ${reason}`, data);
}

let lastFirstItemIndex: number | null = null;
export function debugLogFirstItemIndex(firstItemIndex: number, messagesLen: number) {
  if (!isChatVirtDebugEnabled()) return;
  if (lastFirstItemIndex === firstItemIndex) return;
  const delta = lastFirstItemIndex == null ? 0 : firstItemIndex - lastFirstItemIndex;
  push({
    t: Date.now(),
    kind: "first-index",
    data: { firstItemIndex, delta, messagesLen },
  });
  log("log", "firstItemIndex shift", { firstItemIndex, delta, messagesLen });
  lastFirstItemIndex = firstItemIndex;
}

export function debugLogBottomPin(revision: number, reason: string) {
  if (!isChatVirtDebugEnabled()) return;
  push({ t: Date.now(), kind: "pin", data: { revision, reason } });
  log("log", "bottom-pin", { revision, reason });
}

export function debugLogStartReached(accepted: boolean, reason: string) {
  if (!isChatVirtDebugEnabled()) return;
  push({ t: Date.now(), kind: "start-reached", data: { accepted, reason } });
  log("log", `startReached ${accepted ? "accepted" : "rejected"}`, { reason });
}

export function debugLogDuplicate(messageId: string, count: number) {
  if (!isChatVirtDebugEnabled()) return;
  push({ t: Date.now(), kind: "duplicate-id", data: { messageId, count } });
  log("warn", "duplicate message id filtered before virtualiser", { messageId, count });
}

/**
 * Generic escape hatch for page-level diagnostics (e.g. "who replaced the
 * rendered message window?"). Cheap when the flag is off.
 */
export function debugLogEvent(kind: string, data: Record<string, unknown>) {
  if (!isChatVirtDebugEnabled()) return;
  push({ t: Date.now(), kind, data });
  log("log", kind, data);
}

// ─── scrollTop ownership conflicts ────────────────────────────────────────
const watchedScrollers = new WeakSet<HTMLElement>();
let virtuosoWriteDepth = 0;

/**
 * Wrap any external scrollTop mutation that *legitimately* belongs to
 * Virtuoso (scrollToIndex, scrollToBottom, etc.) so the watcher does not
 * mis-flag it as a foreign owner. Currently unused but exposed for tests.
 */
export function withVirtuosoScrollWrite<T>(fn: () => T): T {
  virtuosoWriteDepth += 1;
  try {
    return fn();
  } finally {
    virtuosoWriteDepth -= 1;
  }
}

export function debugAttachScrollerWatcher(element: HTMLElement | Window | null) {
  if (!isChatVirtDebugEnabled()) return;
  if (!element || element instanceof Window) return;
  if (watchedScrollers.has(element)) return;
  watchedScrollers.add(element);

  // Patch scrollTop setter on this instance only. We can't redefine on the
  // prototype (would affect every element); per-instance defineProperty is
  // safe and tearable when the element is GC'd.
  const proto = Object.getPrototypeOf(element);
  const desc =
    Object.getOwnPropertyDescriptor(proto, "scrollTop") ||
    Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollTop");
  if (!desc?.set || !desc.get) return;
  const origSet = desc.set;
  const origGet = desc.get;

  Object.defineProperty(element, "scrollTop", {
    configurable: true,
    get() {
      return origGet.call(this);
    },
    set(value: number) {
      const before = origGet.call(this) as number;
      origSet.call(this, value);
      // Only flag *foreign* writes — internal Virtuoso writes are common
      // and expected. Our heuristic: if the call stack does not contain
      // any virtuoso frame and we're not inside withVirtuosoScrollWrite,
      // treat it as a foreign owner.
      if (virtuosoWriteDepth > 0) return;
      const stack = new Error().stack ?? "";
      if (/virtuoso/i.test(stack)) return;
      // Ignore tiny rebound writes the browser itself may issue.
      if (Math.abs(value - before) < 2) return;
      push({
        t: Date.now(),
        kind: "scrolltop-write",
        data: {
          from: before,
          to: value,
          delta: value - before,
          stack: stack.split("\n").slice(2, 6).join(" | "),
        },
      });
      log("warn", "foreign scrollTop write on virtuoso scroller", {
        from: before,
        to: value,
        delta: value - before,
      });
    },
  });
}

// ─── row classification ───────────────────────────────────────────────────
type ClassifiableMessage = {
  text?: string | null;
  image_url?: string | null;
  imageUrl?: string | null;
  reply_to?: unknown;
  reply_to_id?: string | null;
  is_system_message?: boolean | null;
};

/**
 * Bucket a message into one of the `ChatRowType` categories used by the
 * measurement summary. Mirrors the structural branches in
 * `estimateChatRowHeight` so per-bucket drift maps to a single estimator
 * branch (easier to tune from the JSON output).
 */
export function classifyChatRow(message: ClassifiableMessage): ChatRowType {
  if (message?.is_system_message) return "system";
  const hasImage = !!(message?.image_url || message?.imageUrl);
  const hasReply = !!(message?.reply_to || message?.reply_to_id);
  const text = (message?.text ?? "").trim();
  if (hasImage) return hasReply ? "image+reply" : "image";

  // Token-driven preview cards take precedence over generic URL preview.
  const tokenMatch = /\[(event|poll|board|vault|vaultfolder|vaultroot|gallery):/i.exec(text);
  if (tokenMatch) {
    const k = tokenMatch[1].toLowerCase();
    if (k === "vaultfolder" || k === "vaultroot") return "vault";
    return (k as ChatRowType) ?? "text";
  }
  if (/https?:\/\/|www\./i.test(text)) return "url-preview";
  if (hasReply) return "text+reply";
  if (!text) return "text-empty";
  return "text";
}
