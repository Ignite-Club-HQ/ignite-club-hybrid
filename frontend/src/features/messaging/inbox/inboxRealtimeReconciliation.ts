/**
 * Inbox Realtime reconciliation coordinator.
 *
 * Two small, reusable pieces used by the Messages inbox (`MessagesPage`) so the
 * page doesn't need more timing effects:
 *
 * 1. `createInboxRealtimeCoordinator` — a bounded pending-event queue that
 *    buffers Realtime INSERT/UPDATE events while authorized messaging scopes
 *    are still loading, and flushes them exactly once through an idempotent
 *    applier. `attemptFlush()` is idempotent and safe to call from BOTH
 *    directions of the transition race:
 *      - authorization becomes ready before the channel/applier is installed;
 *      - the channel/applier is installed before authorization becomes ready.
 *    Nothing is cleared on harmless re-renders; `clear()` is only for
 *    sign-out / user change / failed authorization / channel teardown.
 *
 * 2. `createInboxPreviewWatermarks` — the monotonic reconciliation watermark.
 *    An authoritative inbox query that STARTED before a Realtime event could
 *    land afterwards with older (or empty) preview data and visually erase the
 *    newer message. The watermark records the most recent accepted preview per
 *    scope and `reconcile()` merges query responses against it: an older/empty
 *    response can never regress a newer preview, while a genuinely newer
 *    authoritative response always wins.
 *
 * Authorization is unaffected: buffered events are re-checked by the applier
 * (which runs the same fail-closed `isAuthorized` guard) at flush time.
 */

export type InboxRealtimeEventKind = "insert" | "edit";

export interface InboxRealtimeEvent {
  table: string;
  payload: any;
  kind: InboxRealtimeEventKind;
}

export interface InboxRealtimeCoordinatorOptions {
  /** Fail-closed gate: true only once authorized scopes are `ready`. */
  isReady: () => boolean;
  /** Max buffered events (oldest dropped beyond this). */
  maxPending?: number;
  /** Max remembered applied-event keys (duplicate-delivery protection). */
  maxAppliedKeys?: number;
}

export interface InboxRealtimeCoordinator {
  /** Apply now when ready, otherwise buffer. */
  dispatch(event: InboxRealtimeEvent): void;
  /** Install/remove the applier (the Realtime handler set). */
  setApplier(applier: ((event: InboxRealtimeEvent) => void) | null): void;
  /** Idempotently drain the buffer if both ready and an applier exists. */
  attemptFlush(): number;
  /** Sign-out / user change / failed auth / teardown only. */
  clear(): void;
  pendingCount(): number;
}

function eventIdentity(event: InboxRealtimeEvent): string | null {
  const row = event.payload?.new;
  const id = row?.id;
  if (!id) return null;
  if (event.kind === "edit") {
    // An edit of the same row is a distinct application per revision.
    const revision = row.edited_at ?? row.updated_at ?? row.text ?? "";
    return `edit:${event.table}:${id}:${revision}`;
  }
  return `insert:${event.table}:${id}`;
}

export function createInboxRealtimeCoordinator(
  options: InboxRealtimeCoordinatorOptions,
): InboxRealtimeCoordinator {
  const maxPending = options.maxPending ?? 50;
  const maxAppliedKeys = options.maxAppliedKeys ?? 200;

  let pending: InboxRealtimeEvent[] = [];
  let applier: ((event: InboxRealtimeEvent) => void) | null = null;
  let flushing = false;
  const applied = new Set<string>();

  const applyOnce = (event: InboxRealtimeEvent) => {
    const key = eventIdentity(event);
    if (key) {
      if (applied.has(key)) return;
      applied.add(key);
      if (applied.size > maxAppliedKeys) {
        const oldest = applied.values().next().value as string | undefined;
        if (oldest) applied.delete(oldest);
      }
    }
    applier?.(event);
  };

  const buffer = (event: InboxRealtimeEvent) => {
    pending.push(event);
    if (pending.length > maxPending) {
      pending.splice(0, pending.length - maxPending);
    }
  };

  const attemptFlush = () => {
    if (!applier || !options.isReady()) return 0;
    if (flushing) return 0;
    flushing = true;
    let applied = 0;
    try {
      // Loop: an applier may synchronously enqueue further events.
      while (pending.length > 0) {
        const batch = pending;
        pending = [];
        for (const event of batch) {
          applyOnce(event);
          applied += 1;
        }
      }
    } finally {
      flushing = false;
    }
    return applied;
  };

  return {
    dispatch(event) {
      if (!options.isReady() || !applier) {
        buffer(event);
        return;
      }
      applyOnce(event);
    },
    setApplier(next) {
      applier = next;
      if (next) attemptFlush();
    },
    attemptFlush,
    clear() {
      pending = [];
      applied.clear();
    },
    pendingCount() {
      return pending.length;
    },
  };
}

/* -------------------------------------------------------------------------- */

export interface InboxPreviewLike {
  created_at?: string | null;
  [key: string]: any;
}

export interface InboxPreviewWatermarks {
  /** Record a preview accepted from Realtime (the newest known message). */
  note(scopeKey: string, preview: InboxPreviewLike): void;
  /**
   * Merge an authoritative response map against the watermarks. Pure: safe to
   * call during render. Older or missing authoritative entries keep the
   * watermarked preview; newer ones win.
   */
  reconcile<T extends InboxPreviewLike>(
    scopePrefix: string,
    authoritative: Record<string, T> | undefined | null,
  ): Record<string, T>;
  clear(): void;
  size(): number;
}

const MAX_WATERMARKS = 300;

function timeOf(preview: InboxPreviewLike | undefined | null): number {
  const raw = preview?.created_at;
  if (!raw) return -Infinity;
  const t = Date.parse(raw);
  return Number.isNaN(t) ? -Infinity : t;
}

export function createInboxPreviewWatermarks(): InboxPreviewWatermarks {
  const marks = new Map<string, InboxPreviewLike>();

  return {
    note(scopeKey, preview) {
      const existing = marks.get(scopeKey);
      if (existing && timeOf(existing) > timeOf(preview)) return;
      marks.delete(scopeKey);
      marks.set(scopeKey, preview);
      if (marks.size > MAX_WATERMARKS) {
        const oldest = marks.keys().next().value as string | undefined;
        if (oldest) marks.delete(oldest);
      }
    },
    reconcile<T extends InboxPreviewLike>(
      scopePrefix: string,
      authoritative: Record<string, T> | undefined | null,
    ): Record<string, T> {
      const base = (authoritative ?? {}) as Record<string, T>;
      if (marks.size === 0) return base;
      let merged: Record<string, T> | null = null;
      for (const [key, preview] of marks) {
        if (!key.startsWith(`${scopePrefix}:`)) continue;
        const targetId = key.slice(scopePrefix.length + 1);
        const current = base[targetId];
        if (current && timeOf(current) >= timeOf(preview)) continue;
        merged = merged ?? { ...base };
        // Keep any author name the authoritative response already resolved.
        merged[targetId] = (current?.author && !preview.author
          ? { ...preview, author: current.author }
          : preview) as T;
      }
      return merged ?? base;
    },
    clear() {
      marks.clear();
    },
    size() {
      return marks.size;
    },
  };
}
