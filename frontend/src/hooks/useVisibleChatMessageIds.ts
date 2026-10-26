import { useEffect, type RefObject } from 'react';

/** One observer pair per mounted scroller, never one listener per message.
 * Geometry excludes Virtuoso's large offscreen overscan from private reads. */
export function useVisibleChatMessageIds(
  root: RefObject<HTMLElement>, onChange?: (ids: readonly string[]) => void,
) {
  useEffect(() => {
    const host = root.current;
    if (!host || !onChange) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let lastKey: string | undefined;
    const measure = () => {
      timer = undefined;
      const viewport = host.getBoundingClientRect();
      if (viewport.height <= 0 || viewport.width <= 0) return;
      const ids: string[] = [];
      for (const row of host.querySelectorAll<HTMLElement>('[data-message-id]')) {
        const rect = row.getBoundingClientRect();
        if (rect.height > 0 && rect.bottom > viewport.top && rect.top < viewport.bottom) {
          const id = row.dataset.messageId;
          if (id && !ids.includes(id)) ids.push(id);
          if (ids.length === 100) break;
        }
      }
      const key = JSON.stringify(ids);
      if (key !== lastKey) { lastKey = key; onChange(ids); }
    };
    const schedule = () => {
      if (timer !== undefined) clearTimeout(timer);
      timer = setTimeout(measure, 120);
    };
    const mutation = new MutationObserver(schedule);
    mutation.observe(host, { childList: true, subtree: true });
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(host);
    host.addEventListener('scroll', schedule, true);
    window.addEventListener('resize', schedule);
    schedule();
    return () => {
      if (timer !== undefined) clearTimeout(timer);
      mutation.disconnect(); resize?.disconnect();
      host.removeEventListener('scroll', schedule, true);
      window.removeEventListener('resize', schedule);
    };
  }, [root, onChange]);
}