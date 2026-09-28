/**
 * Global flag indicating a jump-to-message is currently in flight.
 *
 * When true, all bottom-pinning effects across the chat surface MUST bail
 * out — otherwise the open-pin / stay-pinned compensators race the
 * scrollToIndex("center") and snap the viewport back to the last message,
 * which is exactly the symptom reported when tapping a push notification
 * for a specific message: the user lands on the latest message instead of
 * the targeted one.
 *
 * Set true by `jumpToMessageInVirtualizedChat` on start and reset on end.
 *
 * Also exposes a tiny pub/sub so the virtualised list's hydration overlay
 * can read the CURRENT value at mount time (push-notification taps fire
 * `chat:jump-hydration-start` BEFORE the list has mounted its event
 * listener — without this, the overlay never appears and the user sees the
 * settle-pass scrollToIndex jolts).
 */
let active = false;
let activatedAt = 0;
const listeners = new Set<(value: boolean) => void>();

/**
 * Hard ceiling for how long a jump may be considered "in flight". The flag is
 * module-global (not thread-scoped), so an interrupted jump — user navigates
 * away mid-hydration, target never arrives — could leave it stuck `true` for
 * the rest of the JS session. Every subsequent plain chat open then skipped
 * its bottom-pin sequence entirely and rendered off-bottom. Reads self-heal
 * past this age.
 */
const MAX_ACTIVE_MS = 8000;

export function setChatJumpActive(value: boolean): void {
  if (value) activatedAt = performance.now();
  if (active === value) return;
  active = value;
  listeners.forEach((l) => {
    try { l(value); } catch { /* noop */ }
  });
}

export function isChatJumpActive(): boolean {
  if (!active) return false;
  if (performance.now() - activatedAt > MAX_ACTIVE_MS) {
    setChatJumpActive(false);
    return false;
  }
  return true;
}


export function subscribeChatJumpActive(listener: (value: boolean) => void): () => void {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
