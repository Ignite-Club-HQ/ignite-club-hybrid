/**
 * Shared "someone just wrote scrollTop" timestamp for chat scrollers.
 *
 * Multiple independent mechanisms can write `scrollTop` on the same chat
 * viewport in the first ~2.4s after open (initial bottom pin + openPinWindow
 * timers + stay-pinned ResizeObserver + ChatMessagesScroller's keyboard /
 * composer-growth pin). Without coordination they can fire opposing
 * micro-adjustments in the same frame, which reads as jitter.
 *
 * Each writer calls `markChatScrollWrite()` immediately after committing a
 * `scrollTop` (or `scrollToIndex`) change. Other writers can call
 * `isRecentChatScrollWrite(ms)` to bail out if a peer just wrote — letting
 * the most recent intent stand instead of double-correcting.
 */

let lastWriteAt = 0;

export function markChatScrollWrite() {
  lastWriteAt = performance.now();
}

export function isRecentChatScrollWrite(maxAgeMs: number) {
  if (lastWriteAt === 0) return false;
  return performance.now() - lastWriteAt < maxAgeMs;
}
