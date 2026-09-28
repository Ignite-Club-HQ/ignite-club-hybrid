import { useEffect, useRef, useState } from "react";
import { debugLogEvent } from "./chatVirtDebug";
import { isViewportTouching } from "@/lib/chatScrollIntent";

/**
 * Defers prepended history pages until the user's scroll gesture has gone
 * idle.
 *
 * Virtuoso applies a `paddingTop` correction whenever a freshly prepended
 * row's measured height differs from its estimate. When that correction
 * fires DURING an active flick it fights the browser's momentum scrolling
 * and shows up as flicker / re-anchoring. (Off-screen pre-measure was
 * attempted and reverted: heights measured outside the live Virtuoso item
 * container were systematically wrong, poisoning the row-height cache and
 * causing post-stop jolts.)
 *
 * Instead: when a prepend page arrives while the user is still actively
 * scrolling, hold it. Commit the merge only once the chat viewport has been
 * idle for `PREPEND_IDLE_MS`. Stationary commits let Virtuoso adjust
 * scrollTop + paddingTop atomically with no momentum to fight, so the
 * visible rows stay put.
 *
 * Appends / edits / interleaves always commit immediately — realtime and
 * send paths are never delayed.
 */
// Prepend commit gate.
//
// Commit older pages only inside the same user-driven scroll session that
// requested them. Once Virtuoso reports `isScrolling=false`, every unresolved
// prepend is frozen until the next explicit upward gesture. This closes the
// fast-scroll failure mode where a fetch resolves 50–250ms after inertia ends:
// `firstItemIndex` shifts, Virtuoso measures the new page, and a stationary
// viewport visibly moves down.
const PREPEND_MOTION_WINDOW_MS = 250;
const PREPEND_INPUT_SESSION_MS = 300;

let flushPendingPrependOnMotion: (() => void) | null = null;
let lastPrependUpwardMotionAt = 0;
let lastPrependInputAt = 0;
let lastPrependScrollStoppedAt = 0;
let prependVirtuosoIsScrolling = false;
let prependScrollSessionIsUserDriven = false;

// Module-level pointer so the prepend deferral effect can ask the live
// Virtuoso scroller whether a finger is currently on the glass. Set/cleared
// by the owning component via `setPrependScrollerElementGetter` on
// mount/unmount.
let scrollerElRefForPrepend: (() => HTMLElement | null) | null = null;

export function setPrependScrollerElementGetter(getter: (() => HTMLElement | null) | null) {
  scrollerElRefForPrepend = getter;
}

export function markPrependUserInput() {
  if (typeof performance !== "undefined") lastPrependInputAt = performance.now();
}

export function setPrependVirtuosoScrolling(scrolling: boolean) {
  if (typeof performance === "undefined") return;
  const now = performance.now();
  const scroller = scrollerElRefForPrepend?.();
  if (scrolling) {
    prependVirtuosoIsScrolling = true;
    prependScrollSessionIsUserDriven =
      (!!scroller && isViewportTouching(scroller)) ||
      now - lastPrependInputAt <= PREPEND_INPUT_SESSION_MS;
    return;
  }

  prependVirtuosoIsScrolling = false;
  prependScrollSessionIsUserDriven = false;
  lastPrependScrollStoppedAt = now;
}

/**
 * True when the module has an active, user-driven Virtuoso scroll session
 * (finger on glass or a recent touch/wheel/key input started it). Exposed so
 * the owning component's raw scroll handler can decide whether an observed
 * scroll delta is a real user gesture rather than a programmatic snap.
 */
export function isPrependUserDrivenScrollActive() {
  return prependVirtuosoIsScrolling && prependScrollSessionIsUserDriven;
}

function canRecordPrependUpwardMotion(explicitGesture = false) {
  if (explicitGesture) return true;
  const scroller = scrollerElRefForPrepend?.();
  if (scroller && isViewportTouching(scroller)) return true;
  return prependVirtuosoIsScrolling && prependScrollSessionIsUserDriven;
}

function isPrependMotionActive() {
  if (typeof performance === "undefined") return false;
  const scroller = scrollerElRefForPrepend?.();
  if (scroller && isViewportTouching(scroller)) return true;
  if (!prependVirtuosoIsScrolling || !prependScrollSessionIsUserDriven) return false;
  if (lastPrependScrollStoppedAt >= lastPrependUpwardMotionAt) return false;
  return performance.now() - lastPrependUpwardMotionAt <= PREPEND_MOTION_WINDOW_MS;
}

export function markPrependUpwardMotion(options: { explicitGesture?: boolean } = {}) {
  if (!canRecordPrependUpwardMotion(options.explicitGesture)) return false;
  if (typeof performance !== "undefined") lastPrependUpwardMotionAt = performance.now();
  flushPendingPrependOnMotion?.();
  return true;
}

export function useDeferPrependsWhileScrolling<TMessage extends { id: string }>(
  messagesProp: TMessage[],
): TMessage[] {
  const [committed, setCommitted] = useState<TMessage[]>(messagesProp);
  const committedRef = useRef(committed);
  const pendingPrependRef = useRef<TMessage[] | null>(null);
  committedRef.current = committed;

  useEffect(() => {
    const flush = () => {
      const pending = pendingPrependRef.current;
      if (!pending || !isPrependMotionActive()) return;
      pendingPrependRef.current = null;
      setCommitted(pending);
      debugLogEvent("prepend-flush-on-motion", { len: pending.length });
    };
    flushPendingPrependOnMotion = flush;
    return () => {
      if (flushPendingPrependOnMotion === flush) flushPendingPrependOnMotion = null;
    };
  }, []);

  useEffect(() => {
    if (messagesProp === committedRef.current) return;

    const current = committedRef.current;
    const committedIds = new Set<string>();
    for (const m of current) committedIds.add(m.id);

    const newRows: TMessage[] = [];
    for (const m of messagesProp) if (!committedIds.has(m.id)) newRows.push(m);
    if (newRows.length === 0 || current.length === 0) {
      pendingPrependRef.current = null;
      setCommitted(messagesProp);
      return;
    }

    let isPurePrepend = messagesProp.length >= newRows.length;
    for (let i = 0; i < newRows.length && isPurePrepend; i++) {
      if (messagesProp[i]?.id !== newRows[i].id) isPurePrepend = false;
    }
    if (!isPurePrepend) {
      pendingPrependRef.current = null;
      setCommitted(messagesProp);
      return;
    }

    // Pure prepend. If the fetch resolves while the viewport is still moving,
    // commit immediately so Virtuoso's firstItemIndex/paddingTop correction is
    // hidden inside the gesture. If it resolves AFTER motion stops, do not
    // commit on a stationary screen — hold the page until the next upward
    // gesture, so rows stay frozen exactly where the user stopped.
    if (isPrependMotionActive()) {
      pendingPrependRef.current = null;
      setCommitted(messagesProp);
      return;
    }

    pendingPrependRef.current = messagesProp;
    debugLogEvent("prepend-held-until-motion", { len: messagesProp.length, added: newRows.length });
  }, [messagesProp]);

  return committed;
}
