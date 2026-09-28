/**
 * Batch 3C: Defer link-preview fetches while a jump-to-message is in flight.
 *
 * Why: link previews fetched during the jump-landing window expand row
 * heights asynchronously, forcing jumpToMessage's settle-pass to re-correct
 * the scroll position repeatedly (the "8x exact DOM correction over 6s"
 * symptom). Delaying the fetch by ~800ms after hydration-end lets the jump
 * settle on stable heights, then previews load normally.
 *
 * Kill-switches (no redeploy needed):
 *   - localStorage.setItem('ignite_disable_link_preview_defer', '1')
 *   - window.__disableLinkPreviewDefer = true
 */

import { isChatJumpActive, subscribeChatJumpActive } from "./chatJumpActive";

const DEFER_AFTER_HYDRATION_MS = 800;

declare global {
  interface Window {
    __disableLinkPreviewDefer?: boolean;
  }
}

function isDeferDisabled(): boolean {
  try {
    if (typeof window !== "undefined" && window.__disableLinkPreviewDefer) return true;
    if (typeof localStorage !== "undefined" &&
        localStorage.getItem("ignite_disable_link_preview_defer") === "1") {
      return true;
    }
  } catch { /* noop */ }
  return false;
}

/**
 * If a jump is currently active, returns a function that will invoke `run`
 * after the jump's hydration window settles. Otherwise returns null and the
 * caller should run immediately.
 *
 * Returned function is a cancel handle.
 */
export function deferIfJumpActive(run: () => void): (() => void) | null {
  if (isDeferDisabled()) return null;
  if (!isChatJumpActive()) return null;

  let cancelled = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let unsubJump: (() => void) | null = null;

  const fire = () => {
    if (cancelled) return;
    cancelled = true;
    cleanup();
    try { run(); } catch { /* noop */ }
  };

  const cleanup = () => {
    if (timer) { clearTimeout(timer); timer = null; }
    window.removeEventListener("chat:jump-hydration-end", onHydrationEnd);
    if (unsubJump) { unsubJump(); unsubJump = null; }
  };

  const onHydrationEnd = () => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fire, DEFER_AFTER_HYDRATION_MS);
  };

  window.addEventListener("chat:jump-hydration-end", onHydrationEnd);

  // Safety net: if jump-active flips false without a hydration-end event
  // (e.g. early abort), still release after the defer window.
  unsubJump = subscribeChatJumpActive((value) => {
    if (!value && !timer) {
      timer = setTimeout(fire, DEFER_AFTER_HYDRATION_MS);
    }
  });

  // Hard ceiling: never hold a preview for >5s.
  const ceiling = setTimeout(fire, 5000);

  return () => {
    cancelled = true;
    clearTimeout(ceiling);
    cleanup();
  };
}
