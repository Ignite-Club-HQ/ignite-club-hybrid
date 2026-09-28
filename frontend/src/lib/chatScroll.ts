export function resolveChatScrollViewport(container: HTMLElement | null | undefined) {
  if (!container) return null;

  if (container.matches?.("[data-radix-scroll-area-viewport]")) {
    return container;
  }

  return container.querySelector?.<HTMLElement>("[data-radix-scroll-area-viewport]") ?? container;
}

export function isVirtualizedChatViewport(container: HTMLElement | null | undefined) {
  const viewport = resolveChatScrollViewport(container);
  return !!viewport?.closest?.('[data-chat-virtualized="true"]');
}

export function getChatScrollMetrics(container: HTMLElement | null | undefined) {
  const viewport = resolveChatScrollViewport(container);
  if (!viewport) return null;

  const maxScrollTop = Math.max(0, viewport.scrollHeight - viewport.clientHeight);

  return {
    viewport,
    maxScrollTop,
    distanceFromBottom: Math.max(0, maxScrollTop - viewport.scrollTop),
  };
}

/**
 * Scrolls a chat container to the absolute bottom.
 * Uses an immediate snap + double-rAF + a 150ms delayed pass to catch
 * async layout changes (e.g. ResizeObserver updating composer height).
 */
import { installChatScrollIntentTracking, isViewportTouching, isViewportUserActive } from "./chatScrollIntent";

export function scrollChatToBottom(
  container: HTMLElement | null | undefined,
  options: { persistent?: boolean; force?: boolean } = {},
) {
  const viewport = resolveChatScrollViewport(container);
  if (!viewport) return;
  installChatScrollIntentTracking(viewport);

  const snap = () => {
    viewport.scrollTop = viewport.scrollHeight - viewport.clientHeight;
  };

  snap();
  requestAnimationFrame(() => {
    snap();
    requestAnimationFrame(snap);
  });

  // Catch async ResizeObserver → state update → re-render → layout cycle.
  // Bail if user has scrolled away OR is actively interacting — never yank
  // a finger drag back to bottom.
  setTimeout(() => {
    if (options.force ? isViewportTouching(viewport) : isViewportUserActive(viewport)) return;
    const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
    if (!options.force && distance > 80) return;
    snap();
  }, 150);

  // Persistent mode: when entering reply/edit, the soft keyboard + reply
  // preview animate in over ~300-600ms (esp. on Android). Re-snap across
  // that window so the latest message stays visible above the composer.
  if (options.persistent) {
    [300, 500, 750].forEach((delay) => {
      setTimeout(() => {
        if (options.force ? isViewportTouching(viewport) : isViewportUserActive(viewport)) return;
        const distance = viewport.scrollHeight - viewport.clientHeight - viewport.scrollTop;
        // Allow a wider tolerance here since keyboard can shift layout abruptly
        if (!options.force && distance > 400) return;
        snap();
      }, delay);
    });
  }
}

const isAndroid = typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent);

export function scrollChatElementIntoView(container: HTMLElement | null | undefined, element: HTMLElement | null | undefined) {
  const viewport = resolveChatScrollViewport(container);
  if (!viewport || !element) return;

  const viewportRect = viewport.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  const targetTop = viewport.scrollTop + elementRect.top - viewportRect.top - Math.max(24, (viewport.clientHeight - elementRect.height) / 2);
  // Android Chrome WebView: smooth scroll programmatic calls hijack any
  // in-progress touch/inertia scroll. Use auto on Android (per project memory)
  // and smooth elsewhere.
  viewport.scrollTo({ top: Math.max(0, targetTop), behavior: isAndroid ? "auto" : "smooth" });
}

/**
 * Returns true if the viewport is scrolled near the bottom (within threshold px).
 */
export function isNearBottom(container: HTMLElement | null | undefined, threshold = 150): boolean {
  const metrics = getChatScrollMetrics(container);
  if (!metrics) return true; // default to "at bottom" if can't measure
  return metrics.distanceFromBottom <= threshold;
}
