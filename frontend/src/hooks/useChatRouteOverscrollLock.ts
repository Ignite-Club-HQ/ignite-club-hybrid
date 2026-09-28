import { useEffect, useRef } from "react";

const CHAT_SCROLL_SELECTOR = '[data-chat-scroll-lock="true"]';
const INPUT_SELECTOR = "input, textarea, [contenteditable='true']";
// Overlays portaled to document.body that own their own scroll container and
// must NOT be governed by the chat route's overscroll prevention. Without this
// the global touchmove listener treats the overlay's content as "chat chrome"
// and blocks upward scroll (deltaY > 0) inside it.
const OVERLAY_SCROLL_SELECTOR =
  '[data-gif-picker], [data-radix-popper-content-wrapper], [role="dialog"], [data-state="open"][data-side]';

export function useChatRouteOverscrollLock(enabled: boolean) {
  const touchStartYRef = useRef(0);

  useEffect(() => {
    const root = document.getElementById("root");
    if (!root || !enabled) return;

    const html = document.documentElement;
    const body = document.body;

    const previousRootOverflowY = root.style.overflowY;
    const previousRootOverscrollBehaviorY = root.style.overscrollBehaviorY;
    const previousHtmlOverscrollBehaviorY = html.style.overscrollBehaviorY;
    const previousBodyOverscrollBehaviorY = body.style.overscrollBehaviorY;

    root.style.overflowY = "hidden";
    root.style.overscrollBehaviorY = "none";
    html.style.overscrollBehaviorY = "none";
    body.style.overscrollBehaviorY = "none";

    const isAndroid = /Android/i.test(navigator.userAgent);
    const scheduledScrollResets = new Set<number>();

    // CRITICAL: Android/iOS browsers may auto-scroll the outer app container
    // when focusing the fixed chat composer, even though chat itself owns the
    // only valid scroll area. That pans AppHeader + ChatHeaderShell off the
    // top while the message list remains visible. Keep the outer viewport at
    // origin; only the inner `[data-chat-scroll-lock]` element may scroll.
    const resetOuterViewport = () => {
      if (root.scrollTop !== 0 || root.scrollLeft !== 0) {
        root.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      if (window.scrollX !== 0 || window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
      if (html.scrollTop !== 0) html.scrollTop = 0;
      if (body.scrollTop !== 0) body.scrollTop = 0;
    };

    // Coalesce reset bursts. Previously every scroll event (including each
    // fling frame on Android) enqueued 4 setTimeouts at 50/150/350/700ms,
    // which all fired after the fling stopped — producing a visible "jolt"
    // and forcing layout reads on top of inertia. Now we run at most one
    // rAF-coalesced reset per burst, and reserve the long-tail passes for
    // explicit triggers (focus, viewport resize, mount).
    let pendingRaf: number | null = null;
    const scheduleOuterViewportReset = () => {
      if (pendingRaf != null) return;
      pendingRaf = requestAnimationFrame(() => {
        pendingRaf = null;
        resetOuterViewport();
      });
    };
    const scheduleOuterViewportResetWithTail = () => {
      resetOuterViewport();
      requestAnimationFrame(resetOuterViewport);
      [150, 350, 700].forEach((delay) => {
        const id = window.setTimeout(() => {
          scheduledScrollResets.delete(id);
          resetOuterViewport();
        }, delay);
        scheduledScrollResets.add(id);
      });
    };

    scheduleOuterViewportResetWithTail();

    const handleTouchStart = (event: TouchEvent) => {
      touchStartYRef.current = event.touches[0]?.clientY ?? 0;
    };

    // Prevent pull-to-refresh / rubber-band bounce when dragging DOWN from
    // chat chrome (header/composer) on Android AND iOS. The chat scroll
    // viewport itself uses `overscroll-behavior-y: contain`, so we no longer
    // need to inspect it here on every touchmove — doing so was forcing the
    // browser to wait on a passive:false JS handler before continuing
    // inertia, which made upward scroll feel slow and chunky and produced a
    // jolt when the fling stopped.
    const canEditableConsumeGesture = (target: HTMLElement, deltaY: number) => {
      const editable = target.closest<HTMLInputElement | HTMLTextAreaElement | HTMLElement>(INPUT_SELECTOR);
      if (!editable) return false;
      const maxScrollTop = editable.scrollHeight - editable.clientHeight;
      if (maxScrollTop <= 1) return false;

      // Finger moving down means the textarea needs to scroll toward its top;
      // finger moving up means it needs to scroll toward its bottom. Let the
      // editable consume those gestures so long drafts can be reviewed.
      return deltaY > 0 ? editable.scrollTop > 0 : editable.scrollTop < maxScrollTop - 1;
    };

    const handleTouchMove = (event: TouchEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Fast path: only chat-chrome elements need preventDefault. Everything
      // else (message list, overlays, inputs) is handled by overscroll-behavior
      // or by the overlay's own scroll container.
      if (!target.closest('[data-chat-chrome="true"]')) return;
      const currentY = event.touches[0]?.clientY;
      if (currentY == null) return;
      const deltaY = currentY - touchStartYRef.current;
      if (canEditableConsumeGesture(target, deltaY)) return;
      if (deltaY > 0) {
        event.preventDefault();
      }
    };

    document.addEventListener("touchstart", handleTouchStart, { passive: true });
    document.addEventListener("touchmove", handleTouchMove, { passive: false });
    document.addEventListener("focusin", scheduleOuterViewportResetWithTail, true);
    window.addEventListener("resize", scheduleOuterViewportResetWithTail);
    // NOTE: We intentionally do NOT listen for `scroll` on window/root or for
    // `scroll` on visualViewport. The outer container has `overflow:hidden` so
    // it cannot scroll meaningfully, but during fling inertia on Android the
    // visualViewport emits sub-pixel scroll events as the browser settles its
    // top chrome. Calling `window.scrollTo(0,0)` in response produced the
    // visible up/down jolt at the end of every scroll. Focus and resize
    // handlers are sufficient to keep the outer viewport pinned.
    // visualViewport resize fires during Android Chrome URL-bar show/hide
    // (which happens *during* a fling). Use the lightweight rAF-coalesced
    // reset only — NOT the tail-timeout variant — so the post-fling moments
    // at 150/350/700ms don't snap the viewport and produce an up/down jolt.
    window.visualViewport?.addEventListener("resize", scheduleOuterViewportReset);

    return () => {
      if (pendingRaf != null) cancelAnimationFrame(pendingRaf);
      scheduledScrollResets.forEach((id) => window.clearTimeout(id));
      document.removeEventListener("touchstart", handleTouchStart);
      document.removeEventListener("touchmove", handleTouchMove);
      document.removeEventListener("focusin", scheduleOuterViewportResetWithTail, true);
      window.removeEventListener("resize", scheduleOuterViewportResetWithTail);
      window.visualViewport?.removeEventListener("resize", scheduleOuterViewportReset);

      root.style.overflowY = previousRootOverflowY;
      root.style.overscrollBehaviorY = previousRootOverscrollBehaviorY;
      html.style.overscrollBehaviorY = previousHtmlOverscrollBehaviorY;
      body.style.overscrollBehaviorY = previousBodyOverscrollBehaviorY;
    };
  }, [enabled]);
}
