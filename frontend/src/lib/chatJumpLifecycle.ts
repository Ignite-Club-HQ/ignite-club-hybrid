/**
 * ONE authoritative lifecycle per exact-message jump.
 *
 * Before this module there were two independent, overlapping waits after a
 * notification tap:
 *
 *   1. the virtualised list's `initialRevealReady` settle loop, which
 *      re-armed a FRESH `waitForChatVisualContentSettle` every 80 ms for as
 *      long as `isChatJumpActive()` stayed true (the 2.2 s jump tail), and
 *   2. the jump overlay's own `onEnd` settle wait (up to a further 8 s),
 *      which was cancelled and RESTARTED by every duplicate end signal
 *      (`chat:jump-hydration-end` + `setChatJumpActive(false)` both fire).
 *
 * Result: a correctly targeted, correctly aligned thread could stay fully
 * masked for ~10 s (and up to the 32 s backstop). This module gives both
 * consumers a single generation + single start timestamp so the reveal budget
 * is measured ONCE from the original jump start, and makes duplicate
 * start/end notifications idempotent.
 */

export interface ChatJumpLifecycle {
  /** Increments once per jump. Lets consumers discard stale completions. */
  generation: number;
  /** `performance.now()` at the ORIGINAL jump start. Never re-stamped. */
  startedAt: number;
  targetMessageId: string | null;
  /** True once the jump's own poll/settle passes have finished. */
  ended: boolean;
}

let current: ChatJumpLifecycle = {
  generation: 0,
  startedAt: 0,
  targetMessageId: null,
  ended: true,
};

const listeners = new Set<(lifecycle: ChatJumpLifecycle) => void>();

function emit() {
  const snapshot = { ...current };
  listeners.forEach((listener) => {
    try { listener(snapshot); } catch { /* noop */ }
  });
}

function now(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/**
 * Begin a jump lifecycle. Calling this again for the SAME target while the
 * lifecycle is still open is idempotent: the budget is not re-armed, so a
 * duplicate notification tap cannot extend the blank window. A different
 * target supersedes the previous lifecycle (new generation, new budget).
 */
export function beginChatJumpLifecycle(targetMessageId: string | null): ChatJumpLifecycle {
  const sameTargetStillRunning =
    !current.ended && current.targetMessageId === targetMessageId && current.generation > 0;
  if (sameTargetStillRunning) return { ...current };
  current = {
    generation: current.generation + 1,
    startedAt: now(),
    targetMessageId,
    ended: false,
  };
  emit();
  return { ...current };
}

/** Idempotent: repeated end signals never restart or cancel a pending reveal. */
export function endChatJumpLifecycle(): ChatJumpLifecycle {
  if (current.ended) return { ...current };
  current = { ...current, ended: true };
  emit();
  return { ...current };
}

export function getChatJumpLifecycle(): ChatJumpLifecycle {
  return { ...current };
}

/**
 * Remaining budget for the CURRENT lifecycle, measured from the original jump
 * start. Returns `budgetMs` when no lifecycle has started yet (cold mount
 * without a jump), so callers always get a usable window.
 */
export function chatJumpLifecycleRemaining(budgetMs: number): number {
  if (current.startedAt === 0) return budgetMs;
  return Math.max(0, budgetMs - (now() - current.startedAt));
}

export function subscribeChatJumpLifecycle(
  listener: (lifecycle: ChatJumpLifecycle) => void,
): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Test-only reset. */
export function __resetChatJumpLifecycleForTests(): void {
  current = { generation: 0, startedAt: 0, targetMessageId: null, ended: true };
}
