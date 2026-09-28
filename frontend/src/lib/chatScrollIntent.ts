/**
 * Module-level tracker for "is the user actively touching this chat viewport?".
 * Lets library-level snap helpers (scrollChatToBottom, useInitialChatBottomPin,
 * useChatAutoScrollToLatest) bail out of programmatic scrollTop writes when
 * the user is mid-gesture, without each call site having to plumb a hook in.
 */

const lastTouchAt = new WeakMap<HTMLElement, number>();
const isTouching = new WeakSet<HTMLElement>();
const installed = new WeakSet<HTMLElement>();

const COOLDOWN_MS = 600;

export function installChatScrollIntentTracking(viewport: HTMLElement | null | undefined) {
  if (!viewport || installed.has(viewport)) return;
  installed.add(viewport);

  const stamp = () => { lastTouchAt.set(viewport, performance.now()); };
  const onTouchStart = () => { isTouching.add(viewport); stamp(); };
  const onTouchEnd = () => { isTouching.delete(viewport); stamp(); };
  const onWheel = () => stamp();

  viewport.addEventListener("touchstart", onTouchStart, { passive: true });
  viewport.addEventListener("touchend", onTouchEnd, { passive: true });
  viewport.addEventListener("touchcancel", onTouchEnd, { passive: true });
  viewport.addEventListener("wheel", onWheel, { passive: true });
}

export function isViewportUserActive(viewport: HTMLElement | null | undefined): boolean {
  if (!viewport) return false;
  if (isTouching.has(viewport)) return true;
  const ts = lastTouchAt.get(viewport);
  if (!ts) return false;
  return performance.now() - ts < COOLDOWN_MS;
}

export function isViewportTouching(viewport: HTMLElement | null | undefined): boolean {
  if (!viewport) return false;
  return isTouching.has(viewport);
}
